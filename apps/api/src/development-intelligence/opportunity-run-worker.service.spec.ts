import { describe, expect, it, vi } from "vitest";

import type { StructuredLogger } from "../observability/structured-logger";
import { OpportunityRunWorkerService, defaultOpportunityRunWorkerOptions } from "./opportunity-run-worker.service";
import type { OpportunityRunService } from "./opportunity-run.service";

const now = new Date("2026-09-25T12:00:00.000Z");
const run = { opportunityRunId: "run-1", attemptCount: 1, leaseToken: "lease-1", recovered: false };

function harness(options: { claim?: typeof run | null; executeError?: Error } = {}) {
  const runs = {
    terminalizeExhausted: vi.fn().mockResolvedValue(0),
    terminalizeStaleActiveRuns: vi.fn().mockResolvedValue(0),
    terminalizeStaleInputs: vi.fn().mockResolvedValue(0),
    requeueEligible: vi.fn().mockResolvedValue(undefined),
    enqueueEligibleIntelligenceCompletion: vi.fn().mockResolvedValue(0),
    claimNext: vi.fn().mockResolvedValue(options.claim === undefined ? run : options.claim),
    executeClaimed: options.executeError ? vi.fn().mockRejectedValue(options.executeError) : vi.fn().mockResolvedValue(undefined),
    extendLease: vi.fn().mockResolvedValue(undefined),
    failClaimed: vi.fn().mockResolvedValue(undefined),
  };
  const logger = { info: vi.fn(), warnEvent: vi.fn(), errorEvent: vi.fn() };
  const worker = new OpportunityRunWorkerService(
    runs as unknown as OpportunityRunService,
    logger as unknown as StructuredLogger,
    () => now,
    defaultOpportunityRunWorkerOptions
  );
  return { logger, runs, worker };
}

describe("OpportunityRunWorkerService", () => {
  it("has no independent module-init polling hook", () => {
    const test = harness({ claim: null });
    expect("onModuleInit" in test.worker).toBe(false);
  });
  it("only runs when explicitly driven and processes one claimed run", async () => {
    const test = harness();
    expect(test.runs.enqueueEligibleIntelligenceCompletion).not.toHaveBeenCalled();
    await expect(test.worker.runOnce()).resolves.toBe(true);
    expect(test.runs.executeClaimed).toHaveBeenCalledWith("run-1", "lease-1");
    expect(test.runs.terminalizeStaleActiveRuns).toHaveBeenCalledOnce();
    expect(test.runs.terminalizeStaleInputs).toHaveBeenCalledOnce();
  });

  it("does not execute if no durable run can be claimed", async () => {
    const test = harness({ claim: null });
    await expect(test.worker.runOnce()).resolves.toBe(false);
    expect(test.runs.executeClaimed).not.toHaveBeenCalled();
  });

  it("discovers, claims, and completes an automatically enqueued run in one explicit tick", async () => {
    const test = harness();
    test.runs.enqueueEligibleIntelligenceCompletion.mockResolvedValueOnce(1);
    await expect(test.worker.runOnce()).resolves.toBe(true);
    expect(test.runs.enqueueEligibleIntelligenceCompletion).toHaveBeenCalledBefore(test.runs.claimNext);
    expect(test.runs.claimNext).toHaveBeenCalledBefore(test.runs.executeClaimed);
    expect(test.runs.executeClaimed).toHaveBeenCalledWith("run-1", "lease-1");
  });

  it("fences failed execution through the run service", async () => {
    const test = harness({ executeError: new Error("synthetic failure") });
    await test.worker.runOnce();
    expect(test.runs.failClaimed).toHaveBeenCalledWith(
      { id: "run-1", leaseToken: "lease-1", attemptCount: 1 },
      expect.any(Error),
      now
    );
  });

  it("waits for the active tick during graceful shutdown", async () => {
    let finish: (() => void) | undefined;
    const test = harness();
    test.runs.executeClaimed.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const tick = test.worker.runOnce();
    await vi.waitFor(() => expect(test.runs.executeClaimed).toHaveBeenCalledOnce());
    const shutdown = test.worker.onApplicationShutdown();
    await expect(test.worker.runOnce()).resolves.toBe(false);
    finish?.();
    await expect(tick).resolves.toBe(true);
    await expect(shutdown).resolves.toBeUndefined();
  });
});
