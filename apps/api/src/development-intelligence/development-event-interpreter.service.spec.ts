import { describe, expect, it, vi } from "vitest";
import type { DevelopmentEventModelClient } from "@developer-brand-copilot/ai";

import type { PrismaService } from "../database/prisma.service";
import type { StructuredLogger } from "../observability/structured-logger";
import {
  developmentEventInterpretationVersion,
  developmentEventLifecyclePolicyVersion,
  developmentEventScoringPolicy,
  DevelopmentEventInterpretationError,
  DevelopmentEventInterpreterService,
} from "./development-event-interpreter.service";
import type { EvidenceGroupingService } from "./evidence-grouping.service";
import type { CandidateEvidenceGroup } from "./evidence-grouping.types";
import { AIProviderError } from "./openai-development-event-model.service";
import { ProjectStateProjectorService } from "./project-state-projector.service";

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
  readonly key?: string;
  readonly pullRequestIds?: readonly string[];
  readonly reason?: "merged_pull_request" | "standalone_commit_chain";
} = {}): CandidateEvidenceGroup {
  return {
    commitEvidenceIds: options.commitIds ?? ["commit-1"],
    connectedRepositoryId: repositoryId,
    evidenceFrom: new Date("2026-09-20T10:00:00.000Z"),
    evidenceTo: new Date("2026-09-20T12:00:00.000Z"),
    groupKey: options.key ?? groupKey,
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
      relatedFeatureIds: [],
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
  readonly commitEvidence?: readonly {
    readonly commitSha: string;
    readonly gitHubCommitId: string | null;
    readonly repositoryProviderId: bigint | null;
  }[];
  readonly commitIds?: readonly string[];
  readonly eventKey?: string;
  readonly extractionVersion: string;
  readonly id: string;
  readonly inputFingerprint?: string;
  readonly pullRequestIds?: readonly string[];
  readonly pullRequestEvidence?: readonly {
    readonly gitHubPullRequestId: string | null;
    readonly providerPullRequestId: bigint;
    readonly repositoryProviderId: bigint | null;
  }[];
  readonly relatedFeatureIds?: readonly string[];
  readonly summary?: string;
  readonly title?: string;
  readonly type?: string;
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
          projectId_eventKey_extractionVersion_inputFingerprint: {
            eventKey: string;
            extractionVersion: string;
            inputFingerprint: string;
          };
        };
      }) =>
        storedEvents.find(
          (event) =>
            event.extractionVersion ===
              args.where.projectId_eventKey_extractionVersion_inputFingerprint.extractionVersion &&
            (event.eventKey ?? group.groupKey) ===
              args.where.projectId_eventKey_extractionVersion_inputFingerprint.eventKey &&
            event.inputFingerprint ===
              args.where.projectId_eventKey_extractionVersion_inputFingerprint.inputFingerprint
        ) ?? null
    ),
    findFirst: vi.fn().mockImplementation(async () => {
      return [...storedEvents].reverse().find((event) => event.status === "active") ?? null;
    }),
    findMany: vi.fn().mockImplementation(async (args: { where?: { type?: unknown } } = {}) => {
      if (args.where?.type) {
        return [...storedEvents]
          .filter((event) => event.status === "active")
          .map((event) => ({
            relatedFeatureIds: event.relatedFeatureIds ?? [],
            summary: event.summary ?? "Synthetic feature context",
            title: event.title ?? "Synthetic feature",
            type: event.type ?? "feature_started",
          }));
      }
      return [...storedEvents]
        .reverse()
        .filter((event) => event.status === "active")
        .map((event) => ({
          ...event,
          commitEvidence:
            event.commitEvidence ??
            (event.commitIds ?? ["commit-1"]).map((gitHubCommitId) => ({
              commitSha: gitHubCommitId === "commit-2" ? secondSha : firstSha,
              gitHubCommitId,
              repositoryProviderId: 101n,
            })),
          createdAt: new Date("2026-09-20T12:00:00.000Z"),
          pullRequestEvidence:
            event.pullRequestEvidence ??
            (
              event.pullRequestIds ??
              (group.pullRequestEvidenceIds.length > 0 ? ["pr-1"] : [])
            ).map((gitHubPullRequestId) => ({
              gitHubPullRequestId,
              providerPullRequestId: 101n,
              repositoryProviderId: 101n,
            })),
        }));
    }),
    create: vi.fn().mockImplementation(
      async (args: {
        data: {
          commitEvidence: {
            create: {
              commitSha: string;
              gitHubCommitId: string;
              repositoryProviderId: bigint;
            }[];
          };
          eventKey: string;
          extractionVersion: string;
          inputFingerprint: string;
          pullRequestEvidence: {
            create: {
              gitHubPullRequestId: string;
              providerPullRequestId: bigint;
              repositoryProviderId: bigint;
            }[];
          };
          relatedFeatureIds: string[];
          summary: string;
          status: string;
          title: string;
          type: string;
        };
      }) => {
        const event = {
          commitIds: args.data.commitEvidence.create.map((link) => link.gitHubCommitId),
          commitEvidence: args.data.commitEvidence.create,
          eventKey: args.data.eventKey,
          extractionVersion: args.data.extractionVersion,
          id: `event-${storedEvents.length + 1}`,
          inputFingerprint: args.data.inputFingerprint,
          pullRequestIds: args.data.pullRequestEvidence.create.map(
            (link) => link.gitHubPullRequestId
          ),
          pullRequestEvidence: args.data.pullRequestEvidence.create,
          relatedFeatureIds: args.data.relatedFeatureIds,
          summary: args.data.summary,
          status: args.data.status,
          title: args.data.title,
          type: args.data.type,
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
    updateMany: vi.fn().mockImplementation(
      async (args: { where: { id: { in: string[] } }; data: { status: string } }) => {
        for (const event of storedEvents) {
          if (args.where.id.in.includes(event.id)) event.status = args.data.status;
        }
        return { count: args.where.id.in.length };
      }
    ),
  };
  const storedExecutions: Record<string, unknown>[] = [];
  const aIExecution = {
    count: vi.fn().mockImplementation(
      async (args: { where?: { startedAt?: unknown } }) =>
        args.where?.startedAt
          ? (options.dailyAttempts ?? 0)
          : aIExecution.create.mock.calls.length
    ),
    create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => {
      const execution = {
        id: `execution-${aIExecution.create.mock.calls.length}`,
        status: "running",
        validationStatus: "pending",
        ...args.data,
      };
      storedExecutions.push(execution);
      return { id: execution.id };
    }),
    findFirst: vi.fn().mockImplementation(async (args: { where: Record<string, unknown> }) =>
      [...storedExecutions]
        .reverse()
        .find((execution) =>
          Object.entries(args.where).every(
            ([key, value]) => execution[key] === value
          )
        ) ?? null
    ),
    update: vi.fn().mockImplementation(async (args: {
      data: Record<string, unknown>;
      where: { id: string };
    }) => {
      const execution = storedExecutions.find((item) => item.id === args.where.id);
      if (execution) Object.assign(execution, args.data);
      return execution ?? {};
    }),
  };
  const prisma = {
    aIExecution,
    contentOpportunity,
    connectedRepository: {
      findFirst: vi.fn().mockResolvedValue({ providerRepositoryId: 101n }),
    },
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

    expect(result).toEqual({
      developmentEventId: "event-1",
      eventStatus: "active",
      status: "created",
    });
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
        {
          commitSha: firstSha,
          gitHubCommitId: "commit-1",
          repositoryProviderId: 101n,
          role: "supporting",
        },
        {
          commitSha: secondSha,
          gitHubCommitId: "commit-2",
          repositoryProviderId: 101n,
          role: "supporting",
        },
      ]);
  });

  it("persists merged PR provenance with its stable provider identity", async () => {
    const { developmentEvent, service } = harness();
    await service.interpret({ groupKey, grouping: groupingRequest });

    expect(developmentEvent.create.mock.calls[0]?.[0].data.pullRequestEvidence.create)
      .toEqual([
        {
          gitHubPullRequestId: "pr-1",
          providerPullRequestId: 101n,
          repositoryProviderId: 101n,
          role: "supporting",
        },
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
    expect(aIExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          extractionVersion: service.getProcessingVersion(),
        }),
      })
    );
  });

  it("reuses a persisted insufficient-evidence decision only for the exact interpretation boundary", async () => {
    const insufficient = JSON.stringify({
      decision: "insufficient_evidence",
      event: null,
      reason: "insufficient_detail",
    });
    const test = harness({ outputs: [insufficient] });
    await test.service.interpret({ groupKey, grouping: groupingRequest });
    await expect(
      test.service.interpret({ groupKey, grouping: groupingRequest })
    ).resolves.toEqual({
      developmentEventId: null,
      status: "insufficient_evidence",
    });
    expect(test.modelClient.interpret).toHaveBeenCalledOnce();
    expect(test.aIExecution.create).toHaveBeenCalledOnce();
    expect(test.aIExecution.findFirst).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        extractionVersion: test.service.getProcessingVersion(),
        failureCode: "INSUFFICIENT_EVIDENCE",
        inputFingerprint: expect.any(String),
        modelConfigurationFingerprint: expect.any(String),
        promptVersion: "development-event-prompt-v2",
        schemaVersion: "development-event-schema-v2",
        stage: "development_event_interpretation",
        status: "rejected",
        validationStatus: "valid",
      }),
      select: { id: true },
    });
  });

  it("re-attempts insufficient evidence after a model configuration boundary change", async () => {
    const insufficient = JSON.stringify({
      decision: "insufficient_evidence",
      event: null,
      reason: "insufficient_detail",
    });
    const shared = harness({ outputs: [insufficient, validOutput()] });
    await shared.service.interpret({ groupKey, grouping: groupingRequest });
    const updatedService = new DevelopmentEventInterpreterService(
      shared.prisma as unknown as PrismaService,
      shared.grouping as unknown as EvidenceGroupingService,
      shared.modelClient as unknown as DevelopmentEventModelClient,
      { apiKey: "synthetic_key_not_logged", model: "configured-test-model-v2" },
      shared.logger as unknown as StructuredLogger
    );

    await expect(
      updatedService.interpret({ groupKey, grouping: groupingRequest })
    ).resolves.toMatchObject({ status: "created" });
    expect(shared.modelClient.interpret).toHaveBeenCalledTimes(2);
  });

  it("makes scoring and lifecycle semantic versions part of the persisted reuse boundary", () => {
    const base = {
      lifecyclePolicyVersion: developmentEventLifecyclePolicyVersion,
      modelConfigurationFingerprint: "a".repeat(64),
      promptVersion: "development-event-prompt-v2",
      scoringPolicyVersion: developmentEventScoringPolicy.version,
      schemaVersion: "development-event-schema-v2",
    };
    const current = developmentEventInterpretationVersion(base);

    expect(
      developmentEventInterpretationVersion({
        ...base,
        scoringPolicyVersion: "development-event-scoring-v2",
      })
    ).not.toBe(current);
    expect(
      developmentEventInterpretationVersion({
        ...base,
        lifecyclePolicyVersion: "development-event-lifecycle-v2",
      })
    ).not.toBe(current);
  });

  it("does not reuse insufficient evidence for changed prepared input", async () => {
    const insufficient = JSON.stringify({
      decision: "insufficient_evidence",
      event: null,
      reason: "insufficient_detail",
    });
    const test = harness({
      outputs: [
        insufficient,
        validOutput({
          evidenceRefs: { commitIds: ["commit-2"], pullRequestIds: [] },
        }),
      ],
    });
    await test.service.interpret({ groupKey, grouping: groupingRequest });
    const unrelatedGroup = candidate({
      commitIds: ["commit-2"],
      key: "b".repeat(64),
      pullRequestIds: [],
      reason: "standalone_commit_chain",
    });
    test.grouping.selectAndGroup.mockResolvedValue([unrelatedGroup]);
    test.prisma.gitHubCommit.findMany.mockResolvedValue([
      {
        additions: 1,
        committedAt: new Date("2026-09-20T13:00:00.000Z"),
        deletions: 0,
        files: [{ path: "src/unrelated.ts" }],
        id: "commit-2",
        message: "Unrelated candidate",
        sha: secondSha,
      },
    ]);
    test.prisma.gitHubPullRequest.findMany.mockResolvedValue([]);

    await expect(
      test.service.interpret({ groupKey: unrelatedGroup.groupKey, grouping: groupingRequest })
    ).resolves.toMatchObject({ status: "created" });
    expect(test.modelClient.interpret).toHaveBeenCalledTimes(2);
    const fingerprints = test.aIExecution.findFirst.mock.calls.map(
      (call) => call[0].where.inputFingerprint
    );
    expect(new Set(fingerprints).size).toBe(2);
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
    await expect(
      service.interpret({ groupKey, grouping: groupingRequest })
    ).resolves.toMatchObject({ eventStatus: "rejected" });
    expect(developmentEvent.create.mock.calls[0]?.[0].data.status).toBe("rejected");
    expect(developmentEvent.findFirst).not.toHaveBeenCalled();
  });

  it("treats confidence exactly at 0.60 as active", async () => {
    const { developmentEvent, service } = harness({
      outputs: [validOutput({ confidence: 0.6 })],
    });
    await expect(
      service.interpret({ groupKey, grouping: groupingRequest })
    ).resolves.toMatchObject({ eventStatus: "active" });
    expect(developmentEvent.create.mock.calls[0]?.[0].data.status).toBe("active");
  });

  it("preserves every candidate link while marking only selected support", async () => {
    const group = candidate({ commitIds: ["commit-1", "commit-2"], pullRequestIds: [] });
    const test = harness({
      group,
      pullRequests: [],
      commits: [
        {
          additions: 1,
          committedAt: new Date("2026-09-20T10:00:00.000Z"),
          deletions: 0,
          files: [{ path: "src/one.ts" }],
          id: "commit-1",
          message: "Candidate context",
          sha: firstSha,
        },
        {
          additions: 2,
          committedAt: new Date("2026-09-20T11:00:00.000Z"),
          deletions: 0,
          files: [{ path: "src/two.ts" }],
          id: "commit-2",
          message: "Direct support",
          sha: secondSha,
        },
      ],
      outputs: [
        validOutput({
          evidenceRefs: { commitIds: ["commit-2"], pullRequestIds: [] },
        }),
      ],
    });

    await test.service.interpret({ groupKey, grouping: groupingRequest });
    expect(test.developmentEvent.create.mock.calls[0]?.[0].data.commitEvidence.create)
      .toEqual([
        {
          commitSha: firstSha,
          gitHubCommitId: "commit-1",
          repositoryProviderId: 101n,
          role: "candidate",
        },
        {
          commitSha: secondSha,
          gitHubCommitId: "commit-2",
          repositoryProviderId: 101n,
          role: "supporting",
        },
      ]);
  });

  it("keeps feature identity stable and supersedes [A] when the group evolves to [A,B]", async () => {
    const firstGroup = candidate({ commitIds: ["commit-1"], pullRequestIds: [], key: "a".repeat(64) });
    const test = harness({
      group: firstGroup,
      pullRequests: [],
      outputs: [
        validOutput({
          type: "feature_started",
          evidenceRefs: { commitIds: ["commit-1"], pullRequestIds: [] },
        }),
        validOutput({
          type: "feature_completed",
          evidenceRefs: { commitIds: ["commit-2"], pullRequestIds: [] },
        }),
      ],
    });
    await test.service.interpret({ groupKey: firstGroup.groupKey, grouping: groupingRequest });
    const startedFeatureIds = test.developmentEvent.create.mock.calls[0]?.[0].data.relatedFeatureIds;

    const evolvedGroup = candidate({
      commitIds: ["commit-1", "commit-2"],
      pullRequestIds: [],
      key: "b".repeat(64),
    });
    test.grouping.selectAndGroup.mockResolvedValue([evolvedGroup]);
    test.prisma.gitHubCommit.findMany.mockResolvedValue([
      {
        additions: 12,
        committedAt: new Date("2026-09-20T10:00:00.000Z"),
        deletions: 3,
        files: [{ path: privatePath }],
        id: "commit-1",
        message: privateMessage,
        sha: firstSha,
      },
      {
        additions: 2,
        committedAt: new Date("2026-09-20T11:00:00.000Z"),
        deletions: 0,
        files: [{ path: "src/private/synthetic-file.ts" }],
        id: "commit-2",
        message: "Complete feature",
        sha: secondSha,
      },
    ]);
    await test.service.interpret({ groupKey: evolvedGroup.groupKey, grouping: groupingRequest });

    expect(test.developmentEvent.create.mock.calls[1]?.[0].data.relatedFeatureIds)
      .toEqual(startedFeatureIds);
    expect(test.developmentEvent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["event-1"] }, status: "active" },
      data: { status: "superseded" },
    });

    let projectedState: Record<string, unknown> | null = null;
    const projectedEvents = test.developmentEvent.create.mock.calls
      .map((call, index) => ({
        ...call[0].data,
        createdAt: new Date(`2026-09-20T12:00:0${index}.000Z`),
        id: `event-${index + 1}`,
      }))
      .filter((created) =>
        test.storedEvents.some(
          (stored) => stored.id === created.id && stored.status === "active"
        )
      );
    const projectorPrisma = {
      $transaction: vi.fn().mockImplementation(async (callback) =>
        callback({
          developmentEvent: { findMany: vi.fn().mockResolvedValue(projectedEvents) },
          project: {
            findFirst: vi.fn().mockResolvedValue({
              createdAt: new Date("2026-09-01T00:00:00.000Z"),
              id: projectId,
            }),
          },
          projectState: {
            create: vi.fn().mockImplementation(async ({ data }) => {
              projectedState = { ...data, id: "state-1" };
              return { id: "state-1" };
            }),
            findUnique: vi.fn().mockResolvedValue(null),
          },
          projectStateVersion: {
            create: vi.fn().mockResolvedValue({ id: "state-version-1" }),
          },
        })
      ),
    };
    const projector = new ProjectStateProjectorService(
      projectorPrisma as unknown as PrismaService,
      test.logger as unknown as StructuredLogger
    );
    await projector.project({ projectId, userId });
    expect(projectedState).toMatchObject({
      activeFeatures: [],
      version: 1,
    });
    expect(
      (projectedState as unknown as { completedFeatures: unknown[] })
        .completedFeatures
    ).toHaveLength(1);
  });

  it("allows an independent completion to select one authoritative active feature", async () => {
    const startedGroup = candidate({ commitIds: ["commit-1"], pullRequestIds: [], key: "a".repeat(64) });
    const test = harness({
      group: startedGroup,
      pullRequests: [],
      outputs: [
        validOutput({
          relatedFeatureIds: [],
          type: "feature_started",
          evidenceRefs: { commitIds: ["commit-1"], pullRequestIds: [] },
        }),
      ],
    });
    await test.service.interpret({ groupKey: startedGroup.groupKey, grouping: groupingRequest });
    const featureId = test.developmentEvent.create.mock.calls[0]?.[0].data.relatedFeatureIds[0];
    const completionGroup = candidate({
      commitIds: ["commit-2"],
      key: "c".repeat(64),
      pullRequestIds: [],
      reason: "standalone_commit_chain",
    });
    test.grouping.selectAndGroup.mockResolvedValue([completionGroup]);
    test.prisma.gitHubCommit.findMany.mockResolvedValue([
      {
        additions: 2, committedAt: new Date("2026-09-21T10:00:00.000Z"), deletions: 0,
        files: [{ path: "src/complete.ts" }], id: "commit-2", message: "Complete feature", sha: secondSha,
      },
    ]);
    test.modelClient.interpret.mockResolvedValueOnce({
      inputTokens: 100,
      outputText: validOutput({
        relatedFeatureIds: [featureId],
        type: "feature_completed",
        evidenceRefs: { commitIds: ["commit-2"], pullRequestIds: [] },
      }),
      outputTokens: 50,
    });

    await test.service.interpret({ groupKey: completionGroup.groupKey, grouping: groupingRequest });
    expect(test.developmentEvent.create.mock.calls[1]?.[0].data.relatedFeatureIds)
      .toEqual([featureId]);
    expect(test.modelClient.interpret.mock.calls[1]?.[0].activeFeatures)
      .toEqual([expect.objectContaining({ id: featureId })]);
  });

  it("does not reconcile a partial overlap when neither candidate group contains the other", async () => {
    const currentGroup = candidate({
      commitIds: ["commit-2", "commit-3"],
      pullRequestIds: [],
      key: "b".repeat(64),
    });
    const test = harness({
      group: currentGroup,
      previous: {
        commitIds: ["commit-1", "commit-2"],
        eventKey: "a".repeat(64),
        extractionVersion: "older-extraction-version",
        id: "event-prior",
        pullRequestIds: [],
        status: "active",
      },
      pullRequests: [],
      commits: [
        {
          additions: 1,
          committedAt: new Date("2026-09-20T11:00:00.000Z"),
          deletions: 0,
          files: [{ path: "src/shared.ts" }],
          id: "commit-2",
          message: "Shared structural context",
          sha: secondSha,
        },
        {
          additions: 1,
          committedAt: new Date("2026-09-20T12:00:00.000Z"),
          deletions: 0,
          files: [{ path: "src/independent.ts" }],
          id: "commit-3",
          message: "Independent outcome",
          sha: "3".repeat(40),
        },
      ],
      outputs: [
        validOutput({
          type: "bug_fixed",
          evidenceRefs: { commitIds: ["commit-3"], pullRequestIds: [] },
        }),
      ],
    });

    await test.service.interpret({
      groupKey: currentGroup.groupKey,
      grouping: groupingRequest,
    });
    expect(test.developmentEvent.updateMany).not.toHaveBeenCalled();
    expect(test.developmentEvent.create.mock.calls[0]?.[0].data.supersedesEventId)
      .toBeNull();
  });

  it("reconciles detached commit provenance by retained repository identity and SHA", async () => {
    const test = harness({
      previous: {
        commitEvidence: [
          { commitSha: firstSha, gitHubCommitId: null, repositoryProviderId: 101n },
        ],
        extractionVersion: "older-extraction-version",
        id: "event-prior",
        pullRequestIds: [],
        status: "active",
      },
    });

    await test.service.interpret({ groupKey, grouping: groupingRequest });
    expect(test.developmentEvent.updateMany).toHaveBeenCalledWith({
      data: { status: "superseded" },
      where: { id: { in: ["event-prior"] }, status: "active" },
    });
  });

  it.each([
    ["legacy detached commit without repository identity", null],
    ["commit from another repository", 202n],
  ])("does not reconcile %s", async (_label, repositoryProviderId) => {
    const test = harness({
      previous: {
        commitEvidence: [
          { commitSha: firstSha, gitHubCommitId: null, repositoryProviderId },
        ],
        extractionVersion: "older-extraction-version",
        id: "event-prior",
        pullRequestIds: [],
        status: "active",
      },
    });

    await test.service.interpret({ groupKey, grouping: groupingRequest });
    expect(test.developmentEvent.updateMany).not.toHaveBeenCalled();
  });

  it("reconciles attached PR [A] when the group evolves to [A,B]", async () => {
    const group = candidate({ commitIds: [], pullRequestIds: ["pr-1", "pr-2"] });
    const test = harness({
      group,
      commits: [],
      previous: {
        commitIds: [],
        extractionVersion: "older-extraction-version",
        id: "event-prior",
        pullRequestEvidence: [
          {
            gitHubPullRequestId: "pr-1",
            providerPullRequestId: 101n,
            repositoryProviderId: 101n,
          },
        ],
        status: "active",
      },
      pullRequests: [
        {
          additions: 1, bodySummary: null, deletions: 0, files: [], id: "pr-1",
          mergedAt: new Date("2026-09-20T12:00:00.000Z"), providerPullRequestId: 101n,
          title: "First PR",
        },
        {
          additions: 1, bodySummary: null, deletions: 0, files: [], id: "pr-2",
          mergedAt: new Date("2026-09-20T13:00:00.000Z"), providerPullRequestId: 102n,
          title: "Second PR",
        },
      ],
      outputs: [
        validOutput({ evidenceRefs: { commitIds: [], pullRequestIds: ["pr-1", "pr-2"] } }),
      ],
    });

    await test.service.interpret({ groupKey, grouping: groupingRequest });
    expect(test.developmentEvent.updateMany).toHaveBeenCalledOnce();
  });

  it("reconciles detached PR provenance by retained repository and provider PR identity", async () => {
    const group = candidate({ commitIds: [], pullRequestIds: ["pr-1"] });
    const test = harness({
      group,
      commits: [],
      previous: {
        commitIds: [],
        extractionVersion: "older-extraction-version",
        id: "event-prior",
        pullRequestEvidence: [
          {
            gitHubPullRequestId: null,
            providerPullRequestId: 101n,
            repositoryProviderId: 101n,
          },
        ],
        status: "active",
      },
      outputs: [validOutput({ evidenceRefs: { commitIds: [], pullRequestIds: ["pr-1"] } })],
    });

    await test.service.interpret({ groupKey, grouping: groupingRequest });
    expect(test.developmentEvent.updateMany).toHaveBeenCalledOnce();
  });

  it.each([
    ["legacy detached PR without repository identity", null],
    ["PR from another repository", 202n],
  ])("does not reconcile %s", async (_label, repositoryProviderId) => {
    const group = candidate({ commitIds: [], pullRequestIds: ["pr-1"] });
    const test = harness({
      group,
      commits: [],
      previous: {
        commitIds: [],
        extractionVersion: "older-extraction-version",
        id: "event-prior",
        pullRequestEvidence: [
          {
            gitHubPullRequestId: null,
            providerPullRequestId: 101n,
            repositoryProviderId,
          },
        ],
        status: "active",
      },
      outputs: [validOutput({ evidenceRefs: { commitIds: [], pullRequestIds: ["pr-1"] } })],
    });

    await test.service.interpret({ groupKey, grouping: groupingRequest });
    expect(test.developmentEvent.updateMany).not.toHaveBeenCalled();
  });

  it("reuses the same event for unchanged input and interpretation version", async () => {
    const { developmentEvent, modelClient, service } = harness();
    const first = await service.interpret({ groupKey, grouping: groupingRequest });
    const second = await service.interpret({ groupKey, grouping: groupingRequest });

    expect(first).toEqual({ developmentEventId: "event-1", eventStatus: "active", status: "created" });
    expect(second).toEqual({ developmentEventId: "event-1", eventStatus: "active", status: "reused" });
    expect(modelClient.interpret).toHaveBeenCalledOnce();
    expect(developmentEvent.create).toHaveBeenCalledOnce();
  });

  it("does not reuse an event when active-feature context changes the prepared input", async () => {
    const test = harness();
    test.storedEvents.push({
      commitIds: ["commit-1"],
      eventKey: groupKey,
      extractionVersion: test.service.getProcessingVersion(),
      id: "event-before-feature-context",
      pullRequestIds: ["pr-1"],
      relatedFeatureIds: ["feature-1"],
      status: "active",
      type: "feature_started",
    });

    await expect(
      test.service.interpret({ groupKey, grouping: groupingRequest })
    ).resolves.toMatchObject({ status: "created" });
    expect(test.modelClient.interpret).toHaveBeenCalledOnce();
    expect(test.developmentEvent.updateMany).toHaveBeenCalledWith({
      data: { status: "superseded" },
      where: {
        id: { in: ["event-before-feature-context"] },
        status: "active",
      },
    });
  });

  it("recovers a duplicate-write race only through the complete input identity", async () => {
    const test = harness();
    test.developmentEvent.create.mockImplementationOnce(async ({ data }) => {
      test.storedEvents.push({
        commitIds: ["commit-1"],
        eventKey: data.eventKey,
        extractionVersion: data.extractionVersion,
        id: "event-raced",
        inputFingerprint: data.inputFingerprint,
        pullRequestIds: ["pr-1"],
        status: "active",
      });
      throw Object.assign(new Error("duplicate"), { code: "P2002" });
    });

    await expect(
      test.service.interpret({ groupKey, grouping: groupingRequest })
    ).resolves.toEqual({
      developmentEventId: "event-raced",
      eventStatus: "active",
      status: "reused",
    });
    expect(test.developmentEvent.findUnique).toHaveBeenLastCalledWith({
      select: { id: true, status: true },
      where: {
        projectId_eventKey_extractionVersion_inputFingerprint: {
          eventKey: groupKey,
          extractionVersion: test.service.getProcessingVersion(),
          inputFingerprint: expect.any(String),
          projectId,
        },
      },
    });
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
    expect(result).toEqual({ developmentEventId: "event-2", eventStatus: "active", status: "created" });
    expect(shared.developmentEvent.create.mock.calls[1]?.[0].data.supersedesEventId)
      .toBe("event-1");
    expect(shared.developmentEvent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["event-1"] }, status: "active" },
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

    expect(shared.developmentEvent.updateMany.mock.calls[0]?.[0].data)
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
    ["request invalid", new AIProviderError("AI_REQUEST_INVALID", false), false],
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
