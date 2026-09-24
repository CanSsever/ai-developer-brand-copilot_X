import { describe, expect, it, vi } from "vitest";
import {
  opportunityDetectionPromptVersion,
  opportunityDetectionSchemaVersion,
  opportunityDetectionValidationVersion,
  parseOpportunityDetectionResult,
} from "@developer-brand-copilot/ai";
import type { DetectedOpportunityCandidate } from "@developer-brand-copilot/contracts";

import { PrismaService } from "../database/prisma.service";
import { AIProviderError } from "./openai-development-event-model.service";
import {
  OpportunityDetectionError,
  OpportunityDetectionService,
  opportunityDetectionExtractionVersion,
  opportunityDetectionVersion,
} from "./opportunity-detection.service";
import { Phase3OpportunityInputSelectorService } from "./phase3-opportunity-input-selector.service";
import { fingerprintPhase3OpportunityInput, type CanonicalPhase3OpportunityInput } from "./phase3-opportunity-input";

const userId = "323e4567-e89b-42d3-a456-426614174111";
const projectId = "323e4567-e89b-42d3-a456-426614174000";
const eventId = "423e4567-e89b-42d3-a456-426614174000";
const boundary = new Date("2026-09-24T20:00:00.000Z");

function input(overrides: Partial<CanonicalPhase3OpportunityInput> = {}): CanonicalPhase3OpportunityInput {
  return {
    selectionVersion: "phase3-opportunity-input-v1",
    projectId,
    timezone: "Europe/Berlin",
    evaluationBoundary: boundary.toISOString(),
    developerDay: "2026-09-24",
    projectState: null,
    developmentEvents: [{
      developmentEventId: eventId,
      eventKey: "event-key",
      inputFingerprint: "a".repeat(64),
      extractionVersion: "event-v1",
      type: "feature_completed",
      status: "active",
      title: "Synthetic feature delivery",
      summary: "A synthetic feature event for unit tests.",
      importanceScore: 0.7,
      contentPotentialScore: 0.8,
      confidence: 0.9,
      occurredAt: boundary.toISOString(),
      technologies: ["TypeScript"],
      relatedFeatureIds: ["feature-safe-id"],
      supportingEvidenceKinds: ["commit"],
      truncated: { title: false, summary: false, technologies: false, relatedFeatureIds: false },
    }],
    opportunityHistory: [],
    truncation: { developmentEvents: false, opportunityHistory: false, activeFeatures: false, completedFeatures: false, recentMilestones: false, projectTechnologies: false, stateTextFields: 0 },
    ...overrides,
  };
}

function candidate(overrides: Partial<DetectedOpportunityCandidate> = {}): DetectedOpportunityCandidate {
  return {
    eventIds: [eventId],
    opportunityType: "feature_showcase",
    title: "Synthetic reliable deployment",
    recommendedFormat: "technical_breakdown",
    topicDescriptor: "reliable deployment checks",
    confidence: 0.873456789,
    ...overrides,
  };
}

function output(candidates: readonly DetectedOpportunityCandidate[]): string {
  return JSON.stringify({ candidates });
}

function reusable(candidateValue: DetectedOpportunityCandidate | null = candidate(), inputFingerprint = "b".repeat(64), overrides: Record<string, unknown> = {}) {
  return {
    id: "execution-reused",
    attemptNumber: 1,
    isRepairAttempt: false,
    inputFingerprint,
    model: "synthetic-model",
    modelConfigurationFingerprint: "c".repeat(64),
    promptVersion: opportunityDetectionPromptVersion,
    schemaVersion: opportunityDetectionSchemaVersion,
    extractionVersion: "d".repeat(64),
    opportunityDetectionResult: candidateValue === null ? null : {
      projectId,
      inputFingerprint,
      candidateCount: 1,
      candidates: [{
        position: 0,
        opportunityType: candidateValue.opportunityType,
        title: candidateValue.title,
        recommendedFormat: candidateValue.recommendedFormat,
        topicDescriptor: candidateValue.topicDescriptor,
        confidence: candidateValue.confidence,
        selectedEventCount: candidateValue.eventIds.length,
        developmentEvents: candidateValue.eventIds.map((developmentEventId, position) => ({ position, developmentEventId })),
      }],
    },
    ...overrides,
  };
}

function reusableZeroCandidates(inputFingerprint: string) {
  return reusable(null, inputFingerprint, {
    opportunityDetectionResult: {
      projectId,
      inputFingerprint,
      candidateCount: 0,
      candidates: [],
    },
  });
}

function matchesReuseIdentity(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  const identityFields = [
    "projectId",
    "stage",
    "inputFingerprint",
    "model",
    "modelConfigurationFingerprint",
    "promptVersion",
    "schemaVersion",
    "extractionVersion",
    "status",
    "validationStatus",
  ];
  const rowProject = row.project as Record<string, unknown> | undefined;
  const whereProject = where.project as Record<string, unknown> | undefined;
  return identityFields.every((field) => row[field] === where[field]) &&
    rowProject?.userId === whereProject?.userId;
}

function harness(options: {
  readonly input?: CanonicalPhase3OpportunityInput;
  readonly reusableExecutions?: readonly unknown[];
  readonly dailyAttempts?: number;
  readonly timezone?: string;
  readonly model?: string;
  readonly dailyAttemptLimit?: number;
} = {}) {
  const selected = options.input ?? input();
  const inputFingerprint = fingerprintPhase3OpportunityInput(selected);
  const selector = {
    select: vi.fn().mockResolvedValue({ input: selected, inputFingerprint }),
  } as unknown as Phase3OpportunityInputSelectorService;
  const startedExecutions: Record<string, unknown>[] = [];
  const txExecutionUpdate = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue(options.reusableExecutions ?? []);
  const count = vi.fn(async (args: { where: Record<string, unknown> }) =>
    "project" in args.where ? (options.dailyAttempts ?? 0) : startedExecutions.length
  );
  const txCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `execution-${startedExecutions.length + 1}`, ...data };
    startedExecutions.push(row);
    return { id: row.id };
  });
  const resultCreate = vi.fn().mockResolvedValue({ id: "result-created" });
  const transaction = {
    project: { findFirst: vi.fn().mockResolvedValue({ timezone: options.timezone ?? "Europe/Berlin" }) },
    aIExecution: { findMany, count, create: txCreate, update: txExecutionUpdate },
    opportunityDetectionResult: { create: resultCreate },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    aIExecution: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;
  const detect = vi.fn().mockResolvedValue({ outputText: output([candidate()]), inputTokens: 12, outputTokens: 5 });
  const service = new OpportunityDetectionService(
    prisma,
    selector,
    { detect } as never,
    { apiKey: "synthetic-key", model: options.model ?? "synthetic-model", dailyAttemptLimit: options.dailyAttemptLimit ?? 100 }
  );
  return { service, prisma, selector, detect, findMany, count, txCreate, txExecutionUpdate, resultCreate, transaction, startedExecutions, inputFingerprint };
}

describe("OpportunityDetectionService", () => {
  it("persists validated semantics and event provenance atomically without provider payloads", async () => {
    const test = harness();
    const raw = output([candidate()]);
    test.detect.mockResolvedValue({ outputText: raw, inputTokens: 12, outputTokens: 5 });
    const result = await test.service.detect(userId, projectId, boundary);
    expect(result).toMatchObject({ candidates: [candidate()], execution: { reused: false, initialAttemptCount: 1, repairAttemptCount: 0 } });
    expect(test.txCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      stage: "opportunity_detection",
      isRepairAttempt: false,
      inputFingerprint: test.inputFingerprint,
      promptVersion: opportunityDetectionPromptVersion,
      schemaVersion: opportunityDetectionSchemaVersion,
      extractionVersion: expect.any(String),
      modelConfigurationFingerprint: expect.any(String),
    }) }));
    expect(test.resultCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      projectId,
      inputFingerprint: test.inputFingerprint,
      candidateCount: 1,
      candidates: { create: [expect.objectContaining({
        opportunityType: "feature_showcase",
        title: candidate().title,
        recommendedFormat: "technical_breakdown",
        topicDescriptor: candidate().topicDescriptor,
        confidence: candidate().confidence,
        selectedEventCount: 1,
        developmentEvents: { create: [{ position: 0, developmentEvent: { connect: { id: eventId } } }] },
      })] },
    }) });
    const persistence = JSON.stringify([test.txCreate.mock.calls, test.resultCreate.mock.calls]);
    expect(persistence).not.toContain(raw);
    expect(persistence).not.toContain("outputText");
    expect(persistence).not.toContain("rawResponse");
  });

  it("persists a successful zero-candidate result as a complete reusable row", async () => {
    const test = harness();
    expect(parseOpportunityDetectionResult('{"candidates":[]}', new Set([eventId]))).toEqual({ errors: [], value: [] });
    test.detect.mockResolvedValue({ outputText: '{"candidates":[]}', inputTokens: 8, outputTokens: 2 });
    const result = await test.service.detect(userId, projectId, boundary);
    expect(result.candidates).toEqual([]);
    expect(test.resultCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ candidateCount: 0, candidates: { create: [] } }) });
  });

  it("reuses a persisted zero-candidate result without another provider attempt", async () => {
    const test = harness();
    test.findMany.mockResolvedValue([reusableZeroCandidates(test.inputFingerprint)]);

    const result = await test.service.detect(userId, projectId, boundary);

    expect(result.candidates).toEqual([]);
    expect(result.execution.reused).toBe(true);
    expect(test.detect).not.toHaveBeenCalled();
    expect(test.txCreate).not.toHaveBeenCalled();
  });

  it("reuses only a matching successful valid execution with its complete persisted result", async () => {
    const test = harness();
    test.findMany.mockResolvedValue([reusable(candidate(), test.inputFingerprint)]);
    const result = await test.service.detect(userId, projectId, boundary);
    expect(result).toMatchObject({ candidates: [candidate()], execution: { aiExecutionId: "execution-reused", reused: true } });
    expect(test.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      projectId,
      project: { userId },
      stage: "opportunity_detection",
      inputFingerprint: test.inputFingerprint,
      model: "synthetic-model",
      modelConfigurationFingerprint: expect.any(String),
      promptVersion: opportunityDetectionPromptVersion,
      schemaVersion: opportunityDetectionSchemaVersion,
      extractionVersion: expect.any(String),
      status: "succeeded",
      validationStatus: "valid",
    } }));
    expect(test.detect).not.toHaveBeenCalled();
    expect(test.txCreate).not.toHaveBeenCalled();
  });

  it("fails closed when a successful valid execution has no complete result", async () => {
    const test = harness();
    test.findMany.mockResolvedValue([reusable(null, test.inputFingerprint)]);
    await expect(test.service.detect(userId, projectId, boundary)).rejects.toMatchObject({ failureCode: "OPPORTUNITY_DETECTION_RESULT_INCOMPLETE" });
    expect(test.detect).not.toHaveBeenCalled();
    expect(test.txCreate).not.toHaveBeenCalled();
  });

  it("fails closed when result counts or provenance do not match persisted children", async () => {
    const test = harness();
    const missingLink = reusable(candidate(), test.inputFingerprint, {
      opportunityDetectionResult: {
        projectId,
        inputFingerprint: "b".repeat(64),
        candidateCount: 1,
        candidates: [{ position: 0, opportunityType: "feature_showcase", title: "x", recommendedFormat: "short_update", topicDescriptor: "x", confidence: 0.5, selectedEventCount: 1, developmentEvents: [] }],
      },
    });
    test.findMany.mockResolvedValue([missingLink]);
    await expect(test.service.detect(userId, projectId, boundary)).rejects.toMatchObject({ failureCode: "OPPORTUNITY_DETECTION_RESULT_INCOMPLETE" });
  });

  it("returns the single canonical winner when overlapping valid detections race to persist", async () => {
    const test = harness();
    const winnerCandidate = candidate({ title: "Canonical winner" });
    const losingCandidate = candidate({ title: "Unpersisted concurrent loser" });
    let releaseProviders!: () => void;
    const bothProvidersStarted = new Promise<void>((resolve) => { releaseProviders = resolve; });
    let providerCalls = 0;
    test.detect.mockImplementation(async () => {
      providerCalls += 1;
      const call = providerCalls;
      if (providerCalls === 2) releaseProviders();
      await bothProvidersStarted;
      return {
        outputText: output([call === 1 ? winnerCandidate : losingCandidate]),
        inputTokens: 10,
        outputTokens: 4,
      };
    });

    let canonicalWriteAttempts = 0;
    let persistedCanonicalResults = 0;
    test.resultCreate.mockImplementation(async () => {
      canonicalWriteAttempts += 1;
      if (canonicalWriteAttempts > 1) {
        throw Object.assign(new Error("canonical unique index conflict"), { code: "P2002" });
      }
      persistedCanonicalResults += 1;
      return { id: "canonical-result" };
    });
    test.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([reusable(winnerCandidate, test.inputFingerprint, { id: "execution-1" })]);

    const [first, second] = await Promise.all([
      test.service.detect(userId, projectId, boundary),
      test.service.detect(userId, projectId, boundary),
    ]);

    expect(test.detect).toHaveBeenCalledTimes(2);
    expect(test.startedExecutions).toHaveLength(2);
    expect(test.count.mock.calls.filter(([args]) => "project" in args.where)).toHaveLength(2);
    expect(canonicalWriteAttempts).toBe(2);
    expect(persistedCanonicalResults).toBe(1);
    expect(test.prisma.aIExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "running" }),
      data: expect.objectContaining({ status: "failed", failureCode: "OPPORTUNITY_DETECTION_PERSISTENCE_FAILED" }),
    }));
    expect(first.candidates).toEqual([winnerCandidate]);
    expect(second.candidates).toEqual([winnerCandidate]);
    expect(first.execution.aiExecutionId).toBe(second.execution.aiExecutionId);
    expect(first.execution.reused).not.toBe(second.execution.reused);
  });

  it("does not reuse when canonical input identity changes", async () => {
    const changed = input({ evaluationBoundary: "2026-09-24T20:01:00.000Z" });
    const test = harness({ input: changed });
    await test.service.detect(userId, projectId, boundary);
    expect(test.findMany.mock.calls[0]?.[0].where.inputFingerprint).toBe(test.inputFingerprint);
    expect(test.detect).toHaveBeenCalledOnce();
  });

  it.each([
    ["projectId", "different-project"],
    ["project.userId", "different-user"],
    ["inputFingerprint", "e".repeat(64)],
    ["promptVersion", "phase3-opportunity-prompt-old"],
    ["schemaVersion", "phase3-opportunity-schema-old"],
    ["extractionVersion", "f".repeat(64)],
    ["model", "different-model"],
    ["modelConfigurationFingerprint", "g".repeat(64)],
    ["stage", "development_event_interpretation"],
    ["status", "failed"],
    ["validationStatus", "invalid"],
  ] as const)("does not reuse a result when the stored %s identity dimension is stale", async (dimension, staleValue) => {
    const test = harness();
    test.findMany.mockImplementation(async (args) => {
      const where = args.where as Record<string, unknown>;
      const row: Record<string, unknown> = {
        ...reusable(candidate(), where.inputFingerprint as string),
        ...where,
        project: where.project,
      };
      if (dimension === "project.userId") {
        row.project = { userId: staleValue };
      } else {
        row[dimension] = staleValue;
      }
      return matchesReuseIdentity(row, where) ? [row] : [];
    });

    await test.service.detect(userId, projectId, boundary);

    expect(test.detect).toHaveBeenCalledOnce();
  });

  it("uses the canonical selection fingerprint and versions in detector identity", () => {
    const versions = {
      detectorVersion: "phase3-opportunity-detector-v1",
      inputSelectionVersion: "phase3-opportunity-input-v1",
      modelConfigurationFingerprint: "a".repeat(64),
      promptVersion: opportunityDetectionPromptVersion,
      schemaVersion: opportunityDetectionSchemaVersion,
      validationVersion: opportunityDetectionValidationVersion,
    };
    const first = opportunityDetectionExtractionVersion(versions);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    for (const [key, value] of Object.entries({
      detectorVersion: "phase3-opportunity-detector-v2",
      inputSelectionVersion: "phase3-opportunity-input-v2",
      modelConfigurationFingerprint: "b".repeat(64),
      promptVersion: "phase3-opportunity-prompt-v2",
      schemaVersion: "phase3-opportunity-schema-v2",
      validationVersion: "phase3-opportunity-validation-v2",
    })) {
      expect(opportunityDetectionExtractionVersion({ ...versions, [key]: value })).not.toBe(first);
    }
    expect(opportunityDetectionVersion).toBe("phase3-opportunity-detector-v1");
    expect(opportunityDetectionValidationVersion).toBe("phase3-opportunity-validation-v1");
  });

  it("uses one initial request and exactly one schema repair, recording repair metadata", async () => {
    const test = harness();
    test.detect
      .mockResolvedValueOnce({ outputText: JSON.stringify({ candidates: [{ ...candidate(), eventIds: ["invented-event"] }] }), inputTokens: 10, outputTokens: 4 })
      .mockResolvedValueOnce({ outputText: output([candidate()]), inputTokens: 12, outputTokens: 5 });
    const result = await test.service.detect(userId, projectId, boundary);
    expect(test.detect).toHaveBeenCalledTimes(2);
    expect(test.detect.mock.calls[0]?.[1]).toEqual([]);
    expect(test.detect.mock.calls[1]?.[1]).toContain("unsupported_event_id");
    expect(test.startedExecutions.map((execution) => execution.isRepairAttempt)).toEqual([false, true]);
    expect(result.execution).toMatchObject({ initialAttemptCount: 1, repairAttemptCount: 1 });
  });

  it("fails after invalid repair without making a third request", async () => {
    const test = harness();
    const invalid = JSON.stringify({ candidates: [{ ...candidate(), shouldPost: true }] });
    test.detect.mockResolvedValue({ outputText: invalid, inputTokens: 1, outputTokens: 1 });
    await expect(test.service.detect(userId, projectId, boundary)).rejects.toMatchObject({ failureCode: "AI_OUTPUT_INVALID" });
    expect(test.detect).toHaveBeenCalledTimes(2);
    expect(test.prisma.aIExecution.update).toHaveBeenCalledTimes(2);
  });

  it.each(["AI_AUTHENTICATION_FAILURE", "AI_RATE_LIMITED", "AI_NETWORK_FAILURE", "AI_PROVIDER_TRANSIENT_FAILURE"] as const)(
    "does not semantically repair provider failure %s",
    async (failureCode) => {
      const test = harness();
      test.detect.mockRejectedValue(new AIProviderError(failureCode, true));
      await expect(test.service.detect(userId, projectId, boundary)).rejects.toMatchObject({ failureCode });
      expect(test.detect).toHaveBeenCalledOnce();
      expect(test.prisma.aIExecution.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failureCode, status: "failed" }) }));
    }
  );

  it("enforces per-user Project-local developer-day budget before provider invocation", async () => {
    const test = harness({ dailyAttempts: 1, dailyAttemptLimit: 1 });
    await expect(test.service.detect(userId, projectId, boundary)).rejects.toMatchObject({ failureCode: "AI_BUDGET_EXHAUSTED" });
    expect(test.detect).not.toHaveBeenCalled();
    expect(test.txCreate).not.toHaveBeenCalled();
    const budgetQuery = test.count.mock.calls.find(([args]) => "project" in args.where)?.[0];
    expect(budgetQuery?.where).toMatchObject({ project: { userId } });
    expect(budgetQuery?.where.startedAt).toMatchObject({ gte: expect.any(Date), lt: expect.any(Date) });
  });

  it("rejects cross-owner or changed-Project-timezone context before provider execution", async () => {
    const test = harness({ timezone: "Etc/UTC" });
    await expect(test.service.detect(userId, projectId, boundary)).rejects.toBeInstanceOf(OpportunityDetectionError);
    expect(test.detect).not.toHaveBeenCalled();
  });
});
