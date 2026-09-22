import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../database/prisma.service";
import type { StructuredLogger } from "../observability/structured-logger";
import {
  IntelligencePipelineWorkerService,
  type IntelligencePipelineWorkerOptions,
} from "./intelligence-pipeline-worker.service";
import {
  IntelligencePipelineError,
  type IntelligencePipelineService,
} from "./intelligence-pipeline.service";

const now = new Date("2026-09-22T20:00:00.000Z");
const runId = "40000000-0000-4000-8000-000000000001";
const leaseToken = "50000000-0000-4000-8000-000000000001";

function claim(overrides: Partial<{
  attemptCount: number;
  recovered: boolean;
}> = {}) {
  return {
    attemptCount: overrides.attemptCount ?? 1,
    intelligenceRunId: runId,
    leaseToken,
    recovered: overrides.recovered ?? false,
  };
}

function harness(options: {
  claimRows?: ReturnType<typeof claim>[];
  executeError?: Error;
  queued?: boolean;
} = {}) {
  const logger = {
    errorEvent: vi.fn(),
    info: vi.fn(),
    warnEvent: vi.fn(),
  };
  const pipeline = {
    enqueueEligibleCompletedSync: vi
      .fn()
      .mockResolvedValue(options.queued ?? false),
    executeClaimed: options.executeError
      ? vi.fn().mockRejectedValue(options.executeError)
      : vi.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue(options.claimRows ?? []),
    intelligenceRun: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const workerOptions: IntelligencePipelineWorkerOptions = {
    heartbeatIntervalMs: 60_000,
    leaseDurationMs: 15 * 60_000,
    maxAttempts: 3,
    retryBaseDelayMs: 60_000,
  };
  const worker = new IntelligencePipelineWorkerService(
    prisma as unknown as PrismaService,
    pipeline as unknown as IntelligencePipelineService,
    logger as unknown as StructuredLogger,
    () => now,
    workerOptions
  );
  return { logger, pipeline, prisma, worker, workerOptions };
}

describe("IntelligencePipelineWorkerService", () => {
  it("atomically claims queued work and executes the pipeline", async () => {
    const test = harness({ claimRows: [claim()] });
    await expect(test.worker.runOnce()).resolves.toBe(true);
    expect(test.pipeline.executeClaimed).toHaveBeenCalledWith(runId, leaseToken);
    expect(String(test.prisma.$queryRaw.mock.calls[0]?.[0])).toContain(
      "SKIP LOCKED"
    );
  });

  it("allows only one of two workers to claim one durable boundary", async () => {
    const shared = harness();
    shared.prisma.$queryRaw
      .mockResolvedValueOnce([claim()])
      .mockResolvedValueOnce([]);
    const second = new IntelligencePipelineWorkerService(
      shared.prisma as unknown as PrismaService,
      shared.pipeline as unknown as IntelligencePipelineService,
      shared.logger as unknown as StructuredLogger,
      () => now,
      shared.workerOptions
    );
    const results = await Promise.all([
      shared.worker.runOnce(),
      second.runOnce(),
    ]);
    expect(results).toEqual([true, false]);
    expect(shared.pipeline.executeClaimed).toHaveBeenCalledOnce();
  });

  it("reports stale running work as recovered", async () => {
    const test = harness({ claimRows: [claim({ recovered: true, attemptCount: 2 })] });
    await test.worker.runOnce();
    expect(test.logger.warnEvent).toHaveBeenCalledWith(
      "intelligence_run_recovered",
      { intelligenceRunId: runId }
    );
  });

  it("defers a transient failure with exponential backoff", async () => {
    const test = harness({
      claimRows: [claim({ attemptCount: 2 })],
      executeError: new IntelligencePipelineError(
        "INTELLIGENCE_GROUP_RETRYABLE_FAILURE",
        true
      ),
    });
    await test.worker.runOnce();
    expect(test.prisma.intelligenceRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed_retryable",
          retryAfterAt: new Date(now.getTime() + 120_000),
        }),
      })
    );
  });

  it("respects a provider Retry-After later than local backoff", async () => {
    const providerRetryAt = new Date("2026-09-22T22:00:00.000Z");
    const test = harness({
      claimRows: [claim()],
      executeError: new IntelligencePipelineError(
        "INTELLIGENCE_GROUP_RETRYABLE_FAILURE",
        true,
        providerRetryAt
      ),
    });
    await test.worker.runOnce();
    expect(test.prisma.intelligenceRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ retryAfterAt: providerRetryAt }),
      })
    );
  });

  it("does not retry a terminal interpretation failure", async () => {
    const test = harness({
      claimRows: [claim()],
      executeError: new IntelligencePipelineError(
        "INTELLIGENCE_GROUP_TERMINAL_FAILURE"
      ),
    });
    await test.worker.runOnce();
    expect(test.prisma.intelligenceRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed_terminal",
          retryAfterAt: null,
        }),
      })
    );
  });

  it("terminalizes a retryable failure at the third attempt", async () => {
    const test = harness({
      claimRows: [claim({ attemptCount: 3 })],
      executeError: new IntelligencePipelineError(
        "INTELLIGENCE_GROUP_RETRYABLE_FAILURE",
        true
      ),
    });
    await test.worker.runOnce();
    expect(test.prisma.intelligenceRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed_terminal" }),
      })
    );
  });

  it("requeues only retryable work whose durable delay has elapsed", async () => {
    const test = harness();
    await test.worker.runOnce();
    expect(test.prisma.intelligenceRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "failed_retryable",
          OR: [{ retryAfterAt: null }, { retryAfterAt: { lte: now } }],
        }),
      })
    );
  });

  it("preserves queued work when no worker can claim it", async () => {
    const test = harness({ queued: true });
    await expect(test.worker.runOnce()).resolves.toBe(true);
    expect(test.pipeline.executeClaimed).not.toHaveBeenCalled();
  });

  it("does not overlap two ticks in one process", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const test = harness({ claimRows: [claim()] });
    test.pipeline.executeClaimed.mockReturnValueOnce(pending);
    const first = test.worker.runOnce();
    await vi.waitFor(() =>
      expect(test.pipeline.executeClaimed).toHaveBeenCalledOnce()
    );
    await expect(test.worker.runOnce()).resolves.toBe(false);
    release();
    await first;
  });

  it("stops claiming after graceful shutdown begins", async () => {
    const test = harness({ claimRows: [claim()] });
    await test.worker.onApplicationShutdown();
    await expect(test.worker.runOnce()).resolves.toBe(false);
    expect(test.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("runs automatic eligibility discovery before claiming", async () => {
    const test = harness();
    await test.worker.runOnce();
    expect(test.pipeline.enqueueEligibleCompletedSync).toHaveBeenCalledOnce();
    expect(
      test.pipeline.enqueueEligibleCompletedSync.mock.invocationCallOrder[0]
    ).toBeLessThan(test.prisma.$queryRaw.mock.invocationCallOrder[0] ?? Infinity);
  });

  it("logs only safe run metadata on failure", async () => {
    const test = harness({
      claimRows: [claim()],
      executeError: new IntelligencePipelineError(
        "INTELLIGENCE_GROUP_TERMINAL_FAILURE"
      ),
    });
    await test.worker.runOnce();
    const serialized = JSON.stringify({
      error: test.logger.errorEvent.mock.calls,
      info: test.logger.info.mock.calls,
      warn: test.logger.warnEvent.mock.calls,
    });
    expect(serialized).not.toMatch(
      /commit message|pull request|file path|prompt|raw response|leaseToken/i
    );
    expect(serialized).toContain(runId);
  });

  it("terminalizes exhausted stale work for process-crash recovery", async () => {
    const test = harness();
    await test.worker.runOnce();
    expect(String(test.prisma.$executeRaw.mock.calls[0]?.[0])).toContain(
      "INTELLIGENCE_RETRY_EXHAUSTED"
    );
  });
});
