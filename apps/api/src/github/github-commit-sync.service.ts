import { createHash, randomUUID } from "node:crypto";

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
  | "SYNC_CANCELLED"
  | "SYNC_INTERNAL_ERROR";

export interface GitHubCommitSyncResult {
  readonly attemptCount: number;
  readonly commitsDiscovered: number;
  readonly commitsInserted: number;
  readonly status: "succeeded";
  readonly syncRunId: string;
  readonly windowEnd: Date;
  readonly windowStart: Date;
}

export interface QueuedGitHubSyncRun {
  readonly syncRunId: string;
}

interface SyncRepository {
  readonly gitHubConnection: {
    readonly providerInstallationId: bigint;
  };
  readonly id: string;
  readonly lastSuccessfulSyncAt: Date | null;
  readonly providerRepositoryId: bigint;
}

interface PreparedSyncRun {
  readonly attemptCount: number;
  readonly commitsDiscovered: number;
  readonly commitsInserted: number;
  readonly leaseToken: string;
  readonly repository: SyncRepository;
  readonly startedAt: Date;
  readonly syncRunId: string;
  readonly windowEnd: Date;
  readonly windowStart: Date;
}

export class GitHubCommitSyncError extends Error {
  constructor(
    readonly failureCode: SyncFailureCode,
    readonly attemptCount = 0,
    readonly retryAfterAt: Date | null = null
  ) {
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
    connectedRepositoryId: string,
    onQueued?: (syncRunId: string) => void
  ): Promise<GitHubCommitSyncResult> {
    const queued = await this.createQueuedRun(connectedRepositoryId);
    onQueued?.(queued.syncRunId);
    const startedAt = this.clock();
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(startedAt.getTime() + 15 * 60 * 1_000);
    await this.prisma.syncRun.update({
      where: { id: queued.syncRunId },
      data: {
        status: "running",
        startedAt,
        workerAttemptCount: { increment: 1 },
        leaseToken,
        leaseExpiresAt,
      },
    });

    return this.executePrepared({
      ...queued,
      attemptCount: 0,
      commitsDiscovered: 0,
      commitsInserted: 0,
      leaseToken,
      startedAt,
    });
  }

  async enqueue(
    connectedRepositoryId: string,
    windowEnd?: Date
  ): Promise<QueuedGitHubSyncRun> {
    const queued = await this.createQueuedRun(
      connectedRepositoryId,
      windowEnd
    );
    this.logger.info("github_commit_sync_queued", {
      syncRunId: queued.syncRunId,
    });
    return { syncRunId: queued.syncRunId };
  }

  async executeClaimed(
    syncRunId: string,
    leaseToken: string
  ): Promise<GitHubCommitSyncResult> {
    const claimed = await this.prisma.syncRun.findFirst({
      where: {
        id: syncRunId,
        status: "running",
        leaseToken,
        connectedRepository: {
          status: "active",
          gitHubConnection: { status: "active" },
        },
      },
      select: {
        id: true,
        attemptCount: true,
        commitsDiscovered: true,
        commitsInserted: true,
        startedAt: true,
        windowEnd: true,
        windowStart: true,
        connectedRepository: {
          select: {
            id: true,
            lastSuccessfulSyncAt: true,
            providerRepositoryId: true,
            gitHubConnection: {
              select: { providerInstallationId: true },
            },
          },
        },
      },
    });
    if (!claimed?.startedAt) {
      throw new GitHubCommitSyncError(
        "CONNECTED_REPOSITORY_NOT_AVAILABLE"
      );
    }

    return this.executePrepared({
      attemptCount: claimed.attemptCount,
      commitsDiscovered: claimed.commitsDiscovered,
      commitsInserted: claimed.commitsInserted,
      leaseToken,
      repository: claimed.connectedRepository,
      startedAt: claimed.startedAt,
      syncRunId: claimed.id,
      windowEnd: claimed.windowEnd,
      windowStart: claimed.windowStart,
    });
  }

  private async createQueuedRun(
    connectedRepositoryId: string,
    requestedWindowEnd?: Date
  ): Promise<
    Omit<
      PreparedSyncRun,
      | "attemptCount"
      | "commitsDiscovered"
      | "commitsInserted"
      | "leaseToken"
      | "startedAt"
    >
  > {
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

    const windowEnd = requestedWindowEnd ?? this.clock();
    const windowStart = repository.lastSuccessfulSyncAt
      ? new Date(
          repository.lastSuccessfulSyncAt.getTime() -
            incrementalSyncOverlapMs
        )
      : new Date(windowEnd.getTime() - initialSyncLookbackMs);
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

    return {
      repository,
      syncRunId: syncRun.id,
      windowEnd,
      windowStart,
    };
  }

  private async executePrepared(
    prepared: PreparedSyncRun
  ): Promise<GitHubCommitSyncResult> {
    const {
      leaseToken,
      repository,
      startedAt,
      syncRunId,
      windowEnd,
      windowStart,
    } = prepared;
    let commitsDiscovered = prepared.commitsDiscovered;
    let commitsInserted = prepared.commitsInserted;
    let attemptCount = prepared.attemptCount;
    this.logger.info("github_commit_sync_started", {
      syncRunId,
      windowEnd: windowEnd.toISOString(),
      windowStart: windowStart.toISOString(),
    });

    try {
      const listed = await this.github.listRepositoryCommitSummaries(
        repository.gitHubConnection.providerInstallationId,
        repository.providerRepositoryId,
        { since: windowStart, until: windowEnd }
      );
      attemptCount += listed.attemptCount;
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
      const detailResult = await this.github.getRepositoryCommitDetails(
        repository.gitHubConnection.providerInstallationId,
        listed.repository,
        newShas
      );
      attemptCount += detailResult.attemptCount;
      const detailsBySha = this.indexDetails(
        detailResult.commits,
        newShas
      );

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
        const completed = await transaction.syncRun.updateMany({
          where: {
            id: syncRunId,
            status: "running",
            leaseToken,
          },
          data: {
            status: "succeeded",
            finishedAt,
            commitsDiscovered,
            commitsInserted,
            attemptCount,
            retryAfterAt: null,
            failureCode: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (completed.count !== 1) {
          throw new GitHubCommitSyncError("SYNC_CANCELLED");
        }

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
      });

      this.logger.info("github_commit_sync_succeeded", {
        attemptCount,
        commitsDiscovered,
        commitsInserted,
        syncRunId,
      });
      return {
        attemptCount,
        commitsDiscovered,
        commitsInserted,
        status: "succeeded",
        syncRunId,
        windowEnd,
        windowStart,
      };
    } catch (error) {
      const failure = this.classifyFailure(error);
      attemptCount += failure.attemptCount;
      const finishedAt = this.clock();
      try {
        await this.prisma.syncRun.updateMany({
          where: {
            id: syncRunId,
            status: "running",
            leaseToken,
          },
          data: {
            status: failure.retryable
              ? "failed_retryable"
              : "failed_terminal",
            startedAt,
            finishedAt,
            commitsDiscovered,
            commitsInserted,
            attemptCount,
            retryAfterAt: failure.retryable
              ? failure.retryAfterAt
              : null,
            failureCode: failure.failureCode,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
      } catch {
        this.logger.errorEvent("github_commit_sync_finalize_failed", {
          failureCode: "SYNC_INTERNAL_ERROR",
          syncRunId,
        });
      }
      this.logger.errorEvent("github_commit_sync_failed", {
        attemptCount,
        failureCode: failure.failureCode,
        retryAfterAt: failure.retryAfterAt?.toISOString(),
        syncRunId,
      });
      throw new GitHubCommitSyncError(
        failure.failureCode,
        attemptCount,
        failure.retryable ? failure.retryAfterAt : null
      );
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
    readonly attemptCount: number;
    readonly failureCode: SyncFailureCode;
    readonly retryAfterAt: Date | null;
    readonly retryable: boolean;
  } {
    if (error instanceof GitHubIntegrationError) {
      return {
        attemptCount: error.attemptCount,
        failureCode: error.failureCode,
        retryAfterAt: error.retryAfterAt,
        retryable: error.retryable,
      };
    }
    if (error instanceof GitHubCommitSyncError) {
      return {
        attemptCount: error.attemptCount,
        failureCode: error.failureCode,
        retryAfterAt: error.retryAfterAt,
        retryable: false,
      };
    }
    return {
      attemptCount: 0,
      failureCode: "SYNC_INTERNAL_ERROR",
      retryAfterAt: null,
      retryable: true,
    };
  }
}
