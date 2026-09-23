import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../database/prisma.service";
import type { StructuredLogger } from "../observability/structured-logger";
import {
  DevelopmentEventInterpretationError,
  type DevelopmentEventInterpreterService,
} from "./development-event-interpreter.service";
import type { EvidenceGroupingService } from "./evidence-grouping.service";
import type { ProjectStateProjectorService } from "./project-state-projector.service";
import {
  IntelligencePipelineError,
  IntelligencePipelineService,
} from "./intelligence-pipeline.service";

const projectId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const syncRunId = "30000000-0000-4000-8000-000000000001";
const repositoryId = "repository-1";
const runId = "40000000-0000-4000-8000-000000000001";
const leaseToken = "50000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-22T20:00:00.000Z");
const windowStart = new Date("2026-09-01T00:00:00.000Z");
const windowEnd = new Date("2026-09-22T19:00:00.000Z");

function group(id: string) {
  return {
    commitEvidenceIds: [`commit-${id}`],
    connectedRepositoryId: repositoryId,
    evidenceFrom: windowStart,
    evidenceTo: windowEnd,
    groupKey: id.padEnd(64, "a").slice(0, 64),
    groupingVersion: "evidence-grouping-v1",
    projectId,
    pullRequestEvidenceIds: [],
    reason: "standalone_commit_chain" as const,
  };
}

function harness(options: {
  groups?: ReturnType<typeof group>[];
  interpretations?: (
    | Error
    | {
        developmentEventId: string | null;
        eventStatus?: "active" | "rejected";
        status: string;
      }
  )[];
  sourceAvailable?: boolean;
} = {}) {
  const order: string[] = [];
  const groups = options.groups ?? [group("group-1")];
  const results = [
    ...(options.interpretations ?? [
      { developmentEventId: "event-1", eventStatus: "active", status: "created" },
    ]),
  ];
  let processingVersion = "";
  const logger = {
    errorEvent: vi.fn(),
    info: vi.fn(),
    warnEvent: vi.fn(),
  };
  const grouping = {
    selectAndGroup: vi.fn().mockImplementation(async () => {
      order.push("grouping");
      return groups;
    }),
  };
  const interpreter = {
    getProcessingVersion: vi.fn().mockReturnValue("interpretation-v1"),
    interpret: vi.fn().mockImplementation(async () => {
      order.push("interpretation");
      const result = results.shift() ?? {
        developmentEventId: "event-reused",
        eventStatus: "active",
        status: "reused",
      };
      if (result instanceof Error) throw result;
      return result;
    }),
  };
  const projector = {
    project: vi.fn().mockImplementation(async () => {
      order.push("projection");
      return {
        projectStateId: "state-1",
        projectStateVersionId: "state-version-1",
        replayFingerprint: "f".repeat(64),
        status: "created",
        version: 1,
      };
    }),
  };
  const source = {
    connectedRepository: { projectId },
    id: syncRunId,
    projectId,
    windowEnd,
    windowStart,
  };
  const intelligenceRun = {
    create: vi.fn().mockResolvedValue({ id: runId }),
    findFirst: vi.fn().mockImplementation(async () => ({
      id: runId,
      processingVersion,
      projectId,
      sourceWindowEnd: windowEnd,
      sourceWindowStart: windowStart,
      project: { userId },
    })),
    findUnique: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi
      .fn()
      .mockResolvedValue(options.sourceAvailable === false ? [] : [source]),
    intelligenceRun,
    syncRun: {
      findFirst: vi
        .fn()
        .mockResolvedValue(options.sourceAvailable === false ? null : source),
    },
  };
  const service = new IntelligencePipelineService(
    prisma as unknown as PrismaService,
    grouping as unknown as EvidenceGroupingService,
    interpreter as unknown as DevelopmentEventInterpreterService,
    projector as unknown as ProjectStateProjectorService,
    logger as unknown as StructuredLogger,
    () => now
  );
  processingVersion = service.versions.processingVersion;
  return {
    grouping,
    intelligenceRun,
    interpreter,
    logger,
    order,
    prisma,
    processingVersion: () => processingVersion,
    projector,
    service,
    setProcessingVersion: (value: string) => {
      processingVersion = value;
    },
  };
}

describe("IntelligencePipelineService", () => {
  it("makes only succeeded SyncRuns eligible for automatic processing", async () => {
    const test = harness();
    await expect(test.service.enqueueEligibleCompletedSync()).resolves.toBe(true);
    expect(String(test.prisma.$queryRaw.mock.calls[0]?.[0])).toContain("succeeded");
  });

  it("does not enqueue failed or incomplete synchronization boundaries", async () => {
    const test = harness({ sourceAvailable: false });
    await expect(test.service.enqueueEligibleCompletedSync()).resolves.toBe(false);
    expect(test.intelligenceRun.create).not.toHaveBeenCalled();
  });

  it("persists no repository evidence in the durable run payload", async () => {
    const test = harness();
    await test.service.enqueueEligibleCompletedSync();
    const serialized = JSON.stringify(
      test.intelligenceRun.create.mock.calls[0]?.[0]
    );
    expect(serialized).not.toMatch(
      /commit|pullRequest|message|title|body|filePath|prompt|response|token/i
    );
  });

  it("runs grouping before interpretation and interpretation before projection", async () => {
    const test = harness();
    await test.service.executeClaimed(runId, leaseToken);
    expect(test.order).toEqual(["grouping", "interpretation", "projection"]);
  });

  it("processes multiple groups independently before one projection", async () => {
    const test = harness({ groups: [group("a"), group("b"), group("c")] });
    await test.service.executeClaimed(runId, leaseToken);
    expect(test.interpreter.interpret).toHaveBeenCalledTimes(3);
    expect(test.projector.project).toHaveBeenCalledOnce();
  });

  it("counts accepted and low-confidence rejected events separately", async () => {
    const test = harness({
      groups: [group("a"), group("b")],
      interpretations: [
        { developmentEventId: "event-a", eventStatus: "active", status: "created" },
        { developmentEventId: "event-b", eventStatus: "rejected", status: "created" },
      ],
    });
    await test.service.executeClaimed(runId, leaseToken);
    expect(test.intelligenceRun.updateMany.mock.calls[0]?.[0].data).toMatchObject({
      groupsDiscovered: 2,
      groupsFailed: 0,
      groupsRejected: 1,
      groupsSucceeded: 1,
    });
  });

  it("completes an all-rejected run without counting semantic success", async () => {
    const test = harness({
      groups: [group("a"), group("b")],
      interpretations: [
        { developmentEventId: "event-a", eventStatus: "rejected", status: "created" },
        { developmentEventId: "event-b", eventStatus: "rejected", status: "created" },
      ],
    });
    await test.service.executeClaimed(runId, leaseToken);
    expect(test.intelligenceRun.updateMany.mock.calls[0]?.[0].data).toMatchObject({
      groupsRejected: 2,
      groupsSucceeded: 0,
    });
    expect(test.intelligenceRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "succeeded" }) })
    );
  });

  it("counts accepted plus insufficient-evidence decisions consistently", async () => {
    const test = harness({
      groups: [group("a"), group("b")],
      interpretations: [
        { developmentEventId: "event-a", eventStatus: "active", status: "created" },
        { developmentEventId: null, status: "insufficient_evidence" },
      ],
    });
    await test.service.executeClaimed(runId, leaseToken);
    expect(test.intelligenceRun.updateMany.mock.calls[0]?.[0].data).toMatchObject({
      groupsRejected: 1,
      groupsSucceeded: 1,
    });
  });

  it("defers projection when any group has a retryable failure", async () => {
    const test = harness({
      groups: [group("a"), group("b"), group("c")],
      interpretations: [
        { developmentEventId: "event-a", status: "created" },
        new DevelopmentEventInterpretationError(
          "AI_PROVIDER_TRANSIENT_FAILURE",
          true
        ),
        { developmentEventId: "event-c", status: "created" },
      ],
    });
    await expect(
      test.service.executeClaimed(runId, leaseToken)
    ).rejects.toMatchObject({
      failureCode: "INTELLIGENCE_GROUP_RETRYABLE_FAILURE",
      retryable: true,
    });
    expect(test.interpreter.interpret).toHaveBeenCalledTimes(3);
    expect(test.projector.project).not.toHaveBeenCalled();
  });

  it("preserves successful groups and projects before a terminal partial failure", async () => {
    const test = harness({
      groups: [group("a"), group("b"), group("c")],
      interpretations: [
        { developmentEventId: "event-a", status: "created" },
        new DevelopmentEventInterpretationError("AI_OUTPUT_INVALID"),
        { developmentEventId: "event-c", status: "created" },
      ],
    });
    await expect(
      test.service.executeClaimed(runId, leaseToken)
    ).rejects.toMatchObject({
      failureCode: "INTELLIGENCE_GROUP_TERMINAL_FAILURE",
      retryable: false,
    });
    expect(test.projector.project).toHaveBeenCalledOnce();
  });

  it("treats insufficient evidence as a completed non-retry decision", async () => {
    const test = harness({
      interpretations: [
        { developmentEventId: null, status: "insufficient_evidence" },
      ],
    });
    await test.service.executeClaimed(runId, leaseToken);
    expect(test.projector.project).toHaveBeenCalledOnce();
    expect(
      test.intelligenceRun.updateMany.mock.calls[0]?.[0].data.groupsRejected
    ).toBe(1);
  });

  it("propagates the latest provider Retry-After boundary", async () => {
    const retryAfterAt = new Date("2026-09-22T21:00:00.000Z");
    const test = harness({
      interpretations: [
        new DevelopmentEventInterpretationError(
          "AI_PROVIDER_TRANSIENT_FAILURE",
          true,
          retryAfterAt
        ),
      ],
    });
    await expect(
      test.service.executeClaimed(runId, leaseToken)
    ).rejects.toMatchObject({ retryAfterAt });
  });

  it("marks a fully stable cycle succeeded under its lease", async () => {
    const test = harness();
    await test.service.executeClaimed(runId, leaseToken);
    expect(test.intelligenceRun.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "succeeded", finishedAt: now }),
        where: expect.objectContaining({ leaseToken }),
      })
    );
  });

  it("fails safely when the durable lease is missing", async () => {
    const test = harness();
    test.intelligenceRun.findFirst.mockResolvedValueOnce(null);
    await expect(
      test.service.executeClaimed(runId, leaseToken)
    ).rejects.toMatchObject({ failureCode: "INTELLIGENCE_LEASE_LOST" });
    expect(test.grouping.selectAndGroup).not.toHaveBeenCalled();
  });

  it("refuses to execute a queued run from a stale processing version", async () => {
    const test = harness();
    test.setProcessingVersion("stale-version");
    await expect(
      test.service.executeClaimed(runId, leaseToken)
    ).rejects.toMatchObject({ failureCode: "INTELLIGENCE_VERSION_STALE" });
  });

  it("terminalizes only stale queued, retryable, or expired running versions", async () => {
    const test = harness();
    await expect(test.service.terminalizeStaleActiveRuns()).resolves.toBe(0);
    const sql = String(test.prisma.$executeRaw.mock.calls[0]?.[0]);
    expect(sql).toContain("INTELLIGENCE_VERSION_STALE");
    expect(sql).toContain("leaseExpiresAt");
    expect(sql).toContain("processingVersion");
  });

  it("selects only the latest succeeded boundary lacking the current version", async () => {
    const test = harness();
    await test.service.enqueueEligibleCompletedSync();
    const sql = String(test.prisma.$queryRaw.mock.calls[0]?.[0]);
    expect(sql).toContain("DISTINCT ON");
    expect(sql).toContain("processingVersion");
    expect(sql).toContain("failed_retryable");
  });

  it("creates explicit owned reprocessing from the latest successful SyncRun", async () => {
    const test = harness();
    await expect(
      test.service.enqueueReprocessing(projectId, userId)
    ).resolves.toEqual({ intelligenceRunId: runId, status: "queued" });
    expect(test.prisma.syncRun.findFirst.mock.calls[0]?.[0].where).toMatchObject({
      connectedRepository: { projectId, project: { userId } },
      status: "succeeded",
    });
  });

  it("reuses an existing reprocessing boundary with identical versions", async () => {
    const test = harness();
    test.intelligenceRun.findUnique.mockResolvedValueOnce({ id: "existing-run" });
    await expect(
      test.service.enqueueReprocessing(projectId, userId)
    ).resolves.toEqual({
      intelligenceRunId: "existing-run",
      status: "reused",
    });
    expect(test.intelligenceRun.create).not.toHaveBeenCalled();
  });

  it("resolves an explicit historical succeeded source instead of selecting the latest boundary", async () => {
    const historicalSourceId = "historical-source";
    const test = harness({ groups: [group("historical-a"), group("historical-b")] });
    test.prisma.syncRun.findFirst.mockImplementation(async (args) => {
      expect(args.where.id).toBe(historicalSourceId);
      expect(args.orderBy).toBeUndefined();
      return { id: historicalSourceId, windowEnd, windowStart };
    });
    await expect(test.service.resolveReprocessingSource({ connectedRepositoryId: repositoryId, projectId, sourceSyncRunId: historicalSourceId, userId })).resolves.toMatchObject({ candidateGroupCount: 2, currentRun: null, sourceSyncRunId: historicalSourceId });
  });

  it.each(["unknown", "non-succeeded", "wrong Project", "wrong repository"])("rejects %s explicit source selection", async () => {
    const test = harness();
    test.prisma.syncRun.findFirst.mockResolvedValueOnce(null);
    await expect(test.service.resolveReprocessingSource({ connectedRepositoryId: repositoryId, projectId, sourceSyncRunId: syncRunId, userId })).rejects.toMatchObject({ failureCode: "INTELLIGENCE_SOURCE_NOT_AVAILABLE" });
    expect(test.grouping.selectAndGroup).not.toHaveBeenCalled();
  });

  it("validates explicit source scope and connection state", async () => {
    const test = harness();
    await test.service.resolveReprocessingSource({ connectedRepositoryId: repositoryId, projectId, sourceSyncRunId: syncRunId, userId });
    expect(test.prisma.syncRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: syncRunId, status: "succeeded", connectedRepository: expect.objectContaining({ id: repositoryId, projectId, status: "active", gitHubConnection: { status: "active" }, project: { userId } }) }) }));
  });

  it("prevents a duplicate current-version historical run", async () => {
    const test = harness();
    test.intelligenceRun.findUnique.mockResolvedValueOnce({ id: "current-run", status: "succeeded" });
    await expect(test.service.enqueueReprocessingForSource({ connectedRepositoryId: repositoryId, projectId, sourceSyncRunId: syncRunId, userId })).resolves.toEqual({ intelligenceRunId: "current-run", status: "reused" });
    expect(test.intelligenceRun.create).not.toHaveBeenCalled();
  });

  it("does not let an old processing-version run block a current explicit source", async () => {
    const test = harness();
    test.intelligenceRun.findUnique.mockResolvedValueOnce(null);
    await expect(test.service.enqueueReprocessingForSource({ connectedRepositoryId: repositoryId, projectId, sourceSyncRunId: syncRunId, userId })).resolves.toEqual({ intelligenceRunId: runId, status: "queued" });
    expect(test.intelligenceRun.findUnique).toHaveBeenCalledWith({ select: { id: true, status: true }, where: { sourceSyncRunId_processingVersion: { processingVersion: test.processingVersion(), sourceSyncRunId: syncRunId } } });
  });

  it("preserves the one-active-run invariant when a concurrent explicit enqueue is rejected", async () => {
    const test = harness();
    test.intelligenceRun.create.mockRejectedValueOnce(Object.assign(new Error("active run"), { code: "P2002" }));
    await expect(test.service.enqueueReprocessingForSource({ connectedRepositoryId: repositoryId, projectId, sourceSyncRunId: syncRunId, userId })).rejects.toMatchObject({ failureCode: "INTELLIGENCE_PERSISTENCE_FAILURE", retryable: true });
    expect(test.intelligenceRun.create).toHaveBeenCalledOnce();
  });

  it("changes the aggregate processing version when interpretation changes", () => {
    const first = harness();
    const second = harness();
    second.interpreter.getProcessingVersion.mockReturnValue("interpretation-v2");
    const changed = new IntelligencePipelineService(
      second.prisma as unknown as PrismaService,
      second.grouping as unknown as EvidenceGroupingService,
      second.interpreter as unknown as DevelopmentEventInterpreterService,
      second.projector as unknown as ProjectStateProjectorService,
      second.logger as unknown as StructuredLogger,
      () => now
    );
    expect(changed.versions.processingVersion).not.toBe(
      first.service.versions.processingVersion
    );
  });

  it("does not expose private semantic text in orchestration logs", async () => {
    const test = harness();
    await test.service.executeClaimed(runId, leaseToken);
    expect(JSON.stringify(test.logger)).not.toMatch(
      /private commit|private pull request|source code/i
    );
  });

  it("requires no GitHub provider access when processing persisted evidence", async () => {
    const test = harness();
    await test.service.executeClaimed(runId, leaseToken);
    expect(test.prisma).not.toHaveProperty("gitHubApi");
  });

  it("fails closed when no owned successful source exists for reprocessing", async () => {
    const test = harness({ sourceAvailable: false });
    await expect(
      test.service.enqueueReprocessing(projectId, userId)
    ).rejects.toBeInstanceOf(IntelligencePipelineError);
  });
});
