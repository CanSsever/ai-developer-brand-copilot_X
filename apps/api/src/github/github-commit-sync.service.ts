import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";
import { StructuredLogger } from "../observability/structured-logger";
import {
  GitHubApiService,
  GitHubIntegrationError,
  type GitHubIntegrationFailureCode,
} from "./github-api.service";
import { GITHUB_SYNC_CLOCK } from "./github.tokens";
import type { GitHubCommitEvidence } from "./github.types";

const hourMs = 60 * 60 * 1_000;
export const initialSyncLookbackMs = 30 * 24 * hourMs;
export const incrementalSyncOverlapMs = 24 * hourMs;
export const syncCursorVersion = 1;

type SyncFailureCode =
  | GitHubIntegrationFailureCode
  | "CONNECTED_REPOSITORY_NOT_AVAILABLE"
  | "SYNC_INTERNAL_ERROR";

export interface GitHubCommitSyncResult {
  readonly commitsDiscovered: number;
  readonly commitsInserted: number;
  readonly status: "succeeded";
  readonly syncRunId: string;
  readonly windowEnd: Date;
  readonly windowStart: Date;
}

interface SyncRepository {
  readonly gitHubConnection: {
    readonly providerInstallationId: bigint;
  };
  readonly id: string;
  readonly lastSuccessfulSyncAt: Date | null;
  readonly providerRepositoryId: bigint;
}

export class GitHubCommitSyncError extends Error {
  constructor(readonly failureCode: SyncFailureCode) {
    super("GitHub commit synchronization failed");
    this.name = "GitHubCommitSyncError";
  }
}

export class GitHubCommitSyncConflictError extends Error {
  readonly failureCode = "SYNC_ALREADY_ACTIVE";

  constructor() {
    super("GitHub commit synchronization is already active");
    this.name = "GitHubCommitSyncConflictError";
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function idempotencyKey(
  connectedRepositoryId: string,
  windowStart: Date,
  windowEnd: Date
): string {
  return createHash("sha256")
    .update(
      [
        connectedRepositoryId,
        windowStart.toISOString(),
        windowEnd.toISOString(),
        String(syncCursorVersion),
      ].join("\0")
    )
    .digest("hex");
}

@Injectable()
export class GitHubCommitSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GitHubApiService,
    private readonly logger: StructuredLogger,
    @Inject(GITHUB_SYNC_CLOCK) private readonly clock: () => Date
  ) {}

  async synchronize(
    connectedRepositoryId: string
  ): Promise<GitHubCommitSyncResult> {
    const repository = await this.loadRepository(connectedRepositoryId);

    if (!repository) {
      throw new GitHubCommitSyncError(
        "CONNECTED_REPOSITORY_NOT_AVAILABLE"
      );
    }

    const activeRun = await this.findActiveRun(repository.id);
    if (activeRun) {
      this.logger.warnEvent("github_commit_sync_conflict");
      throw new GitHubCommitSyncConflictError();
    }

    const windowEnd = this.clock();
    const windowStart = repository.lastSuccessfulSyncAt
      ? new Date(
          repository.lastSuccessfulSyncAt.getTime() -
            incrementalSyncOverlapMs
        )
      : new Date(windowEnd.getTime() - initialSyncLookbackMs);
    const startedAt = this.clock();
    let syncRun: { readonly id: string };

    try {
      syncRun = await this.prisma.syncRun.create({
        data: {
          connectedRepositoryId: repository.id,
          status: "queued",
          idempotencyKey: idempotencyKey(
            repository.id,
            windowStart,
            windowEnd
          ),
          cursorVersion: syncCursorVersion,
          windowStart,
          windowEnd,
        },
        select: { id: true },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        this.logger.warnEvent("github_commit_sync_conflict");
        throw new GitHubCommitSyncConflictError();
      }
      throw new GitHubCommitSyncError("SYNC_INTERNAL_ERROR");
    }

    let commitsDiscovered = 0;
    let commitsInserted = 0;
    this.logger.info("github_commit_sync_started", {
      syncRunId: syncRun.id,
      windowEnd: windowEnd.toISOString(),
      windowStart: windowStart.toISOString(),
    });

    try {
      await this.prisma.syncRun.update({
        where: { id: syncRun.id },
        data: { status: "running", startedAt },
      });

      const listed = await this.github.listRepositoryCommitSummaries(
        repository.gitHubConnection.providerInstallationId,
        repository.providerRepositoryId,
        { since: windowStart, until: windowEnd }
      );
      const discoveredShas = [
        ...new Set(listed.commits.map((commit) => commit.sha)),
      ];
      commitsDiscovered = discoveredShas.length;

      const existing =
        discoveredShas.length === 0
          ? []
          : await this.prisma.gitHubCommit.findMany({
              where: {
                connectedRepositoryId: repository.id,
                sha: { in: discoveredShas },
              },
              select: { sha: true },
            });
      const existingShas = new Set(existing.map((commit) => commit.sha));
      const newShas = discoveredShas.filter((sha) => !existingShas.has(sha));
      const details = await this.github.getRepositoryCommitDetails(
        repository.gitHubConnection.providerInstallationId,
        listed.repository,
        newShas
      );
      const detailsBySha = this.indexDetails(details, newShas);

      for (const sha of newShas) {
        const detail = detailsBySha.get(sha);
        if (!detail) {
          throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
        }
        try {
          await this.persistCommit(repository.id, detail);
          commitsInserted += 1;
        } catch (error) {
          if (!isUniqueConstraintError(error)) {
            throw error;
          }
        }
      }

      await this.updateReachability(
        repository.id,
        discoveredShas,
        windowStart,
        windowEnd
      );

      const finishedAt = this.clock();
      await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.connectedRepository.updateMany({
          where: {
            id: repository.id,
            status: "active",
            gitHubConnection: { status: "active" },
          },
          data: {
            owner: listed.repository.owner,
            name: listed.repository.name,
            defaultBranch: listed.repository.defaultBranch,
            isPrivate: listed.repository.isPrivate,
            lastSuccessfulSyncAt: windowEnd,
          },
        });
        if (updated.count !== 1) {
          throw new GitHubCommitSyncError(
            "CONNECTED_REPOSITORY_NOT_AVAILABLE"
          );
        }

        await transaction.syncRun.update({
          where: { id: syncRun.id },
          data: {
            status: "succeeded",
            finishedAt,
            commitsDiscovered,
            commitsInserted,
            failureCode: null,
          },
        });
      });

      this.logger.info("github_commit_sync_succeeded", {
        commitsDiscovered,
        commitsInserted,
        syncRunId: syncRun.id,
      });
      return {
        commitsDiscovered,
        commitsInserted,
        status: "succeeded",
        syncRunId: syncRun.id,
        windowEnd,
        windowStart,
      };
    } catch (error) {
      const failure = this.classifyFailure(error);
      const finishedAt = this.clock();
      try {
        await this.prisma.syncRun.updateMany({
          where: {
            id: syncRun.id,
            status: { in: ["queued", "running"] },
          },
          data: {
            status: failure.retryable
              ? "failed_retryable"
              : "failed_terminal",
            startedAt,
            finishedAt,
            commitsDiscovered,
            commitsInserted,
            failureCode: failure.failureCode,
          },
        });
      } catch {
        this.logger.errorEvent("github_commit_sync_finalize_failed", {
          failureCode: "SYNC_INTERNAL_ERROR",
          syncRunId: syncRun.id,
        });
      }
      this.logger.errorEvent("github_commit_sync_failed", {
        failureCode: failure.failureCode,
        syncRunId: syncRun.id,
      });
      throw new GitHubCommitSyncError(failure.failureCode);
    }
  }

  private async persistCommit(
    connectedRepositoryId: string,
    detail: GitHubCommitEvidence
  ): Promise<void> {
    await this.prisma.gitHubCommit.create({
      data: {
        connectedRepositoryId,
        sha: detail.sha,
        message: detail.message,
        authorName: detail.authorName,
        authorLogin: detail.authorLogin,
        authoredAt: detail.authoredAt,
        committedAt: detail.committedAt,
        parentShas: [...detail.parentShas],
        additions: detail.additions,
        deletions: detail.deletions,
        changedFiles: detail.changedFiles,
        files: {
          create: detail.files.map((file) => ({
            path: file.path,
            previousPath: file.previousPath,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
          })),
        },
      },
    });
  }

  private async loadRepository(
    connectedRepositoryId: string
  ): Promise<SyncRepository | null> {
    try {
      return await this.prisma.connectedRepository.findFirst({
        where: {
          id: connectedRepositoryId,
          status: "active",
          gitHubConnection: { status: "active" },
        },
        select: {
          id: true,
          providerRepositoryId: true,
          lastSuccessfulSyncAt: true,
          gitHubConnection: {
            select: { providerInstallationId: true },
          },
        },
      });
    } catch {
      this.logger.errorEvent("github_commit_sync_setup_failed", {
        failureCode: "SYNC_INTERNAL_ERROR",
      });
      throw new GitHubCommitSyncError("SYNC_INTERNAL_ERROR");
    }
  }

  private async findActiveRun(
    connectedRepositoryId: string
  ): Promise<{ readonly id: string } | null> {
    try {
      return await this.prisma.syncRun.findFirst({
        where: {
          connectedRepositoryId,
          status: { in: ["queued", "running"] },
        },
        select: { id: true },
      });
    } catch {
      this.logger.errorEvent("github_commit_sync_setup_failed", {
        failureCode: "SYNC_INTERNAL_ERROR",
      });
      throw new GitHubCommitSyncError("SYNC_INTERNAL_ERROR");
    }
  }

  private indexDetails(
    details: readonly GitHubCommitEvidence[],
    expectedShas: readonly string[]
  ): ReadonlyMap<string, GitHubCommitEvidence> {
    const expected = new Set(expectedShas);
    const indexed = new Map<string, GitHubCommitEvidence>();
    for (const detail of details) {
      if (!expected.has(detail.sha) || indexed.has(detail.sha)) {
        throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
      }
      indexed.set(detail.sha, detail);
    }
    if (indexed.size !== expected.size) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }
    return indexed;
  }

  private async updateReachability(
    connectedRepositoryId: string,
    discoveredShas: readonly string[],
    windowStart: Date,
    windowEnd: Date
  ): Promise<void> {
    const withinWindow = {
      connectedRepositoryId,
      committedAt: { gte: windowStart, lte: windowEnd },
    };

    await this.prisma.gitHubCommit.updateMany({
      where:
        discoveredShas.length === 0
          ? { ...withinWindow, orphanedAt: null }
          : {
              ...withinWindow,
              sha: { notIn: [...discoveredShas] },
              orphanedAt: null,
            },
      data: { orphanedAt: windowEnd },
    });

    if (discoveredShas.length > 0) {
      await this.prisma.gitHubCommit.updateMany({
        where: {
          connectedRepositoryId,
          sha: { in: [...discoveredShas] },
          orphanedAt: { not: null },
        },
        data: { orphanedAt: null },
      });
    }
  }

  private classifyFailure(error: unknown): {
    readonly failureCode: SyncFailureCode;
    readonly retryable: boolean;
  } {
    if (error instanceof GitHubIntegrationError) {
      return {
        failureCode: error.failureCode,
        retryable: error.retryable,
      };
    }
    if (error instanceof GitHubCommitSyncError) {
      return { failureCode: error.failureCode, retryable: false };
    }
    return { failureCode: "SYNC_INTERNAL_ERROR", retryable: true };
  }
}
