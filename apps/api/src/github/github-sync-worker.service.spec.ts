import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../database/prisma.service";
import type { StructuredLogger } from "../observability/structured-logger";
import type { IntelligencePipelineWorkerService } from "../development-intelligence/intelligence-pipeline-worker.service";
import {
  GitHubCommitSyncError,
  type GitHubCommitSyncService,
} from "./github-commit-sync.service";
import {
  defaultGitHubSyncWorkerOptions,
  GitHubSyncWorkerService,
  type GitHubSyncWorkerOptions,
} from "./github-sync-worker.service";

const syncRunId = "123e4567-e89b-42d3-a456-426614174000";
const repositoryId = "223e4567-e89b-42d3-a456-426614174000";
const leaseToken = "lease-fixture";
const now = new Date("2026-09-20T12:00:00.000Z");
const sensitiveMarker = "fixture-sensitive-marker";

function claim(
  overrides: Partial<{
    recovered: boolean;
    workerAttemptCount: number;
  }> = {}
) {
  return {
    syncRunId,
    leaseToken,
    recovered: overrides.recovered ?? false,
    workerAttemptCount: overrides.workerAttemptCount ?? 1,
  };
}

function harness(
  input: {
    readonly claimRows?: readonly ReturnType<typeof claim>[];
    readonly enabled?: boolean;
    readonly options?: Partial<GitHubSyncWorkerOptions>;
  } = {}
) {
  const prisma = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue(input.claimRows ?? []),
    connectedRepository: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    syncRun: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const sync = {
    enqueue: vi.fn().mockResolvedValue({ syncRunId }),
    executeClaimed: vi.fn().mockResolvedValue({
      attemptCount: 1,
      commitsDiscovered: 1,
      commitsInserted: 1,
      status: "succeeded",
      syncRunId,
      windowEnd: now,
      windowStart: new Date("2026-08-21T12:00:00.000Z"),
    }),
  };
  const logger = {
    info: vi.fn(),
    warnEvent: vi.fn(),
    errorEvent: vi.fn(),
  };
  const intelligenceWorker = {
    runOnce: vi.fn().mockResolvedValue(false),
  };
  const options = {
    ...defaultGitHubSyncWorkerOptions,
    heartbeatIntervalMs: 60_000,
    pollIntervalMs: 60_000,
    ...input.options,
  };
  const worker = new GitHubSyncWorkerService(
    prisma as unknown as PrismaService,
    sync as unknown as GitHubCommitSyncService,
    logger as unknown as StructuredLogger,
    () => new Date(now),
    options,
    input.enabled ?? true,
    intelligenceWorker as unknown as IntelligencePipelineWorkerService
  );
  return { intelligenceWorker, logger, options, prisma, sync, worker };
}

function rawSql(mock: ReturnType<typeof vi.fn>, callIndex: number): string {
  const template = mock.mock.calls[callIndex]?.[0] as
    | readonly string[]
    | undefined;
  return template?.join("?") ?? "";
}

describe("GitHubSyncWorkerService", () => {
  it("does not schedule a polling tick or invoke provider work when operational bootstrap disables workers", () => {
    vi.useFakeTimers();
    try {
      const { intelligenceWorker, logger, sync, worker } = harness({ enabled: false });
      worker.onModuleInit();
      expect(logger.info).not.toHaveBeenCalled();
      expect(sync.executeClaimed).not.toHaveBeenCalled();
      expect(intelligenceWorker.runOnce).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps normal production worker bootstrap enabled", async () => {
    vi.useFakeTimers();
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const { logger, worker } = harness({ enabled: true });
      worker.onModuleInit();
      expect(logger.info).toHaveBeenCalledWith("sync_worker_started");
      expect(vi.getTimerCount()).toBe(1);
      await worker.onApplicationShutdown();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      vi.useRealTimers();
    }
  });

  it("services durable intelligence work through the existing polling tick", async () => {
    const { intelligenceWorker, worker } = harness();
    intelligenceWorker.runOnce.mockResolvedValueOnce(true);
    await expect(worker.runOnce()).resolves.toBe(true);
    expect(intelligenceWorker.runOnce).toHaveBeenCalledOnce();
  });

  it("atomically claims queued work and invokes the existing sync engine", async () => {
    const { prisma, sync, worker } = harness({ claimRows: [claim()] });

    await expect(worker.runOnce()).resolves.toBe(true);

    expect(sync.executeClaimed).toHaveBeenCalledExactlyOnceWith(
      syncRunId,
      leaseToken
    );
    const sql = rawSql(prisma.$queryRaw, 0);
    expect(sql).toContain("FOR UPDATE OF sync_run SKIP LOCKED");
    expect(sql).toContain(`sync_run."status" = 'queued'`);
  });

  it("allows only one of two worker instances to claim the same run", async () => {
    const shared = harness();
    shared.prisma.$queryRaw
      .mockResolvedValueOnce([claim()])
      .mockResolvedValueOnce([]);
    const second = new GitHubSyncWorkerService(
      shared.prisma as unknown as PrismaService,
      shared.sync as unknown as GitHubCommitSyncService,
      shared.logger as unknown as StructuredLogger,
      () => new Date(now),
      shared.options,
      true
    );

    const results = await Promise.all([
      shared.worker.runOnce(),
      second.runOnce(),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(shared.sync.executeClaimed).toHaveBeenCalledOnce();
  });

  it("does not overlap polling ticks in one worker", async () => {
    let release!: () => void;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { sync, worker } = harness({ claimRows: [claim()] });
    sync.executeClaimed.mockReturnValue(completion);

    const first = worker.runOnce();
    await vi.waitFor(() =>
      expect(sync.executeClaimed).toHaveBeenCalledOnce()
    );
    await expect(worker.runOnce()).resolves.toBe(false);
    release();
    await first;
  });

  it("recovers an expired running lease using the same durable SyncRun", async () => {
    const { logger, sync, worker } = harness({
      claimRows: [claim({ recovered: true, workerAttemptCount: 2 })],
    });

    await worker.runOnce();

    expect(sync.executeClaimed).toHaveBeenCalledWith(syncRunId, leaseToken);
    expect(logger.warnEvent).toHaveBeenCalledWith("sync_run_recovered", {
      syncRunId,
    });
  });

  it("does not claim non-stale running or terminal work", async () => {
    const { prisma, sync, worker } = harness();

    await expect(worker.runOnce()).resolves.toBe(false);

    expect(sync.executeClaimed).not.toHaveBeenCalled();
    const sql = rawSql(prisma.$queryRaw, 0);
    expect(sql).toContain(`sync_run."leaseExpiresAt" <=`);
    expect(sql).not.toContain("failed_terminal");
    expect(sql).not.toContain("cancelled");
    expect(sql).not.toContain("succeeded");
  });

  it("makes retryable work eligible only after its durable retry boundary", async () => {
    const { prisma, worker } = harness();

    await worker.runOnce();

    const requeueSql = rawSql(prisma.$executeRaw, 3);
    expect(requeueSql).toContain(
      `sync_run."status" = 'failed_retryable'`
    );
    expect(requeueSql).toContain(`sync_run."retryAfterAt"`);
    expect(requeueSql).toContain("<= ?");
    expect(requeueSql).toContain("NOT EXISTS");
  });

  it("can execute the same retryable run after it becomes eligible", async () => {
    const { prisma, sync, worker } = harness();
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([claim({ workerAttemptCount: 2 })]);

    await expect(worker.runOnce()).resolves.toBe(false);
    await expect(worker.runOnce()).resolves.toBe(true);

    expect(sync.executeClaimed).toHaveBeenCalledExactlyOnceWith(
      syncRunId,
      leaseToken
    );
  });

  it("applies exponential local delay and a later provider retry boundary", async () => {
    const providerRetryAt = new Date("2026-09-20T13:00:00.000Z");
    const { prisma, sync, worker } = harness({
      claimRows: [claim({ workerAttemptCount: 2 })],
      options: { retryBaseDelayMs: 1_000 },
    });
    sync.executeClaimed.mockRejectedValue(
      new GitHubCommitSyncError(
        "GITHUB_RATE_LIMITED",
        3,
        providerRetryAt
      )
    );

    await worker.runOnce();

    expect(prisma.syncRun.updateMany).toHaveBeenCalledWith({
      where: { id: syncRunId, status: "failed_retryable" },
      data: { retryAfterAt: providerRetryAt },
    });
  });

  it("terminalizes a retryable run after the final worker attempt", async () => {
    const { prisma, sync, worker } = harness({
      claimRows: [claim({ workerAttemptCount: 3 })],
    });
    sync.executeClaimed.mockRejectedValue(
      new GitHubCommitSyncError("GITHUB_PROVIDER_UNAVAILABLE", 3)
    );

    await worker.runOnce();

    expect(prisma.syncRun.updateMany).toHaveBeenCalledWith({
      where: { id: syncRunId, status: "failed_retryable" },
      data: { status: "failed_terminal", retryAfterAt: null },
    });
  });

  it("cancels active runs whose repository or connection is inactive", async () => {
    const { prisma, worker } = harness();

    await worker.runOnce();

    const sql = rawSql(prisma.$executeRaw, 0);
    expect(sql).toContain(`"status" = 'cancelled'`);
    expect(sql).toContain(`repository."status" <> 'active'`);
    expect(sql).toContain(`connection."status" <> 'active'`);
  });

  it("cancels a retryable run superseded by a newer manual run", async () => {
    const { prisma, worker } = harness();

    await worker.runOnce();

    const sql = rawSql(prisma.$executeRaw, 1);
    expect(sql).toContain(`retryable."status" = 'failed_retryable'`);
    expect(sql).toContain(`"status" = 'cancelled'`);
    expect(sql).toContain(
      `newer."createdAt" > retryable."createdAt"`
    );
  });

  it("never automatically claims succeeded, terminal, or cancelled states", async () => {
    const { prisma, worker } = harness();

    await worker.runOnce();

    const sql = rawSql(prisma.$queryRaw, 0);
    expect(sql).toContain(`sync_run."status" = 'queued'`);
    expect(sql).toContain(`sync_run."status" = 'running'`);
    expect(sql).not.toMatch(/status" = '(succeeded|failed_terminal|cancelled)'/);
  });

  it("enqueues active repositories at most once per hourly cadence", async () => {
    const { prisma, sync, worker } = harness();
    prisma.connectedRepository.findMany.mockResolvedValue([
      { id: repositoryId },
    ]);

    await worker.runOnce();
    await worker.runOnce();

    expect(sync.enqueue).toHaveBeenCalledExactlyOnceWith(
      repositoryId,
      new Date("2026-09-20T12:00:00.000Z")
    );
  });

  it("does not automatically schedule a repository after terminal failure", async () => {
    const { prisma, sync, worker } = harness();
    prisma.connectedRepository.findMany.mockResolvedValue([]);

    await worker.runOnce();

    expect(sync.enqueue).not.toHaveBeenCalled();
    expect(prisma.connectedRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          syncRuns: {
            none: {
              OR: expect.arrayContaining([
                {
                  status: {
                    in: expect.arrayContaining(["failed_terminal"]),
                  },
                },
              ]),
            },
          },
        }),
      })
    );
  });

  it("uses a bounded active-repository scheduling query", async () => {
    const { options, prisma, worker } = harness();

    await worker.runOnce();

    expect(prisma.connectedRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: options.scheduleBatchSize,
        where: {
          status: "active",
          gitHubConnection: { status: "active" },
          syncRuns: expect.any(Object),
        },
      })
    );
  });

  it("stops claiming new work after graceful shutdown begins", async () => {
    const { prisma, sync, worker } = harness({ claimRows: [claim()] });

    await worker.onApplicationShutdown();
    await expect(worker.runOnce()).resolves.toBe(false);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(sync.executeClaimed).not.toHaveBeenCalled();
  });

  it("logs only normalized failure metadata and never provider secrets", async () => {
    const { logger, sync, worker } = harness({
      claimRows: [claim()],
    });
    sync.executeClaimed.mockRejectedValue(
      Object.assign(
        new GitHubCommitSyncError("GITHUB_PROVIDER_UNAVAILABLE", 3),
        { upstreamDetail: sensitiveMarker }
      )
    );

    await worker.runOnce();

    const serialized = JSON.stringify(logger.errorEvent.mock.calls);
    expect(serialized).toContain("GITHUB_PROVIDER_UNAVAILABLE");
    expect(serialized).not.toContain(sensitiveMarker);
  });
});
