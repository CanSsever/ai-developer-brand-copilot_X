import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../database/prisma.service";
import type { StructuredLogger } from "../observability/structured-logger";
import type { ContentOpportunityScoringService } from "./content-opportunity-scoring.service";
import { developerDayWindow } from "./developer-day";
import type { IntelligencePipelineService } from "./intelligence-pipeline.service";
import { OpportunityDetectionError, type OpportunityDetectionService } from "./opportunity-detection.service";
import { fingerprintPhase3OpportunityInput, type CanonicalPhase3OpportunityInput } from "./phase3-opportunity-input";
import type { Phase3OpportunityInputSelectorService } from "./phase3-opportunity-input-selector.service";
import { OpportunityRunError, OpportunityRunService } from "./opportunity-run.service";

const now = new Date("2026-09-25T12:00:00.000Z");
const boundary = new Date("2026-09-25T10:00:00.000Z");
const projectId = "323e4567-e89b-42d3-a456-426614174000";
const userId = "323e4567-e89b-42d3-a456-426614174111";
const sourceId = "323e4567-e89b-42d3-a456-426614174222";
const eventId = "323e4567-e89b-42d3-a456-426614174333";

function input(title = "Safe orchestration"): CanonicalPhase3OpportunityInput {
  return {
    selectionVersion: "phase3-opportunity-input-v1", projectId, timezone: "Europe/Berlin",
    evaluationBoundary: boundary.toISOString(), developerDay: "2026-09-25", projectState: null,
    developmentEvents: [{ developmentEventId: eventId, eventKey: "event-key", inputFingerprint: "a".repeat(64),
      extractionVersion: "event-v1", type: "feature_completed", status: "active", title,
      summary: "A bounded synthetic event.", importanceScore: 0.9, contentPotentialScore: 0.9,
      confidence: 0.9, occurredAt: boundary.toISOString(), technologies: ["TypeScript"],
      relatedFeatureIds: ["feature-1"], supportingEvidenceKinds: ["commit"],
      truncated: { title: false, summary: false, technologies: false, relatedFeatureIds: false } }],
    opportunityHistory: [], truncation: { developmentEvents: false, opportunityHistory: false,
      activeFeatures: false, completedFeatures: false, recentMilestones: false,
      projectTechnologies: false, stateTextFields: 0 },
  };
}

function executionHarness(options: { detectionError?: Error; scoreError?: Error; candidates?: number;
  identity?: Partial<{ detectorVersion: string; extractionVersion: string; modelConfigurationFingerprint: string;
    promptVersion: string; schemaVersion: string; validationVersion: string }> } = {}) {
  const selected = input();
  const fingerprint = fingerprintPhase3OpportunityInput(selected);
  const run = { id: "run-1", projectId, sourceIntelligenceRunId: sourceId,
    processingVersion: "", expectedInputFingerprint: fingerprint, evaluationBoundary: boundary,
    project: { userId, timezone: "Europe/Berlin" } };
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const findFirst = vi.fn(async (args: { select?: { project?: unknown } }) => args.select?.project ? run : { id: run.id });
  const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ id: sourceId }]),
    opportunityRun: { findFirst, updateMany, findMany: vi.fn().mockResolvedValue([]) } };
  const selector = { select: vi.fn().mockResolvedValue({ input: selected, inputFingerprint: fingerprint }) };
  const candidates = Array.from({ length: options.candidates ?? 1 }, () => ({ eventIds: [eventId],
    opportunityType: "feature_showcase" as const, title: "A result", recommendedFormat: "technical_breakdown" as const,
    topicDescriptor: "safe orchestration", confidence: 0.9 }));
  const detectionOutcome = { candidates, inputFingerprint: fingerprint, execution: { aiExecutionId: "ai-1",
    opportunityDetectionResultId: "result-1", model: "fake", modelConfigurationFingerprint: "b".repeat(64),
    promptVersion: "prompt-v1", schemaVersion: "schema-v1", extractionVersion: "extract-v1",
    detectorVersion: "detector-v1", reused: false, initialAttemptCount: 1, repairAttemptCount: 0 } };
  const detection = { getProcessingIdentity: vi.fn().mockReturnValue({ detectorVersion: "detector-v1",
    extractionVersion: "extract-v1", inputSelectionVersion: "phase3-opportunity-input-v1",
    modelConfigurationFingerprint: "b".repeat(64), promptVersion: "prompt-v1", schemaVersion: "schema-v1",
    validationVersion: "validation-v1", ...options.identity }), detect: options.detectionError
      ? vi.fn().mockRejectedValue(options.detectionError) : vi.fn().mockResolvedValue(detectionOutcome) };
  const decisions = candidates.map(() => ({ shouldPost: true }));
  const scoring = { scoreAndPersist: options.scoreError ? vi.fn().mockRejectedValue(options.scoreError)
    : vi.fn().mockResolvedValue({ decisions, createdOpportunityIds: candidates.map((_, i) => `created-${i}`), reusedOpportunityIds: [] }) };
  const intelligence = { versions: { processingVersion: "phase2-current" } };
  const logger = { info: vi.fn(), warnEvent: vi.fn(), errorEvent: vi.fn() };
  const service = new OpportunityRunService(prisma as unknown as PrismaService,
    selector as unknown as Phase3OpportunityInputSelectorService, detection as unknown as OpportunityDetectionService,
    scoring as unknown as ContentOpportunityScoringService, intelligence as unknown as IntelligencePipelineService,
    logger as unknown as StructuredLogger, () => now);
  run.processingVersion = service.processingIdentity.processingVersion;
  return { detection, detectionOutcome, fingerprint, logger, prisma, run, scoring, selected, selector, service, updateMany };
}

describe("OpportunityRunService execution", () => {
  it("changes processingVersion for every material Task 3.4 identity component", () => {
    const baseline = executionHarness().service.processingIdentity.processingVersion;
    for (const identity of [{ detectorVersion: "detector-v2" }, { extractionVersion: "extract-v2" },
      { modelConfigurationFingerprint: "c".repeat(64) }, { promptVersion: "prompt-v2" },
      { schemaVersion: "schema-v2" }, { validationVersion: "validation-v2" }]) {
      expect(executionHarness({ identity }).service.processingIdentity.processingVersion).not.toBe(baseline);
    }
  });
  it("uses the stored boundary and the same canonical input through detection and scoring", async () => {
    const test = executionHarness();
    await test.service.executeClaimed("run-1", "lease-1");
    expect(test.selector.select).toHaveBeenCalledWith(userId, projectId, boundary);
    expect(test.detection.detect).toHaveBeenCalledWith(userId, projectId, boundary);
    expect(test.scoring.scoreAndPersist).toHaveBeenCalledWith(expect.objectContaining({ input: test.selected,
      task33InputFingerprint: test.fingerprint, aiExecutionId: "ai-1" }));
    expect(test.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: "run-1", status: "running", leaseToken: "lease-1" },
      data: expect.objectContaining({ status: "succeeded", candidateCount: 1, recommendedCount: 1,
        suppressedCount: 0, createdOpportunityCount: 1, reusedOpportunityCount: 0 }) }));
  });

  it("fails closed on a stale Task 3.3 fingerprint before detection", async () => {
    const test = executionHarness();
    test.selector.select.mockResolvedValueOnce({ input: input("changed"), inputFingerprint: "c".repeat(64) });
    await expect(test.service.executeClaimed("run-1", "lease-1")).rejects.toMatchObject({ failureCode: "OPPORTUNITY_INPUT_STALE" });
    expect(test.detection.detect).not.toHaveBeenCalled();
  });

  it("preserves a later provider retryAfterAt over exponential backoff", async () => {
    const providerRetryAt = new Date("2026-09-25T14:00:00.000Z");
    const test = executionHarness({ detectionError: new OpportunityDetectionError("AI_RATE_LIMITED", true, providerRetryAt) });
    let failure: unknown;
    try { await test.service.executeClaimed("run-1", "lease-1"); } catch (error) { failure = error; }
    await test.service.failClaimed({ id: "run-1", leaseToken: "lease-1", attemptCount: 1 }, failure, now);
    expect(test.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "failed_retryable", retryAfterAt: providerRetryAt }) }));
  });

  it("uses bounded local backoff for transient network failure", async () => {
    const test = executionHarness({ detectionError: new OpportunityDetectionError("AI_NETWORK_FAILURE", true) });
    let failure: unknown;
    try { await test.service.executeClaimed("run-1", "lease-1"); } catch (error) { failure = error; }
    await test.service.failClaimed({ id: "run-1", leaseToken: "lease-1", attemptCount: 2 }, failure, now);
    expect(test.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "failed_retryable", retryAfterAt: new Date(now.getTime() + 120_000) }) }));
  });

  it("defers AI budget exhaustion to the next Project developer-day boundary", async () => {
    const test = executionHarness({ detectionError: new OpportunityDetectionError("AI_BUDGET_EXHAUSTED") });
    let failure: unknown;
    try { await test.service.executeClaimed("run-1", "lease-1"); } catch (error) { failure = error; }
    await test.service.failClaimed({ id: "run-1", leaseToken: "lease-1", attemptCount: 1 }, failure, now);
    expect(test.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      failureCode: "OPPORTUNITY_AI_BUDGET_DEFERRED", retryAfterAt: developerDayWindow(now, "Europe/Berlin").end }) }));
  });

  it("terminalizes the third failed attempt as retry exhausted", async () => {
    const test = executionHarness();
    await test.service.failClaimed({ id: "run-1", leaseToken: "lease-1", attemptCount: 3 },
      new OpportunityRunError("OPPORTUNITY_DETECTION_RETRYABLE_FAILURE", true), now);
    expect(test.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "failed_terminal", failureCode: "OPPORTUNITY_RETRY_EXHAUSTED", retryAfterAt: null }) }));
  });
});

describe("OpportunityRunService crash replay", () => {
  it("reuses persisted detection after a crash before scoring completes", async () => {
    const test = executionHarness();
    let persisted = false;
    let providerCalls = 0;
    test.detection.detect.mockImplementation(async () => {
      if (!persisted) { providerCalls += 1; persisted = true; }
      return { ...test.detectionOutcome, execution: { ...test.detectionOutcome.execution, reused: persisted && providerCalls === 1 } };
    });
    test.scoring.scoreAndPersist
      .mockRejectedValueOnce(new Error("synthetic process interruption"))
      .mockResolvedValueOnce({ decisions: [{ shouldPost: true }], createdOpportunityIds: ["created-1"], reusedOpportunityIds: [] });
    await expect(test.service.executeClaimed("run-1", "lease-1")).rejects.toBeInstanceOf(OpportunityRunError);
    await expect(test.service.executeClaimed("run-1", "lease-2")).resolves.toBeUndefined();
    expect(providerCalls).toBe(1);
    expect(test.detection.detect).toHaveBeenCalledTimes(2);
    expect(test.scoring.scoreAndPersist).toHaveBeenCalledTimes(2);
  });

  it("reuses one semantic opportunity after a crash before run success", async () => {
    const test = executionHarness();
    const semanticRows = new Set<string>();
    let scoringCalls = 0;
    test.scoring.scoreAndPersist.mockImplementation(async () => {
      scoringCalls += 1;
      const existed = semanticRows.has("candidate-1");
      semanticRows.add("candidate-1");
      return { decisions: [{ shouldPost: true }], createdOpportunityIds: existed ? [] : ["opportunity-1"],
        reusedOpportunityIds: existed ? ["opportunity-1"] : [] };
    });
    let successWrites = 0;
    test.updateMany.mockImplementation(async (args: { data?: { status?: string } }) => {
      if (args.data?.status === "succeeded") { successWrites += 1; return { count: successWrites === 1 ? 0 : 1 }; }
      return { count: 1 };
    });
    await expect(test.service.executeClaimed("run-1", "lease-1")).rejects.toMatchObject({ failureCode: "OPPORTUNITY_LEASE_LOST" });
    await test.service.executeClaimed("run-1", "lease-2");
    expect(scoringCalls).toBe(2);
    expect(semanticRows.size).toBe(1);
    expect(test.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      createdOpportunityCount: 0, reusedOpportunityCount: 1, status: "succeeded" }) }));
  });

  it("replays a persisted zero-candidate result without a second provider call or fake opportunity", async () => {
    const test = executionHarness({ candidates: 0 });
    let providerCalls = 0;
    let persisted = false;
    test.detection.detect.mockImplementation(async () => {
      if (!persisted) { providerCalls += 1; persisted = true; }
      return { ...test.detectionOutcome, execution: { ...test.detectionOutcome.execution, reused: true } };
    });
    test.scoring.scoreAndPersist
      .mockRejectedValueOnce(new Error("synthetic interruption"))
      .mockResolvedValueOnce({ decisions: [], createdOpportunityIds: [], reusedOpportunityIds: [] });
    await expect(test.service.executeClaimed("run-1", "lease-1")).rejects.toBeInstanceOf(OpportunityRunError);
    await test.service.executeClaimed("run-1", "lease-2");
    expect(providerCalls).toBe(1);
    expect(test.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
      candidateCount: 0, recommendedCount: 0, suppressedCount: 0,
      createdOpportunityCount: 0, reusedOpportunityCount: 0 }) }));
  });

  it("prevents a stale lease from extending or overwriting Worker B", async () => {
    const test = executionHarness();
    let authoritativeLease = "lease-a";
    test.updateMany.mockImplementation(async (args: { where?: { leaseToken?: string }; data?: { status?: string } }) => {
      if (args.where?.leaseToken !== authoritativeLease) return { count: 0 };
      if (args.data?.status === "failed_terminal") authoritativeLease = "";
      return { count: 1 };
    });
    await test.service.extendLease("run-1", "lease-a", now, 900_000);
    authoritativeLease = "lease-b";
    await expect(test.service.extendLease("run-1", "lease-a", now, 900_000)).rejects.toMatchObject({ failureCode: "OPPORTUNITY_LEASE_LOST" });
    await test.service.failClaimed({ id: "run-1", leaseToken: "lease-a", attemptCount: 1 }, new Error("late A"), now);
    expect(authoritativeLease).toBe("lease-b");
    await test.service.failClaimed({ id: "run-1", leaseToken: "lease-b", attemptCount: 1 }, new Error("B owns run"), now);
    expect(authoritativeLease).toBe("");
  });
});

function enqueueHarness() {
  const state: { selected: CanonicalPhase3OpportunityInput; source: null | { id: string; projectId: string; userId: string; sourceWindowEnd: Date; processingVersion: string }; active: null | { id: string } } = {
    selected: input(), source: { id: sourceId, projectId, userId, sourceWindowEnd: boundary, processingVersion: "phase2-current" }, active: null,
  };
  const rows = new Map<string, { id: string; runKey: string }>();
  let createCount = 0;
  const opportunityRun = {
    findUnique: vi.fn(async (args: { where: { projectId_runKey: { runKey: string } } }) => rows.get(args.where.projectId_runKey.runKey) ?? null),
    findFirst: vi.fn(async () => state.active),
    create: vi.fn(async (args: { data: { runKey: string } }) => {
      await Promise.resolve();
      if (rows.has(args.data.runKey)) throw Object.assign(new Error("unique"), { code: "P2002" });
      const row = { id: `run-${createCount + 1}`, runKey: args.data.runKey };
      rows.set(row.runKey, row); createCount += 1; return row;
    }),
  };
  const prisma = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "IntelligenceRun" run')) return state.source ? [state.source] : [];
      if (sql.includes('FROM "IntelligenceRun" source')) return state.source ? [{ id: state.source.id }] : [];
      return [{ id: projectId }];
    }),
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    project: { findFirst: vi.fn(async () => state.source ? { id: projectId } : null) }, opportunityRun,
  };
  const selector = { select: vi.fn(async () => ({ input: state.selected, inputFingerprint: fingerprintPhase3OpportunityInput(state.selected) })) };
  const detection = { getProcessingIdentity: vi.fn().mockReturnValue({ detectorVersion: "detector-v1", extractionVersion: "extract-v1",
    inputSelectionVersion: "phase3-opportunity-input-v1", modelConfigurationFingerprint: "b".repeat(64),
    promptVersion: "prompt-v1", schemaVersion: "schema-v1", validationVersion: "validation-v1" }) };
  const intelligence = { versions: { processingVersion: "phase2-current" } };
  const logger = { info: vi.fn(), warnEvent: vi.fn(), errorEvent: vi.fn() };
  const service = new OpportunityRunService(prisma as unknown as PrismaService,
    selector as unknown as Phase3OpportunityInputSelectorService, detection as unknown as OpportunityDetectionService,
    {} as ContentOpportunityScoringService, intelligence as unknown as IntelligencePipelineService,
    logger as unknown as StructuredLogger, () => now);
  return { opportunityRun, rows, service, state };
}

describe("OpportunityRunService enqueue and manual reprocessing", () => {
  it("converges concurrent exact enqueue to one canonical row", async () => {
    const test = enqueueHarness();
    const results = await Promise.all([
      test.service.enqueueReprocessing(projectId, userId),
      test.service.enqueueReprocessing(projectId, userId),
    ]);
    expect(test.rows.size).toBe(1);
    expect(test.opportunityRun.create).toHaveBeenCalledTimes(2);
    expect(results.map((result) => result.status).sort()).toEqual(["queued", "reused"]);
    expect(new Set(results.map((result) => result.opportunityRunId)).size).toBe(1);
  });

  it("reuses exact identity but creates distinct keys for input, version, and newer source changes", async () => {
    const test = enqueueHarness();
    const first = await test.service.enqueueReprocessing(projectId, userId);
    const exact = await test.service.enqueueReprocessing(projectId, userId);
    test.state.selected = input("changed input");
    const changedInput = await test.service.enqueueReprocessing(projectId, userId);
    (test.service.processingIdentity as { processingVersion: string }).processingVersion = "d".repeat(64);
    const changedVersion = await test.service.enqueueReprocessing(projectId, userId);
    test.state.source = { ...test.state.source!, id: "323e4567-e89b-42d3-a456-426614174444" };
    const changedSource = await test.service.enqueueReprocessing(projectId, userId);
    expect(exact).toMatchObject({ opportunityRunId: first.opportunityRunId, status: "reused" });
    expect(new Set([first.runKey, changedInput.runKey, changedVersion.runKey, changedSource.runKey]).size).toBe(4);
  });

  it("never reports an unrelated active run as exact reuse", async () => {
    const test = enqueueHarness();
    test.state.active = { id: "unrelated-active" };
    await expect(test.service.enqueueReprocessing(projectId, userId)).rejects.toMatchObject({
      failureCode: "OPPORTUNITY_RUN_ACTIVE_CONFLICT" });
    expect(test.rows.size).toBe(0);
  });

  it("fails safely for cross-user or inactive/unavailable Project sources", async () => {
    const test = enqueueHarness();
    test.state.source = null;
    await expect(test.service.enqueueReprocessing(projectId, "another-user")).rejects.toMatchObject({
      failureCode: "OPPORTUNITY_PROJECT_SOURCE_UNAVAILABLE" });
    expect(test.opportunityRun.create).not.toHaveBeenCalled();
  });
});
