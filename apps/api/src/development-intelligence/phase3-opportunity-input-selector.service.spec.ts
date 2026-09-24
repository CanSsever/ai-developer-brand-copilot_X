import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { Phase3OpportunityInputSelectorService } from "./phase3-opportunity-input-selector.service";
import {
  validSupportingCommitEvidenceWhere,
  validSupportingPullRequestEvidenceWhere,
} from "./authoritative-development-event-where";
import { developerDayStartForDate, offsetDeveloperDay } from "./developer-day";
import type { CanonicalPhase3OpportunityInput } from "./phase3-opportunity-input";
import { fingerprintPhase3OpportunityInput, phase3OpportunityInputBounds } from "./phase3-opportunity-input";

const ownerId = "123e4567-e89b-42d3-a456-426614174000";
const otherOwnerId = "223e4567-e89b-42d3-a456-426614174000";
const projectId = "323e4567-e89b-42d3-a456-426614174000";
const otherProjectId = "423e4567-e89b-42d3-a456-426614174000";
const boundary = new Date("2026-03-30T12:00:00.000Z");

interface MockEvidence {
  readonly id?: string;
  readonly role: string;
  readonly detachedAt: Date | null;
  readonly gitHubCommit?: { readonly orphanedAt: Date | null } | null;
  readonly gitHubPullRequestId?: string | null;
  readonly rawCommitMessage?: string;
  readonly rawBody?: string;
}

interface MockEvent {
  readonly projectId: string;
  readonly id: string;
  readonly eventKey: string;
  readonly inputFingerprint: string;
  readonly extractionVersion: string;
  readonly type: string;
  readonly status: string;
  readonly title: string;
  readonly summary: string;
  readonly importanceScore: Prisma.Decimal;
  readonly contentPotentialScore: Prisma.Decimal;
  readonly confidence: Prisma.Decimal;
  readonly occurredAt: Date;
  readonly technologies: string[];
  readonly relatedFeatureIds: string[];
  readonly commitEvidence: readonly MockEvidence[];
  readonly pullRequestEvidence: readonly MockEvidence[];
  readonly rawSource: string;
}

interface MockOpportunityEventLink {
  readonly developmentEventId: string;
  readonly developmentEvent: { readonly projectId: string; readonly relatedFeatureIds: string[]; readonly type: string; readonly rawCommitMessage?: string };
}

interface MockOpportunity {
  readonly projectId: string;
  readonly id: string;
  readonly candidateKey: string;
  readonly inputFingerprint: string;
  readonly scoringVersion: string;
  readonly topicKey: string;
  readonly opportunityType: string;
  readonly status: string;
  readonly shouldPost: boolean;
  readonly isCurrent: boolean;
  readonly createdAt: Date;
  readonly expiredAt: Date | null;
  readonly developmentEvents: readonly MockOpportunityEventLink[];
  readonly rawProviderOutput: string;
}

interface MockEventFindManyArgs {
  readonly where: { readonly projectId: string; readonly status: string; readonly confidence: { readonly gte: { toString(): string } } };
  readonly orderBy: readonly { readonly occurredAt?: "asc" | "desc"; readonly id?: "asc" | "desc" }[];
  readonly take: number;
}

interface MockHistoryFindManyArgs {
  readonly where: { readonly projectId: string; readonly createdAt: { readonly gte: Date; readonly lt: Date } };
  readonly orderBy: readonly { readonly createdAt?: "asc" | "desc"; readonly id?: "asc" | "desc" }[];
  readonly take: number;
  readonly select: { readonly developmentEvents: { readonly where: unknown; readonly take: number } };
}

function event(id: string, overrides: Record<string, unknown> = {}): MockEvent {
  return {
    projectId,
    id,
    eventKey: `key-${id}`,
    inputFingerprint: id.padEnd(64, "a").slice(0, 64),
    extractionVersion: "development-event-v2",
    type: "feature_completed",
    status: "active",
    title: `Completed ${id}`,
    summary: `Synthetic semantic summary for ${id}`,
    importanceScore: new Prisma.Decimal("0.800"),
    contentPotentialScore: new Prisma.Decimal("0.700"),
    confidence: new Prisma.Decimal("0.800"),
    occurredAt: new Date("2026-03-28T11:00:00.000Z"),
    technologies: ["TypeScript", "PostgreSQL"],
    relatedFeatureIds: [`feature-${id}`],
    commitEvidence: [{ id: `ce-${id}`, role: "supporting", detachedAt: null, gitHubCommit: { orphanedAt: null }, rawCommitMessage: "private commit body" }],
    pullRequestEvidence: [],
    rawSource: "private patch body",
    ...overrides,
  } as MockEvent;
}

function opportunity(id: string, createdAt: Date, overrides: Record<string, unknown> = {}): MockOpportunity {
  return {
    projectId,
    id,
    candidateKey: `candidate-${id}`.padEnd(64, "c").slice(0, 64),
    inputFingerprint: `fingerprint-${id}`.padEnd(64, "d").slice(0, 64),
    scoringVersion: "content-opportunity-v1",
    topicKey: `topic-${id}`,
    opportunityType: "feature_showcase",
    status: "recommended",
    shouldPost: true,
    isCurrent: true,
    createdAt,
    expiredAt: null,
    developmentEvents: [{
      developmentEventId: `event-${id}`,
      developmentEvent: { projectId, relatedFeatureIds: [`feature-${id}`], type: "feature_completed", rawCommitMessage: "must not leak" },
    }],
    rawProviderOutput: "must not leak",
    ...overrides,
  } as MockOpportunity;
}

function stateFeature(id: string, occurredAt: string) {
  return {
    developmentEventId: id,
    occurredAt,
    relatedFeatureIds: [`feature-${id}`],
    summary: `Summary ${id}`,
    technologies: ["TypeScript"],
    title: `Title ${id}`,
    type: "feature_completed",
  };
}

function currentState(overrides: Record<string, unknown> = {}) {
  return {
    id: "523e4567-e89b-42d3-a456-426614174000",
    version: 7,
    sourceFingerprint: "b".repeat(64),
    projectionVersion: "project-state-projection-v2",
    lastUpdatedAt: new Date("2026-03-28T11:00:00.000Z"),
    purpose: null,
    targetAudience: null,
    currentPhase: null,
    technologies: ["TypeScript", "PostgreSQL"],
    activeFeatures: [stateFeature("active-1", "2026-03-27T11:00:00.000Z")],
    completedFeatures: [stateFeature("completed-1", "2026-03-28T11:00:00.000Z")],
    recentMilestones: [stateFeature("milestone-1", "2026-03-28T11:00:00.000Z")],
    ...overrides,
  };
}

function isValidCommitSupport(link: MockEvidence): boolean {
  return link.role === "supporting" && link.detachedAt === null &&
    link.gitHubCommit !== null && link.gitHubCommit?.orphanedAt === null;
}

function isValidPullRequestSupport(link: MockEvidence): boolean {
  return link.role === "supporting" && link.detachedAt === null &&
    typeof link.gitHubPullRequestId === "string";
}

function harness(options: {
  readonly project?: Record<string, unknown> | null;
  readonly events?: MockEvent[];
  readonly history?: MockOpportunity[];
} = {}) {
  const project = options.project === undefined ? {
    id: projectId,
    timezone: "Europe/Berlin",
    projectState: currentState(),
  } : options.project;
  const eventFindMany = vi.fn(async (args: MockEventFindManyArgs) => {
    const where = args.where;
    return (options.events ?? [])
      .filter((value) => value.projectId === where.projectId && value.status === where.status)
      .filter((value) => Number(value.confidence.toString()) >= Number(where.confidence.gte.toString()))
      .filter((value) => value.commitEvidence.some(isValidCommitSupport) || value.pullRequestEvidence.some(isValidPullRequestSupport))
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime() || right.id.localeCompare(left.id))
      .slice(0, args.take)
      .map((value) => ({
        ...value,
        commitEvidence: value.commitEvidence.filter(isValidCommitSupport).slice(0, 1).map((link) => ({ id: link.id })),
        pullRequestEvidence: value.pullRequestEvidence.filter(isValidPullRequestSupport).slice(0, 1).map((link) => ({ id: link.id })),
      }));
  });
  const historyFindMany = vi.fn(async (args: MockHistoryFindManyArgs) => (options.history ?? [])
    .filter((value) => value.projectId === args.where.projectId)
    .filter((value) => value.createdAt >= args.where.createdAt.gte && value.createdAt < args.where.createdAt.lt)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
    .slice(0, args.take)
    .map((value) => ({
      ...value,
      developmentEvents: value.developmentEvents
        .filter((link) => link.developmentEvent.projectId === projectId)
        .slice(0, args.select.developmentEvents.take),
    })));
  const transaction = {
    project: { findFirst: vi.fn().mockResolvedValue(project) },
    developmentEvent: { findMany: eventFindMany },
    contentOpportunity: { findMany: historyFindMany },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
  } as unknown as PrismaService;
  return { eventFindMany, historyFindMany, prisma, projectFindFirst: transaction.project.findFirst, service: new Phase3OpportunityInputSelectorService(prisma) };
}

describe("Phase3OpportunityInputSelectorService", () => {
  it("uses the exact active/supporting/current/non-orphaned Phase 2 predicate and confidence boundary", async () => {
    const validCommit = event("valid-commit");
    const validPullRequest = event("valid-pr", {
      commitEvidence: [],
      pullRequestEvidence: [{ id: "pre-valid", role: "supporting", detachedAt: null, gitHubPullRequestId: "pr-1", rawBody: "private" }],
    });
    const mixedSupport = event("mixed", {
      commitEvidence: [
        { id: "candidate", role: "candidate", detachedAt: null, gitHubCommit: { orphanedAt: null } },
        { id: "detached", role: "supporting", detachedAt: new Date(), gitHubCommit: { orphanedAt: null } },
        { id: "valid", role: "supporting", detachedAt: null, gitHubCommit: { orphanedAt: null } },
      ],
    });
    const cases = [
      validCommit,
      validPullRequest,
      mixedSupport,
      event("candidate-only", { commitEvidence: [{ role: "candidate", detachedAt: null, gitHubCommit: { orphanedAt: null } }] }),
      event("rejected", { status: "rejected" }),
      event("superseded", { status: "superseded" }),
      event("orphan", { commitEvidence: [{ role: "supporting", detachedAt: null, gitHubCommit: { orphanedAt: new Date() } }] }),
      event("detached", { commitEvidence: [{ role: "supporting", detachedAt: new Date(), gitHubCommit: { orphanedAt: null } }] }),
      event("no-attached-pr", { commitEvidence: [], pullRequestEvidence: [{ role: "supporting", detachedAt: null, gitHubPullRequestId: null }] }),
      event("low-confidence", { confidence: new Prisma.Decimal("0.590") }),
      event("at-confidence-boundary", { confidence: new Prisma.Decimal("0.600") }),
      event("foreign", { projectId: otherProjectId }),
    ];
    const { service, eventFindMany } = harness({ events: cases });
    const result = await service.select(ownerId, projectId, boundary);
    expect(result.input.developmentEvents.map((value) => value.developmentEventId).sort()).toEqual([
      "at-confidence-boundary", "mixed", "valid-commit", "valid-pr",
    ]);
    expect(result.input.developmentEvents.find((value) => value.developmentEventId === "mixed")?.supportingEvidenceKinds).toEqual(["commit"]);
    const query = eventFindMany.mock.calls[0]![0];
    expect(query.where).toEqual({
      projectId,
      status: "active",
      OR: [
        { commitEvidence: { some: validSupportingCommitEvidenceWhere } },
        { pullRequestEvidence: { some: validSupportingPullRequestEvidenceWhere } },
      ],
      confidence: { gte: new Prisma.Decimal("0.600") },
    });
    expect(query.orderBy).toEqual([{ occurredAt: "desc" }, { id: "desc" }]);
  });

  it("uses owner-scoped identical 404 behavior and never queries another Project's context", async () => {
    const { service, projectFindFirst, eventFindMany, historyFindMany } = harness({ project: null });
    await expect(service.select(ownerId, projectId, boundary)).rejects.toBeInstanceOf(NotFoundException);
    expect(projectFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: projectId, userId: ownerId } }));
    expect(eventFindMany).not.toHaveBeenCalled();
    expect(historyFindMany).not.toHaveBeenCalled();
    await expect(service.select(otherOwnerId, projectId, boundary)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("uses only current ProjectState context and cannot make unsupported events eligible", async () => {
    const candidateOnly = event("candidate-only", { commitEvidence: [{ role: "candidate", detachedAt: null, gitHubCommit: { orphanedAt: null } }] });
    const historicalState = { ...currentState(), id: "historical-state-version-id", purpose: "must not be selected" };
    const project = { id: projectId, timezone: "Europe/Berlin", projectState: currentState(), versions: [historicalState] };
    const { service, projectFindFirst } = harness({ project, events: [candidateOnly] });
    const result = await service.select(ownerId, projectId, boundary);
    expect(result.input.projectState?.id).toBe(currentState().id);
    expect(result.input.projectState?.version).toBe(7);
    expect(result.input.developmentEvents).toEqual([]);
    expect(JSON.stringify(projectFindFirst.mock.calls[0]?.[0].select.projectState.select)).not.toContain("versions");
  });

  it("selects prior 30 local developer-days across DST and preserves history statuses", async () => {
    const exactInside = opportunity("inside-30", new Date("2026-02-27T23:00:00.000Z"), { status: "recommended", shouldPost: true });
    const exactlyOutside = opportunity("outside-31", new Date("2026-02-26T23:00:00.000Z"));
    const suppressed = opportunity("suppressed", new Date("2026-03-01T12:00:00.000Z"), { status: "suppressed", shouldPost: false });
    const expired = opportunity("expired", new Date("2026-03-02T12:00:00.000Z"), { status: "expired", shouldPost: false, isCurrent: false, expiredAt: new Date("2026-03-10T10:00:00.000Z") });
    const foreign = opportunity("foreign-history", new Date("2026-03-03T12:00:00.000Z"), { projectId: otherProjectId });
    const { service, historyFindMany } = harness({ history: [exactInside, exactlyOutside, suppressed, expired, foreign] });
    const result = await service.select(ownerId, projectId, boundary);
    expect(result.input.opportunityHistory.map((item) => item.opportunityId).sort()).toEqual(["expired", "inside-30", "suppressed"]);
    expect(result.input.opportunityHistory.find((item) => item.opportunityId === "inside-30")?.createdDeveloperDay).toBe("2026-02-28");
    expect(result.input.opportunityHistory.find((item) => item.opportunityId === "suppressed")).toMatchObject({ status: "suppressed", shouldPost: false });
    expect(result.input.opportunityHistory.find((item) => item.opportunityId === "expired")).toMatchObject({ status: "expired", isCurrent: false, shouldPost: false });
    const query = historyFindMany.mock.calls[0]![0];
    expect(query.where.createdAt).toEqual({ gte: new Date("2026-02-27T23:00:00.000Z"), lt: new Date("2026-03-29T22:00:00.000Z") });
    expect(query.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("omits cross-Project event links inside otherwise owned opportunity history", async () => {
    const value = opportunity("mixed-history", new Date("2026-03-02T12:00:00.000Z"), {
      developmentEvents: [
        { developmentEventId: "foreign-event", developmentEvent: { projectId: otherProjectId, relatedFeatureIds: ["foreign-feature"], type: "release" } },
        { developmentEventId: "owned-event", developmentEvent: { projectId, relatedFeatureIds: ["owned-feature"], type: "feature_completed" } },
      ],
    });
    const { service, historyFindMany } = harness({ history: [value] });
    const result = await service.select(ownerId, projectId, boundary);
    expect(result.input.opportunityHistory[0]).toMatchObject({
      linkedDevelopmentEvents: [{ developmentEventId: "owned-event", type: "feature_completed" }],
      linkedFeatureIds: ["owned-feature"],
    });
    expect(historyFindMany.mock.calls[0]![0].select.developmentEvents.where).toEqual({ developmentEvent: { projectId } });
  });

  it("uses calendar-day arithmetic at month/year/DST boundaries", () => {
    expect(offsetDeveloperDay("2026-03-30", -30)).toBe("2026-02-28");
    expect(offsetDeveloperDay("2026-01-10", -30)).toBe("2025-12-11");
    expect(developerDayStartForDate("2026-03-30", "Europe/Berlin")).toEqual(new Date("2026-03-29T22:00:00.000Z"));
    expect(developerDayStartForDate("2026-02-28", "Europe/Berlin")).toEqual(new Date("2026-02-27T23:00:00.000Z"));
  });

  it("enforces deterministic event, history, state, and feature bounds with explicit truncation", async () => {
    const manyEvents = Array.from({ length: 101 }, (_, index) => event(`event-${String(index).padStart(3, "0")}`, {
      occurredAt: new Date(Date.UTC(2026, 2, 29, 0, index)),
    }));
    const manyHistory = Array.from({ length: 101 }, (_, index) => opportunity(`history-${String(index).padStart(3, "0")}`, new Date(Date.UTC(2026, 2, 1, 0, index))));
    const features = Array.from({ length: 22 }, (_, index) => stateFeature(`feature-${String(index).padStart(2, "0")}`, new Date(Date.UTC(2026, 2, index + 1)).toISOString()));
    const state = currentState({ activeFeatures: features, completedFeatures: features, recentMilestones: features, technologies: Array.from({ length: 55 }, (_, index) => `tech-${index}`) });
    const { service, eventFindMany, historyFindMany } = harness({ project: { id: projectId, timezone: "Europe/Berlin", projectState: state }, events: manyEvents, history: manyHistory });
    const result = await service.select(ownerId, projectId, boundary);
    expect(result.input.developmentEvents).toHaveLength(100);
    expect(result.input.opportunityHistory).toHaveLength(100);
    expect(result.input.truncation).toMatchObject({ developmentEvents: true, opportunityHistory: true, activeFeatures: true, completedFeatures: true, recentMilestones: true, projectTechnologies: true });
    expect(result.input.projectState?.activeFeatures).toHaveLength(20);
    expect(result.input.projectState?.technologies).toHaveLength(50);
    expect(eventFindMany.mock.calls[0]?.[0].take).toBe(101);
    expect(historyFindMany.mock.calls[0]?.[0].take).toBe(101);
  });

  it("reports deterministic field truncation while keeping semantic payload bounded", async () => {
    const longEvent = event("long", {
      title: "T".repeat(phase3OpportunityInputBounds.titleCharacters + 20),
      summary: "S".repeat(phase3OpportunityInputBounds.summaryCharacters + 20),
      technologies: Array.from({ length: 25 }, (_, index) => `event-tech-${index}`),
      relatedFeatureIds: Array.from({ length: 55 }, (_, index) => `feature-${index}`),
    });
    const longState = currentState({ purpose: "P".repeat(600) });
    const { service } = harness({ project: { id: projectId, timezone: "Europe/Berlin", projectState: longState }, events: [longEvent] });
    const result = await service.select(ownerId, projectId, boundary);
    expect(result.input.developmentEvents[0]).toMatchObject({
      title: "T".repeat(300),
      summary: "S".repeat(2_000),
      truncated: { title: true, summary: true, technologies: true, relatedFeatureIds: true },
    });
    expect(result.input.developmentEvents[0]?.technologies).toHaveLength(20);
    expect(result.input.developmentEvents[0]?.relatedFeatureIds).toHaveLength(50);
    expect(result.input.truncation.stateTextFields).toBe(1);
  });

  it("canonical output excludes raw provider/evidence data and includes only selected semantic fields", async () => {
    const { service } = harness({ events: [event("safe")] , history: [opportunity("safe", new Date("2026-03-01T12:00:00.000Z"))] });
    const result = await service.select(ownerId, projectId, boundary);
    const serialized = JSON.stringify(result.input);
    expect(serialized).not.toContain("private commit body");
    expect(serialized).not.toContain("private patch body");
    expect(serialized).not.toContain("must not leak");
    expect(result.input).not.toHaveProperty("dailyDevelopmentSummary");
    expect(result.input).not.toHaveProperty("rawCommits");
    expect(result.input).not.toHaveProperty("rawPullRequests");
  });

  it("returns identical fingerprint for equivalent selected DB row ordering", async () => {
    const events = [event("a", { occurredAt: new Date("2026-03-27T11:00:00.000Z"), relatedFeatureIds: ["z", "a"] }), event("b")];
    const history = [opportunity("a", new Date("2026-03-01T12:00:00.000Z")), opportunity("b", new Date("2026-03-02T12:00:00.000Z"))];
    const first = await harness({ events, history }).service.select(ownerId, projectId, boundary);
    const second = await harness({ events: [...events].reverse(), history: [...history].reverse() }).service.select(ownerId, projectId, boundary);
    expect(first.input).toEqual(second.input);
    expect(first.inputFingerprint).toBe(second.inputFingerprint);
    const reorderedObject = Object.fromEntries(Object.entries(first.input).reverse()) as unknown as CanonicalPhase3OpportunityInput;
    expect(fingerprintPhase3OpportunityInput(reorderedObject)).toBe(first.inputFingerprint);
  });

  it("changes fingerprint for event, current state, history, timezone, evaluation boundary, and selection-version changes", async () => {
    const base = (await harness({ events: [event("base")], history: [opportunity("recent", new Date("2026-03-01T12:00:00.000Z"))] }).service.select(ownerId, projectId, boundary)).input;
    const variants: CanonicalPhase3OpportunityInput[] = [
      { ...base, developmentEvents: [{ ...base.developmentEvents[0]!, summary: "revised semantic evidence" }] },
      { ...base, projectState: { ...base.projectState!, version: base.projectState!.version + 1 } },
      { ...base, opportunityHistory: [{ ...base.opportunityHistory[0]!, status: "suppressed", shouldPost: false }] },
      { ...base, timezone: "Etc/UTC" },
      { ...base, evaluationBoundary: "2026-03-30T12:01:00.000Z" },
      { ...base, selectionVersion: "phase3-opportunity-input-v2" },
    ];
    expect(new Set(variants.map(fingerprintPhase3OpportunityInput)).size).toBe(variants.length);
    expect(fingerprintPhase3OpportunityInput(base)).toHaveLength(64);
  });
});
