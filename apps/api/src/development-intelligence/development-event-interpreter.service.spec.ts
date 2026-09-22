import { describe, expect, it, vi } from "vitest";
import type { DevelopmentEventModelClient } from "@developer-brand-copilot/ai";

import type { PrismaService } from "../database/prisma.service";
import type { StructuredLogger } from "../observability/structured-logger";
import {
  DevelopmentEventInterpretationError,
  DevelopmentEventInterpreterService,
} from "./development-event-interpreter.service";
import type { EvidenceGroupingService } from "./evidence-grouping.service";
import type { CandidateEvidenceGroup } from "./evidence-grouping.types";
import { AIProviderError } from "./openai-development-event-model.service";

const projectId = "10000000-0000-4000-8000-000000000001";
const repositoryId = "20000000-0000-4000-8000-000000000001";
const userId = "30000000-0000-4000-8000-000000000001";
const firstSha = "1".repeat(40);
const secondSha = "2".repeat(40);
const groupKey = "a".repeat(64);
const privateMessage = "synthetic private commit message";
const privateTitle = "Synthetic private pull request title";
const privateBody = "Synthetic bounded private pull request body";
const privatePath = "src/private/synthetic-file.ts";

const groupingRequest = {
  evaluationBoundary: new Date("2026-09-21T00:00:00.000Z"),
  projectId,
  sourceWindowStart: new Date("2026-09-01T00:00:00.000Z"),
  userId,
};

function candidate(options: {
  readonly commitIds?: readonly string[];
  readonly pullRequestIds?: readonly string[];
  readonly reason?: "merged_pull_request" | "standalone_commit_chain";
} = {}): CandidateEvidenceGroup {
  return {
    commitEvidenceIds: options.commitIds ?? ["commit-1"],
    connectedRepositoryId: repositoryId,
    evidenceFrom: new Date("2026-09-20T10:00:00.000Z"),
    evidenceTo: new Date("2026-09-20T12:00:00.000Z"),
    groupKey,
    groupingVersion: "evidence-grouping-v1",
    projectId,
    pullRequestEvidenceIds: options.pullRequestIds ?? ["pr-1"],
    reason: options.reason ?? "merged_pull_request",
  };
}

function validOutput(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    decision: "event",
    reason: null,
    event: {
      type: "feature_completed",
      title: "Implemented a synthetic capability",
      summary: "The evidence supports completion of a synthetic capability.",
      importanceScore: 0.8,
      contentPotentialScore: 0.7,
      confidence: 0.9,
      technologies: ["TypeScript"],
      evidenceRefs: {
        commitIds: ["commit-1"],
        pullRequestIds: ["pr-1"],
      },
      ...overrides,
    },
  });
}

interface StoredEvent {
  readonly extractionVersion: string;
  readonly id: string;
  status: string;
}

function harness(options: {
  readonly group?: CandidateEvidenceGroup;
  readonly outputs?: readonly (Error | string)[];
  readonly previous?: StoredEvent | null;
  readonly commits?: readonly Record<string, unknown>[];
  readonly pullRequests?: readonly Record<string, unknown>[];
  readonly model?: string;
  readonly dailyAttempts?: number;
} = {}) {
  const group = options.group ?? candidate();
  const commits = options.commits ?? [
    {
      additions: 12,
      committedAt: new Date("2026-09-20T10:00:00.000Z"),
      deletions: 3,
      files: [{ path: privatePath }],
      id: "commit-1",
      message: privateMessage,
      sha: firstSha,
    },
  ];
  const pullRequests = options.pullRequests ?? [
    {
      additions: 12,
      bodySummary: privateBody,
      deletions: 3,
      files: [{ path: privatePath }],
      id: "pr-1",
      mergedAt: new Date("2026-09-20T12:00:00.000Z"),
      providerPullRequestId: 101n,
      title: privateTitle,
    },
  ];
  const storedEvents: StoredEvent[] = options.previous ? [options.previous] : [];
  const modelOutputs = [...(options.outputs ?? [validOutput()])];
  const grouping = {
    selectAndGroup: vi.fn().mockResolvedValue([group]),
  };
  const modelClient = {
    interpret: vi.fn().mockImplementation(async () => {
      const next = modelOutputs.shift() ?? validOutput();
      if (next instanceof Error) throw next;
      return { inputTokens: 100, outputText: next, outputTokens: 50 };
    }),
  };
  const logger = {
    errorEvent: vi.fn(),
    info: vi.fn(),
    warnEvent: vi.fn(),
  };
  const projectState = { create: vi.fn(), update: vi.fn() };
  const contentOpportunity = { create: vi.fn() };
  const developmentEvent = {
    findUnique: vi.fn().mockImplementation(
      async (args: {
        where: {
          projectId_eventKey_extractionVersion: {
            extractionVersion: string;
          };
        };
      }) =>
        storedEvents.find(
          (event) =>
            event.extractionVersion ===
            args.where.projectId_eventKey_extractionVersion.extractionVersion
        ) ?? null
    ),
    findFirst: vi.fn().mockImplementation(async () => {
      return [...storedEvents].reverse().find((event) => event.status === "active") ?? null;
    }),
    create: vi.fn().mockImplementation(
      async (args: { data: { extractionVersion: string; status: string } }) => {
        const event = {
          extractionVersion: args.data.extractionVersion,
          id: `event-${storedEvents.length + 1}`,
          status: args.data.status,
        };
        storedEvents.push(event);
        return { id: event.id };
      }
    ),
    update: vi.fn().mockImplementation(
      async (args: { data: { status: string }; where: { id: string } }) => {
        const event = storedEvents.find((item) => item.id === args.where.id);
        if (event) event.status = args.data.status;
        return event;
      }
    ),
  };
  const aIExecution = {
    count: vi.fn().mockImplementation(
      async (args: { where?: { startedAt?: unknown } }) =>
        args.where?.startedAt
          ? (options.dailyAttempts ?? 0)
          : aIExecution.create.mock.calls.length
    ),
    create: vi.fn().mockImplementation(async () => ({
      id: `execution-${aIExecution.create.mock.calls.length}`,
    })),
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  };
  const prisma = {
    aIExecution,
    contentOpportunity,
    developmentEvent,
    gitHubCommit: { findMany: vi.fn().mockResolvedValue(commits) },
    gitHubPullRequest: { findMany: vi.fn().mockResolvedValue(pullRequests) },
    project: {
      findUnique: vi.fn().mockResolvedValue({ timezone: "Europe/Berlin", userId }),
    },
    projectState,
    $transaction: vi.fn().mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback(prisma)
    ),
  };
  const service = new DevelopmentEventInterpreterService(
    prisma as unknown as PrismaService,
    grouping as unknown as EvidenceGroupingService,
    modelClient as unknown as DevelopmentEventModelClient,
    {
      apiKey: "synthetic_openai_key_not_logged",
      model: options.model ?? "configured-test-model-v1",
    },
    logger as unknown as StructuredLogger
  );

  return {
    aIExecution,
    contentOpportunity,
    developmentEvent,
    group,
    grouping,
    logger,
    modelClient,
    prisma,
    projectState,
    service,
    storedEvents,
  };
}

describe("DevelopmentEventInterpreterService", () => {
  it("creates one durable event for a PR-backed candidate", async () => {
    const { developmentEvent, service } = harness();
    const result = await service.interpret({ groupKey, grouping: groupingRequest });

    expect(result).toEqual({ developmentEventId: "event-1", status: "created" });
    expect(developmentEvent.create).toHaveBeenCalledOnce();
    expect(developmentEvent.create.mock.calls[0]?.[0].data).toMatchObject({
      eventKey: groupKey,
      type: "feature_completed",
      status: "active",
      occurredAt: new Date("2026-09-20T12:00:00.000Z"),
    });
  });

  it("creates a valid event for a standalone candidate", async () => {
    const group = candidate({ pullRequestIds: [], reason: "standalone_commit_chain" });
    const { developmentEvent, service } = harness({
      group,
      pullRequests: [],
      outputs: [
        validOutput({
          evidenceRefs: { commitIds: ["commit-1"], pullRequestIds: [] },
        }),
      ],
    });

    await service.interpret({ groupKey, grouping: groupingRequest });
    expect(developmentEvent.create.mock.calls[0]?.[0].data.pullRequestEvidence.create)
      .toEqual([]);
  });

  it("persists multiple commits as provenance for one semantic event", async () => {
    const group = candidate({ commitIds: ["commit-1", "commit-2"] });
    const secondCommit = {
      additions: 4,
      committedAt: new Date("2026-09-20T11:00:00.000Z"),
      deletions: 1,
      files: [{ path: "src/synthetic-second.ts" }],
      id: "commit-2",
      message: "Synthetic second commit",
      sha: secondSha,
    };
    const { developmentEvent, service } = harness({
      group,
      commits: [
        {
          additions: 12,
          committedAt: new Date("2026-09-20T10:00:00.000Z"),
          deletions: 3,
          files: [{ path: privatePath }],
          id: "commit-1",
          message: privateMessage,
          sha: firstSha,
        },
        secondCommit,
      ],
      outputs: [
        validOutput({
          evidenceRefs: {
            commitIds: ["commit-1", "commit-2"],
            pullRequestIds: ["pr-1"],
          },
        }),
      ],
    });

    await service.interpret({ groupKey, grouping: groupingRequest });
    expect(developmentEvent.create.mock.calls[0]?.[0].data.commitEvidence.create)
      .toEqual([
        { commitSha: firstSha, gitHubCommitId: "commit-1" },
        { commitSha: secondSha, gitHubCommitId: "commit-2" },
      ]);
  });

  it("persists merged PR provenance with its stable provider identity", async () => {
    const { developmentEvent, service } = harness();
    await service.interpret({ groupKey, grouping: groupingRequest });

    expect(developmentEvent.create.mock.calls[0]?.[0].data.pullRequestEvidence.create)
      .toEqual([
        { gitHubPullRequestId: "pr-1", providerPullRequestId: 101n },
      ]);
  });

  it.each([
    ["unsupported type", validOutput({ type: "unsupported" })],
    ["malformed JSON", "not-json"],
    ["missing title", validOutput({ title: undefined })],
    [
      "unsupported evidence reference",
      validOutput({
        evidenceRefs: { commitIds: ["other-commit"], pullRequestIds: [] },
      }),
    ],
  ])("rejects %s after one bounded repair", async (_name, output) => {
    const { aIExecution, developmentEvent, modelClient, service } = harness({
      outputs: [output, output],
    });

    await expect(
      service.interpret({ groupKey, grouping: groupingRequest })
    ).rejects.toMatchObject({ failureCode: "AI_OUTPUT_INVALID" });
    expect(modelClient.interpret).toHaveBeenCalledTimes(2);
    expect(aIExecution.create).toHaveBeenCalledTimes(2);
    expect(developmentEvent.create).not.toHaveBeenCalled();
  });

  it("handles insufficient evidence without creating a domain event", async () => {
    const output = JSON.stringify({
      decision: "insufficient_evidence",
      event: null,
      reason: "insufficient_detail",
    });
    const { aIExecution, developmentEvent, service } = harness({ outputs: [output] });

    await expect(
      service.interpret({ groupKey, grouping: groupingRequest })
    ).resolves.toEqual({ developmentEventId: null, status: "insufficient_evidence" });
    expect(developmentEvent.create).not.toHaveBeenCalled();
    expect(aIExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCode: "INSUFFICIENT_EVIDENCE",
          status: "rejected",
          validationStatus: "valid",
        }),
      })
    );
  });

  it("reuses a persisted insufficient-evidence decision without another model call", async () => {
    const test = harness();
    test.aIExecution.findFirst.mockResolvedValueOnce({ id: "prior-insufficient" });
    await expect(
      test.service.interpret({ groupKey, grouping: groupingRequest })
    ).resolves.toEqual({
      developmentEventId: null,
      status: "insufficient_evidence",
    });
    expect(test.modelClient.interpret).not.toHaveBeenCalled();
    expect(test.aIExecution.create).not.toHaveBeenCalled();
  });

  it("blocks model invocation when the configured daily user budget is exhausted", async () => {
    const test = harness({ dailyAttempts: 100 });
    await expect(
      test.service.interpret({ groupKey, grouping: groupingRequest })
    ).rejects.toMatchObject({
      failureCode: "AI_BUDGET_EXHAUSTED",
      retryable: true,
    });
    expect(test.modelClient.interpret).not.toHaveBeenCalled();
    expect(test.aIExecution.create).not.toHaveBeenCalled();
  });

  it("persists low-confidence interpretations as rejected review records", async () => {
    const { developmentEvent, service } = harness({
      outputs: [validOutput({ confidence: 0.59 })],
    });
    await service.interpret({ groupKey, grouping: groupingRequest });
    expect(developmentEvent.create.mock.calls[0]?.[0].data.status).toBe("rejected");
    expect(developmentEvent.findFirst).not.toHaveBeenCalled();
  });

  it("reuses the same event for unchanged input and interpretation version", async () => {
    const { developmentEvent, modelClient, service } = harness();
    const first = await service.interpret({ groupKey, grouping: groupingRequest });
    const second = await service.interpret({ groupKey, grouping: groupingRequest });

    expect(first).toEqual({ developmentEventId: "event-1", status: "created" });
    expect(second).toEqual({ developmentEventId: "event-1", status: "reused" });
    expect(modelClient.interpret).toHaveBeenCalledOnce();
    expect(developmentEvent.create).toHaveBeenCalledOnce();
  });

  it("creates a superseding event for a new model/configuration version", async () => {
    const shared = harness();
    await shared.service.interpret({ groupKey, grouping: groupingRequest });
    const secondService = new DevelopmentEventInterpreterService(
      shared.prisma as unknown as PrismaService,
      shared.grouping as unknown as EvidenceGroupingService,
      shared.modelClient as unknown as DevelopmentEventModelClient,
      { apiKey: "synthetic_key_not_logged", model: "configured-test-model-v2" },
      shared.logger as unknown as StructuredLogger
    );

    const result = await secondService.interpret({
      groupKey,
      grouping: groupingRequest,
    });
    expect(result).toEqual({ developmentEventId: "event-2", status: "created" });
    expect(shared.developmentEvent.create.mock.calls[1]?.[0].data.supersedesEventId)
      .toBe("event-1");
    expect(shared.developmentEvent.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { status: "superseded" },
    });
  });

  it("does not mutate historical semantic fields during supersession", async () => {
    const shared = harness();
    await shared.service.interpret({ groupKey, grouping: groupingRequest });
    const secondService = new DevelopmentEventInterpreterService(
      shared.prisma as unknown as PrismaService,
      shared.grouping as unknown as EvidenceGroupingService,
      shared.modelClient as unknown as DevelopmentEventModelClient,
      { apiKey: "synthetic_key_not_logged", model: "configured-test-model-v2" },
      shared.logger as unknown as StructuredLogger
    );
    await secondService.interpret({ groupKey, grouping: groupingRequest });

    expect(shared.developmentEvent.update.mock.calls[0]?.[0].data)
      .toEqual({ status: "superseded" });
  });

  it("rejects a group key not produced by the owned Task 2.2 selection", async () => {
    const { modelClient, prisma, service } = harness();
    await expect(
      service.interpret({ groupKey: "b".repeat(64), grouping: groupingRequest })
    ).rejects.toMatchObject({ failureCode: "EVIDENCE_GROUP_NOT_AVAILABLE" });
    expect(prisma.gitHubCommit.findMany).not.toHaveBeenCalled();
    expect(modelClient.interpret).not.toHaveBeenCalled();
  });

  it("fails closed when selected evidence cannot be loaded in the same scope", async () => {
    const { modelClient, service } = harness({ commits: [] });
    await expect(
      service.interpret({ groupKey, grouping: groupingRequest })
    ).rejects.toMatchObject({ failureCode: "EVIDENCE_SCOPE_INVALID" });
    expect(modelClient.interpret).not.toHaveBeenCalled();
  });

  it("sends only minimized normalized metadata and no source, diff, or raw payload", async () => {
    const { modelClient, service } = harness();
    await service.interpret({ groupKey, grouping: groupingRequest });

    const input = modelClient.interpret.mock.calls[0]?.[0];
    expect(input.commits[0]).toEqual({
      additions: 12,
      committedAt: "2026-09-20T10:00:00.000Z",
      deletions: 3,
      filePaths: [privatePath],
      id: "commit-1",
      message: privateMessage,
    });
    const serialized = JSON.stringify(input);
    expect(serialized).not.toMatch(/sourceCode|patch|diff|rawPayload|token|credential/i);
  });

  it("does not update ProjectState or create ContentOpportunity", async () => {
    const { contentOpportunity, projectState, service } = harness();
    await service.interpret({ groupKey, grouping: groupingRequest });
    expect(projectState.create).not.toHaveBeenCalled();
    expect(projectState.update).not.toHaveBeenCalled();
    expect(contentOpportunity.create).not.toHaveBeenCalled();
  });

  it("never logs evidence text, paths, API keys, or raw model output", async () => {
    const rawOutput = validOutput();
    const { logger, service } = harness({ outputs: [rawOutput] });
    await service.interpret({ groupKey, grouping: groupingRequest });
    const logs = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warnEvent.mock.calls,
      ...logger.errorEvent.mock.calls,
    ]);
    for (const sensitive of [
      privateMessage,
      privateTitle,
      privateBody,
      privatePath,
      rawOutput,
      "synthetic_openai_key_not_logged",
    ]) {
      expect(logs).not.toContain(sensitive);
    }
  });

  it.each([
    ["transient", new AIProviderError("AI_PROVIDER_TRANSIENT_FAILURE", true), true],
    ["configuration", new AIProviderError("AI_CONFIGURATION_FAILURE", false), false],
  ])("maps %s provider failures safely", async (_name, error, retryable) => {
    const { aIExecution, developmentEvent, logger, service } = harness({
      outputs: [error],
    });
    await expect(
      service.interpret({ groupKey, grouping: groupingRequest })
    ).rejects.toMatchObject({
      failureCode: error.failureCode,
      retryable,
    } satisfies Partial<DevelopmentEventInterpretationError>);
    expect(developmentEvent.create).not.toHaveBeenCalled();
    expect(aIExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failureCode: error.failureCode }),
      })
    );
    expect(JSON.stringify(logger.errorEvent.mock.calls)).not.toContain(error.message);
  });

  it("passes the exact ownership/window request through the unchanged grouping layer", async () => {
    const { grouping, service } = harness();
    await service.interpret({ groupKey, grouping: groupingRequest });
    expect(grouping.selectAndGroup).toHaveBeenCalledExactlyOnceWith(groupingRequest);
  });
});
