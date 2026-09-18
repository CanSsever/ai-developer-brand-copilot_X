import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../database/prisma.service";
import type { StructuredLogger } from "../observability/structured-logger";
import { GitHubIntegrationError } from "./github-api.service";
import type { GitHubApiService } from "./github-api.service";
import {
  GitHubCommitSyncConflictError,
  GitHubCommitSyncError,
  GitHubCommitSyncService,
  incrementalSyncOverlapMs,
  initialSyncLookbackMs,
} from "./github-commit-sync.service";
import type {
  AuthorizedGitHubRepository,
  GitHubCommitEvidence,
} from "./github.types";

const repositoryId = "123e4567-e89b-42d3-a456-426614174000";
const otherRepositoryId = "223e4567-e89b-42d3-a456-426614174000";
const syncRunId = "323e4567-e89b-42d3-a456-426614174000";
const firstSha = "1".padStart(40, "0");
const secondSha = "2".padStart(40, "0");
const ephemeralToken = "ephemeral-installation-token-must-not-persist";
const privateMessage = "synthetic private message must not be logged";

const providerRepository: AuthorizedGitHubRepository = {
  id: 99n,
  owner: "synthetic-owner",
  name: "synthetic-repository",
  defaultBranch: "main",
  isPrivate: true,
};

function evidence(sha: string): GitHubCommitEvidence {
  return {
    sha,
    message: privateMessage,
    authorName: "Synthetic Author",
    authorLogin: "synthetic-login",
    authoredAt: new Date("2026-09-18T10:00:00.000Z"),
    committedAt: new Date("2026-09-18T10:01:00.000Z"),
    parentShas: ["f".repeat(40)],
    additions: 7,
    deletions: 3,
    changedFiles: 1,
    files: [
      {
        path: "src/synthetic-file.ts",
        previousPath: null,
        status: "modified",
        additions: 7,
        deletions: 3,
        changes: 10,
      },
    ],
  };
}

function harness(options: {
  readonly connectedRepositoryId?: string;
  readonly lastSuccessfulSyncAt?: Date | null;
} = {}) {
  const connectedRepositoryId =
    options.connectedRepositoryId ?? repositoryId;
  const prisma = {
    connectedRepository: {
      findFirst: vi.fn().mockResolvedValue({
        id: connectedRepositoryId,
        providerRepositoryId: 99n,
        lastSuccessfulSyncAt: options.lastSuccessfulSyncAt ?? null,
        gitHubConnection: { providerInstallationId: 42n },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    syncRun: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: syncRunId }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    gitHubCommit: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "commit-record-id" }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (transaction: typeof prisma) => Promise<unknown>) =>
      callback(prisma)
  );

  const github = {
    listRepositoryCommitSummaries: vi.fn().mockResolvedValue({
      repository: providerRepository,
      commits: [{ sha: firstSha }],
    }),
    getRepositoryCommitDetails: vi
      .fn()
      .mockResolvedValue([evidence(firstSha)]),
  };
  const logger = {
    info: vi.fn(),
    warnEvent: vi.fn(),
    errorEvent: vi.fn(),
  };
  const baseTime = new Date("2026-09-18T12:00:00.000Z").getTime();
  let clockCalls = 0;
  const clock = vi.fn(
    () => new Date(baseTime + clockCalls++ * 60 * 1_000)
  );
  const service = new GitHubCommitSyncService(
    prisma as unknown as PrismaService,
    github as unknown as GitHubApiService,
    logger as unknown as StructuredLogger,
    clock
  );

  return { clock, github, logger, prisma, service };
}

describe("GitHubCommitSyncService", () => {
  it("inserts unseen commit and file evidence, then completes the SyncRun atomically", async () => {
    const { github, logger, prisma, service } = harness();

    const result = await service.synchronize(repositoryId);

    expect(result).toMatchObject({
      status: "succeeded",
      syncRunId,
      commitsDiscovered: 1,
      commitsInserted: 1,
    });
    expect(prisma.syncRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          connectedRepositoryId: repositoryId,
          status: "queued",
          cursorVersion: 1,
          idempotencyKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      })
    );
    const expectedIdempotencyKey = createHash("sha256")
      .update(
        [
          repositoryId,
          "2026-08-19T12:00:00.000Z",
          "2026-09-18T12:00:00.000Z",
          "1",
        ].join("\0")
      )
      .digest("hex");
    expect(
      prisma.syncRun.create.mock.calls[0]?.[0].data.idempotencyKey
    ).toBe(expectedIdempotencyKey);
    expect(prisma.syncRun.update).toHaveBeenCalledWith({
      where: { id: syncRunId },
      data: {
        status: "running",
        startedAt: new Date("2026-09-18T12:01:00.000Z"),
      },
    });
    expect(github.listRepositoryCommitSummaries).toHaveBeenCalledWith(
      42n,
      99n,
      {
        since: new Date("2026-08-19T12:00:00.000Z"),
        until: new Date("2026-09-18T12:00:00.000Z"),
      }
    );
    expect(prisma.gitHubCommit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        connectedRepositoryId: repositoryId,
        sha: firstSha,
        message: privateMessage,
        additions: 7,
        deletions: 3,
        changedFiles: 1,
        files: {
          create: [
            {
              path: "src/synthetic-file.ts",
              previousPath: null,
              status: "modified",
              additions: 7,
              deletions: 3,
              changes: 10,
            },
          ],
        },
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(
      github.listRepositoryCommitSummaries.mock.invocationCallOrder[0]
    ).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]!);
    expect(prisma.connectedRepository.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          owner: providerRepository.owner,
          name: providerRepository.name,
          defaultBranch: providerRepository.defaultBranch,
          lastSuccessfulSyncAt: new Date("2026-09-18T12:00:00.000Z"),
        }),
      })
    );
    expect(prisma.syncRun.update).toHaveBeenLastCalledWith({
      where: { id: syncRunId },
      data: {
        status: "succeeded",
        finishedAt: new Date("2026-09-18T12:02:00.000Z"),
        commitsDiscovered: 1,
        commitsInserted: 1,
        failureCode: null,
      },
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(privateMessage);
  });

  it("uses the PDR 30-day boundary for an initial synchronization", async () => {
    const { prisma, service } = harness();

    const result = await service.synchronize(repositoryId);
    expect(result.windowEnd.getTime() - result.windowStart.getTime()).toBe(
      initialSyncLookbackMs
    );
    expect(prisma.syncRun.create.mock.calls[0]?.[0].data.windowStart).toEqual(
      result.windowStart
    );
  });

  it("uses a 24-hour overlap from the last successful boundary", async () => {
    const lastSuccessfulSyncAt = new Date("2026-09-18T08:00:00.000Z");
    const { github, service } = harness({ lastSuccessfulSyncAt });

    const result = await service.synchronize(repositoryId);

    expect(result.windowStart).toEqual(
      new Date(lastSuccessfulSyncAt.getTime() - incrementalSyncOverlapMs)
    );
    expect(
      github.listRepositoryCommitSummaries.mock.calls[0]?.[2].until
    ).toEqual(result.windowEnd);
  });

  it("re-reads an overlap without duplicating commits or file rows", async () => {
    const { github, prisma, service } = harness({
      lastSuccessfulSyncAt: new Date("2026-09-18T08:00:00.000Z"),
    });
    prisma.gitHubCommit.findMany.mockResolvedValue([{ sha: firstSha }]);
    github.getRepositoryCommitDetails.mockResolvedValue([]);

    const result = await service.synchronize(repositoryId);

    expect(result).toMatchObject({
      commitsDiscovered: 1,
      commitsInserted: 0,
    });
    expect(github.getRepositoryCommitDetails).toHaveBeenCalledWith(
      42n,
      providerRepository,
      []
    );
    expect(prisma.gitHubCommit.create).not.toHaveBeenCalled();
  });

  it("scopes SHA lookup to the connected repository so the same SHA remains valid elsewhere", async () => {
    const { prisma, service } = harness({
      connectedRepositoryId: otherRepositoryId,
    });

    await service.synchronize(otherRepositoryId);

    expect(prisma.gitHubCommit.findMany).toHaveBeenCalledWith({
      where: {
        connectedRepositoryId: otherRepositoryId,
        sha: { in: [firstSha] },
      },
      select: { sha: true },
    });
    expect(prisma.gitHubCommit.create.mock.calls[0]?.[0].data).toMatchObject({
      connectedRepositoryId: otherRepositoryId,
      sha: firstSha,
    });
  });

  it("reports discovered and inserted counts independently", async () => {
    const { github, prisma, service } = harness();
    github.listRepositoryCommitSummaries.mockResolvedValue({
      repository: providerRepository,
      commits: [{ sha: firstSha }, { sha: secondSha }],
    });
    prisma.gitHubCommit.findMany.mockResolvedValue([{ sha: firstSha }]);
    github.getRepositoryCommitDetails.mockResolvedValue([
      evidence(secondSha),
    ]);

    const result = await service.synchronize(repositoryId);

    expect(result).toMatchObject({
      commitsDiscovered: 2,
      commitsInserted: 1,
    });
    expect(prisma.syncRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commitsDiscovered: 2,
          commitsInserted: 1,
        }),
      })
    );
  });

  it("marks missing in-window commits orphaned and restores reachable commits", async () => {
    const { prisma, service } = harness();

    await service.synchronize(repositoryId);

    expect(prisma.gitHubCommit.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        connectedRepositoryId: repositoryId,
        committedAt: {
          gte: new Date("2026-08-19T12:00:00.000Z"),
          lte: new Date("2026-09-18T12:00:00.000Z"),
        },
        sha: { notIn: [firstSha] },
        orphanedAt: null,
      },
      data: { orphanedAt: new Date("2026-09-18T12:00:00.000Z") },
    });
    expect(prisma.gitHubCommit.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        connectedRepositoryId: repositoryId,
        sha: { in: [firstSha] },
        orphanedAt: { not: null },
      },
      data: { orphanedAt: null },
    });
  });

  it("fails safely before provider access when another run is active", async () => {
    const { github, prisma, service } = harness();
    prisma.syncRun.findFirst.mockResolvedValue({ id: "active-run" });

    await expect(service.synchronize(repositoryId)).rejects.toBeInstanceOf(
      GitHubCommitSyncConflictError
    );
    expect(prisma.syncRun.create).not.toHaveBeenCalled();
    expect(github.listRepositoryCommitSummaries).not.toHaveBeenCalled();
  });

  it("uses the database unique constraint as the active-run race backstop", async () => {
    const { github, prisma, service } = harness();
    prisma.syncRun.create.mockRejectedValue({ code: "P2002" });

    await expect(service.synchronize(repositoryId)).rejects.toMatchObject({
      failureCode: "SYNC_ALREADY_ACTIVE",
    });
    expect(github.listRepositoryCommitSummaries).not.toHaveBeenCalled();
  });

  it("records a retryable provider failure and never advances the success boundary", async () => {
    const { github, logger, prisma, service } = harness();
    github.listRepositoryCommitSummaries.mockRejectedValue(
      new GitHubIntegrationError("GITHUB_PROVIDER_UNAVAILABLE", true)
    );

    await expect(service.synchronize(repositoryId)).rejects.toMatchObject({
      message: "GitHub commit synchronization failed",
      failureCode: "GITHUB_PROVIDER_UNAVAILABLE",
    });
    expect(prisma.syncRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: syncRunId,
        status: { in: ["queued", "running"] },
      },
      data: {
        status: "failed_retryable",
        startedAt: new Date("2026-09-18T12:01:00.000Z"),
        finishedAt: new Date("2026-09-18T12:02:00.000Z"),
        commitsDiscovered: 0,
        commitsInserted: 0,
        failureCode: "GITHUB_PROVIDER_UNAVAILABLE",
      },
    });
    expect(prisma.connectedRepository.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.errorEvent.mock.calls)).not.toContain(
      ephemeralToken
    );
  });

  it("records invalid provider evidence as a terminal safe failure", async () => {
    const { github, prisma, service } = harness();
    github.getRepositoryCommitDetails.mockRejectedValue(
      new GitHubIntegrationError("GITHUB_RESPONSE_INVALID")
    );

    await expect(service.synchronize(repositoryId)).rejects.toBeInstanceOf(
      GitHubCommitSyncError
    );
    expect(prisma.syncRun.updateMany.mock.calls[0]?.[0].data).toMatchObject({
      status: "failed_terminal",
      failureCode: "GITHUB_RESPONSE_INVALID",
      commitsDiscovered: 1,
      commitsInserted: 0,
    });
    expect(prisma.connectedRepository.updateMany).not.toHaveBeenCalled();
  });

  it("loads immutable repository and installation identities from persistence", async () => {
    const { github, prisma, service } = harness();

    await service.synchronize(repositoryId);

    expect(prisma.connectedRepository.findFirst).toHaveBeenCalledWith({
      where: {
        id: repositoryId,
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
    expect(github.listRepositoryCommitSummaries).toHaveBeenCalledWith(
      42n,
      99n,
      expect.any(Object)
    );
  });

  it("never serializes an ephemeral token into persistence or safe errors", async () => {
    const { prisma, service } = harness();

    const result = await service.synchronize(repositoryId);
    const persistenceCalls = JSON.stringify({
      syncRunCreate: prisma.syncRun.create.mock.calls,
      syncRunUpdate: prisma.syncRun.update.mock.calls,
      commitCreate: prisma.gitHubCommit.create.mock.calls,
      repositoryUpdate: prisma.connectedRepository.updateMany.mock.calls,
    });

    expect(persistenceCalls).not.toContain(ephemeralToken);
    expect(JSON.stringify(result)).not.toContain(ephemeralToken);
  });

  it("converts setup persistence failures into a safe internal error", async () => {
    const { logger, prisma, service } = harness();
    prisma.connectedRepository.findFirst.mockRejectedValue(
      new Error("postgresql://credential-bearing-internal-detail")
    );

    await expect(service.synchronize(repositoryId)).rejects.toMatchObject({
      message: "GitHub commit synchronization failed",
      failureCode: "SYNC_INTERNAL_ERROR",
    });
    expect(JSON.stringify(logger.errorEvent.mock.calls)).not.toContain(
      "credential-bearing-internal-detail"
    );
    expect(prisma.syncRun.create).not.toHaveBeenCalled();
  });
});
