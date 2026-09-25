import { BadRequestException, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../database/prisma.service";
import type { StructuredLogger } from "../observability/structured-logger";
import type { OpportunityRunService } from "./opportunity-run.service";
import {
  opportunityListDefaultLimit,
  opportunityListMaximumLimit,
  OpportunityReadService,
  opportunityReasonSignalMaximum,
  opportunityProvenanceMaximum,
} from "./opportunity-read.service";

const projectId = "323e4567-e89b-42d3-a456-426614174000";
const otherProjectId = "423e4567-e89b-42d3-a456-426614174000";
const userId = "123e4567-e89b-42d3-a456-426614174000";
const eventId = "523e4567-e89b-42d3-a456-426614174000";
const secondEventId = "623e4567-e89b-42d3-a456-426614174000";
const firstOpportunityId = "723e4567-e89b-42d3-a456-426614174000";
const secondOpportunityId = "823e4567-e89b-42d3-a456-426614174000";
const currentProcessingVersion = "phase3-current-processing-version";
const at = new Date("2026-09-24T12:00:00.000Z");

function event(id = eventId, ownerProjectId = projectId) {
  return { developmentEvent: {
    id, projectId: ownerProjectId, occurredAt: at, title: `Safe event ${id}`, type: "feature_completed" as const,
  } };
}

function opportunity(overrides: Record<string, unknown> = {}) {
  return {
    candidateKey: "a".repeat(64), confidence: 0.91, createdAt: at, id: firstOpportunityId,
    noveltyScore: 0.8, opportunityType: "feature_showcase" as const, priorityScore: 0.88,
    recommendedFormat: "technical_breakdown" as const, scoringVersion: "phase3-opportunity-scoring-v1",
    title: "Safe opportunity title",
    developmentEvents: [event(), event(secondEventId)],
    reasonSignals: [
      { code: "low_novelty" as const, effect: "negative" as const, position: 3, value: 0.3, developmentEvents: [event()] },
      { code: "high_importance" as const, effect: "positive" as const, position: 0, value: 0.9, developmentEvents: [event()] },
    ],
    ...overrides,
  };
}

function run(status: "queued" | "running" | "succeeded" | "failed_retryable" | "failed_terminal" = "succeeded") {
  return {
    status, queuedAt: at, startedAt: status === "queued" ? null : at,
    finishedAt: status === "succeeded" || status === "failed_terminal" ? at : null,
    retryAfterAt: status === "failed_retryable" ? new Date("2026-09-24T13:00:00.000Z") : null,
    processingVersion: currentProcessingVersion, candidateCount: 2, recommendedCount: 1, suppressedCount: 1,
    failureCode: "PRIVATE_INTERNAL_FAILURE_CODE", leaseToken: "private-lease", leaseExpiresAt: at,
  };
}

function harness(rows: readonly unknown[] = [opportunity()], runRow: unknown = run(), owned = true) {
  const projectFindFirst = vi.fn().mockResolvedValue(owned ? { id: projectId } : null);
  const opportunityFindMany = vi.fn().mockResolvedValue(rows);
  const runFindFirst = vi.fn().mockResolvedValue(runRow);
  const info = vi.fn();
  const runs = {
    processingIdentity: { processingVersion: currentProcessingVersion },
    enqueueReprocessing: vi.fn(),
    executeClaimed: vi.fn(),
  };
  const service = new OpportunityReadService(
    {
      project: { findFirst: projectFindFirst },
      contentOpportunity: { findMany: opportunityFindMany },
      opportunityRun: { findFirst: runFindFirst },
    } as unknown as PrismaService,
    runs as unknown as OpportunityRunService,
    { info } as unknown as StructuredLogger
  );
  return { info, opportunityFindMany, projectFindFirst, runFindFirst, runs, service };
}

function cursor(value: Record<string, unknown>, project = projectId): string {
  return Buffer.from(JSON.stringify({
    version: 1, projectId: project, priorityScore: 0.8, confidence: 0.9,
    noveltyScore: 0.7, candidateKey: "a".repeat(64), id: firstOpportunityId, ...value,
  })).toString("base64url");
}

describe("OpportunityReadService", () => {
  it("returns only safe product fields with ordered persisted reasons and bounded event provenance", async () => {
    const test = harness();
    const response = await test.service.listForProject(userId, projectId);
    expect(response.items[0]).toEqual({
      id: firstOpportunityId, title: "Safe opportunity title", opportunityType: "feature_showcase",
      recommendedFormat: "technical_breakdown", priorityScore: 0.88, noveltyScore: 0.8, confidence: 0.91,
      scoringVersion: "phase3-opportunity-scoring-v1", createdAt: at.toISOString(),
      reasonSignals: [
        { code: "high_importance", effect: "positive", value: 0.9, developmentEventIds: [eventId] },
        { code: "low_novelty", effect: "negative", value: 0.3, developmentEventIds: [eventId] },
      ],
      developmentEvents: [
        { developmentEventId: eventId, type: "feature_completed", title: `Safe event ${eventId}`, occurredAt: at.toISOString() },
        { developmentEventId: secondEventId, type: "feature_completed", title: `Safe event ${secondEventId}`, occurredAt: at.toISOString() },
      ],
    });
    expect(response.processing).toMatchObject({
      status: "succeeded", processingVersion: currentProcessingVersion,
      candidateCount: 2, recommendedCount: 1, suppressedCount: 1,
    });
    expect(response.processing?.statusMessage).toBe("Content opportunity analysis is up to date.");
    expect(JSON.stringify(response)).not.toMatch(
      /candidateKey|inputFingerprint|topicKey|failureCode|PRIVATE_INTERNAL|leaseToken|leaseExpiresAt|runKey|sourceIntelligenceRunId|modelConfigurationFingerprint|prompt|response|providerBody|commit|pullRequest|patch|diff/i
    );
  });

  it("scopes Project lookup by the authenticated owner and applies the complete primary visibility predicate", async () => {
    const test = harness();
    await test.service.listForProject(userId, projectId);
    expect(test.projectFindFirst).toHaveBeenCalledWith({ where: { id: projectId, userId }, select: { id: true } });
    expect(test.opportunityFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId, isCurrent: true, status: "recommended", shouldPost: true, expiredAt: null },
      orderBy: [
        { priorityScore: "desc" }, { confidence: "desc" }, { noveltyScore: "desc" },
        { candidateKey: "asc" }, { id: "asc" },
      ],
    }));
  });

  it.each(["missing Project", "another user's Project"])("returns the same safe not-found for %s", async () => {
    const test = harness([], null, false);
    await expect(test.service.listForProject(userId, projectId)).rejects.toEqual(new NotFoundException("Project not found"));
    expect(test.projectFindFirst).toHaveBeenCalledTimes(1);
    expect(test.opportunityFindMany).not.toHaveBeenCalled();
    expect(test.runFindFirst).not.toHaveBeenCalled();
  });

  it("uses safe not-found for malformed Project IDs without querying", async () => {
    const test = harness();
    await expect(test.service.listForProject(userId, "not-a-project")).rejects.toEqual(new NotFoundException("Project not found"));
    expect(test.projectFindFirst).not.toHaveBeenCalled();
  });

  it("rejects page sizes outside the bounded policy", async () => {
    const test = harness();
    await expect(test.service.listForProject(userId, projectId, { limit: 0 })).rejects.toEqual(new BadRequestException("Invalid pagination limit"));
    await expect(test.service.listForProject(userId, projectId, { limit: opportunityListMaximumLimit + 1 })).rejects.toEqual(new BadRequestException("Invalid pagination limit"));
    expect(test.projectFindFirst).not.toHaveBeenCalled();
    expect(opportunityListDefaultLimit).toBe(10);
  });

  it("uses a project-bound versioned cursor and continues after the complete canonical ranking tuple", async () => {
    const first = opportunity({ candidateKey: "a".repeat(64), id: firstOpportunityId });
    const second = opportunity({ candidateKey: "b".repeat(64), id: secondOpportunityId });
    const test = harness([first, second]);
    const page1 = await test.service.listForProject(userId, projectId, { limit: 1 });
    expect(page1.items.map((item) => item.id)).toEqual([firstOpportunityId]);
    expect(page1.nextCursor).not.toBeNull();
    const payload = JSON.parse(Buffer.from(page1.nextCursor!, "base64url").toString("utf8")) as Record<string, unknown>;
    expect(payload).toEqual({
      version: 1, projectId, priorityScore: 0.88, confidence: 0.91, noveltyScore: 0.8,
      candidateKey: "a".repeat(64), id: firstOpportunityId,
    });
    test.opportunityFindMany.mockResolvedValueOnce([second]);
    const page2 = await test.service.listForProject(userId, projectId, { limit: 1, cursor: page1.nextCursor! });
    expect(page2.items.map((item) => item.id)).toEqual([secondOpportunityId]);
    expect(new Set([...page1.items, ...page2.items].map((item) => item.id)).size).toBe(2);
    const secondQuery = test.opportunityFindMany.mock.calls[1]?.[0] as { where: { OR: readonly Record<string, unknown>[] } };
    expect(secondQuery.where.OR[3]).toMatchObject({ candidateKey: { gt: "a".repeat(64) } });
    expect(secondQuery.where.OR[4]).toMatchObject({ candidateKey: "a".repeat(64), id: { gt: firstOpportunityId } });
    expect(secondQuery.where).toMatchObject({
      projectId, isCurrent: true, status: "recommended", shouldPost: true, expiredAt: null,
    });
  });

  it("rejects malformed and foreign-Project cursors before opportunity/run reads", async () => {
    const test = harness();
    await expect(test.service.listForProject(userId, projectId, { cursor: "not-a-cursor" })).rejects.toEqual(new BadRequestException("Invalid cursor"));
    await expect(test.service.listForProject(userId, projectId, { cursor: cursor({}, otherProjectId) })).rejects.toEqual(new BadRequestException("Invalid cursor"));
    expect(test.opportunityFindMany).not.toHaveBeenCalled();
    expect(test.runFindFirst).not.toHaveBeenCalled();
  });

  it("preserves deterministic score tie ordering with candidateKey and a final UUID tie-break", async () => {
    const test = harness([]);
    await test.service.listForProject(userId, projectId, { limit: 2 });
    const args = test.opportunityFindMany.mock.calls[0]?.[0] as { orderBy: readonly Record<string, unknown>[]; take: number };
    expect(args.orderBy).toEqual([
      { priorityScore: "desc" }, { confidence: "desc" }, { noveltyScore: "desc" },
      { candidateKey: "asc" }, { id: "asc" },
    ]);
    expect(args.take).toBe(3);
  });

  it("queries processing only for the authoritative current version, never a stale-version run", async () => {
    const test = harness([], run("running"));
    const response = await test.service.listForProject(userId, projectId);
    expect(test.runFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId, processingVersion: currentProcessingVersion },
      orderBy: [{ queuedAt: "desc" }, { id: "desc" }],
    }));
    expect(response.processing?.status).toBe("running");
  });

  it.each([
    ["queued", "Content opportunity analysis is queued."],
    ["running", "Content opportunity analysis is in progress."],
    ["succeeded", "Content opportunity analysis is up to date."],
    ["failed_retryable", "Content opportunity analysis is temporarily delayed and will retry automatically."],
    ["failed_terminal", "Content opportunities could not be updated."],
  ] as const)("maps %s to a safe public processing status", async (status, message) => {
    const test = harness([], run(status));
    const result = await test.service.listForProject(userId, projectId);
    expect(result.processing?.status).toBe(status);
    expect(result.processing?.statusMessage).toBe(message);
    expect(JSON.stringify(result.processing)).not.toContain("PRIVATE_INTERNAL_FAILURE_CODE");
    if (status === "failed_retryable") expect(result.processing?.retryAfterAt).toBe("2026-09-24T13:00:00.000Z");
  });

  it("returns explicit not-started and zero-candidate states without manufacturing cards", async () => {
    const noRun = await harness([], null).service.listForProject(userId, projectId);
    expect(noRun).toMatchObject({ items: [], nextCursor: null, processing: null });
    const empty = run("succeeded");
    empty.candidateCount = 0;
    empty.recommendedCount = 0;
    empty.suppressedCount = 0;
    const noCandidateRun = await harness([], empty).service.listForProject(userId, projectId);
    expect(noCandidateRun.items).toEqual([]);
    expect(noCandidateRun.processing?.candidateCount).toBe(0);
    const allSuppressed = run("succeeded");
    allSuppressed.candidateCount = 3;
    allSuppressed.recommendedCount = 0;
    allSuppressed.suppressedCount = 3;
    const suppressedRun = await harness([], allSuppressed).service.listForProject(userId, projectId);
    expect(suppressedRun.items).toEqual([]);
    expect(suppressedRun.processing).toMatchObject({ candidateCount: 3, recommendedCount: 0, suppressedCount: 3 });
  });

  it("fails closed when reason provenance is outside the opportunity's selected events", async () => {
    const invalid = opportunity({
      reasonSignals: [{ code: "fresh_work", effect: "positive", position: 0, value: 1, developmentEvents: [event(otherProjectId, otherProjectId)] }],
    });
    await expect(harness([invalid]).service.listForProject(userId, projectId)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("fails closed when a persisted opportunity has no selected development-event provenance", async () => {
    const invalid = opportunity({ developmentEvents: [] });
    await expect(harness([invalid]).service.listForProject(userId, projectId)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("bounds nested provenance and reason collections in the database query", async () => {
    const test = harness([]);
    await test.service.listForProject(userId, projectId);
    const args = test.opportunityFindMany.mock.calls[0]?.[0] as {
      select: {
        developmentEvents: { take: number };
        reasonSignals: { take: number; select: { developmentEvents: { take: number } } };
      };
    };
    expect(args.select.developmentEvents.take).toBe(opportunityProvenanceMaximum + 1);
    expect(args.select.reasonSignals.take).toBe(opportunityReasonSignalMaximum + 1);
    expect(args.select.reasonSignals.select.developmentEvents.take).toBe(opportunityProvenanceMaximum + 1);
  });

  it("uses a fixed read count and triggers no provider, enqueue, scoring, or GitHub work", async () => {
    const test = harness();
    await test.service.listForProject(userId, projectId);
    expect(test.projectFindFirst).toHaveBeenCalledTimes(1);
    expect(test.opportunityFindMany).toHaveBeenCalledTimes(1);
    expect(test.runFindFirst).toHaveBeenCalledTimes(1);
    expect(test.runs.enqueueReprocessing).not.toHaveBeenCalled();
    expect(test.runs.executeClaimed).not.toHaveBeenCalled();
  });
});
