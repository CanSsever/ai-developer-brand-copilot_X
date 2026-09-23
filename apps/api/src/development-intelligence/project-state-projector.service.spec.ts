import { Prisma } from "../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../database/prisma.service";
import type { StructuredLogger } from "../observability/structured-logger";
import {
  buildProjectStateReplayFingerprint,
  ProjectStateProjectionError,
  ProjectStateProjectorService,
  projectStateProjectionVersion,
} from "./project-state-projector.service";

const projectId = "10000000-0000-4000-8000-000000000001";
const otherProjectId = "10000000-0000-4000-8000-000000000002";
const userId = "20000000-0000-4000-8000-000000000001";
const projectCreatedAt = new Date("2026-01-01T00:00:00.000Z");

interface EventFixture {
  confidence: Prisma.Decimal;
  contentPotentialScore: Prisma.Decimal;
  createdAt: Date;
  eventKey: string;
  extractionVersion: string;
  id: string;
  hasValidSupportingCommit: boolean;
  hasValidSupportingPullRequest: boolean;
  importanceScore: Prisma.Decimal;
  inputFingerprint: string;
  occurredAt: Date;
  projectId: string;
  relatedFeatureIds: string[];
  status: "active" | "rejected" | "superseded";
  summary: string;
  technologies: string[];
  title: string;
  type: string;
}

function event(
  id: string,
  overrides: Partial<EventFixture> = {}
): EventFixture {
  return {
    confidence: new Prisma.Decimal("0.900"),
    contentPotentialScore: new Prisma.Decimal("0.700"),
    createdAt: new Date("2026-09-20T10:00:01.000Z"),
    eventKey: id.padEnd(64, "a").slice(0, 64),
    extractionVersion: "development-event-extraction-v1",
    id,
    hasValidSupportingCommit: true,
    hasValidSupportingPullRequest: false,
    importanceScore: new Prisma.Decimal("0.800"),
    inputFingerprint: id.padEnd(64, "b").slice(0, 64),
    occurredAt: new Date("2026-09-20T10:00:00.000Z"),
    projectId,
    relatedFeatureIds: [],
    status: "active",
    summary: `Summary for ${id}`,
    technologies: ["TypeScript"],
    title: `Title for ${id}`,
    type: "feature_completed",
    ...overrides,
  };
}

interface StoredVersion {
  data: Record<string, unknown>;
  id: string;
  links: string[];
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function harness(options: {
  events?: EventFixture[];
  projectAvailable?: boolean;
  versionCreateFailure?: boolean;
} = {}) {
  const events = options.events ?? [event("event-1")];
  let current: Record<string, unknown> | null = null;
  const versions: StoredVersion[] = [];
  let nextStateId = 1;
  let nextVersionId = 1;
  let forceConflict = false;
  const logger = {
    errorEvent: vi.fn(),
    info: vi.fn(),
    warnEvent: vi.fn(),
  };
  const developmentEventCreate = vi.fn();
  const contentOpportunityCreate = vi.fn();
  const githubCall = vi.fn();

  const transaction = {
    project: {
      findFirst: vi.fn().mockImplementation(
        async (args: { where: { id: string; userId: string } }) =>
          options.projectAvailable === false ||
          args.where.id !== projectId ||
          args.where.userId !== userId
            ? null
            : { createdAt: projectCreatedAt, id: projectId }
      ),
    },
    developmentEvent: {
      create: developmentEventCreate,
      findMany: vi.fn().mockImplementation(
        async (args: {
          where: { projectId: string; status: string };
        }) =>
          events
            .filter(
              (item) =>
                item.projectId === args.where.projectId &&
                item.status === args.where.status &&
                (item.hasValidSupportingCommit ||
                  item.hasValidSupportingPullRequest)
            )
            .sort(
              (left, right) =>
                left.occurredAt.getTime() - right.occurredAt.getTime() ||
                left.createdAt.getTime() - right.createdAt.getTime() ||
                left.id.localeCompare(right.id)
            )
      ),
    },
    projectState: {
      create: vi.fn().mockImplementation(
        async (args: { data: Record<string, unknown> }) => {
          if (current) {
            throw Object.assign(new Error("unique"), { code: "P2002" });
          }
          current = { ...cloneValue(args.data), id: `state-${nextStateId++}` };
          return { id: current.id };
        }
      ),
      findUnique: vi.fn().mockImplementation(async () =>
        current ? cloneValue(current) : null
      ),
      updateMany: vi.fn().mockImplementation(
        async (args: {
          data: Record<string, unknown>;
          where: { id: string; version: number };
        }) => {
          if (
            forceConflict ||
            !current ||
            current.id !== args.where.id ||
            current.version !== args.where.version
          ) {
            return { count: 0 };
          }
          current = { ...current, ...cloneValue(args.data) };
          return { count: 1 };
        }
      ),
    },
    projectStateVersion: {
      create: vi.fn().mockImplementation(
        async (args: {
          data: Record<string, unknown> & {
            developmentEvents: {
              create: { developmentEventId: string }[];
            };
          };
        }) => {
          if (options.versionCreateFailure) throw new Error("synthetic db failure");
          const id = `version-${nextVersionId++}`;
          const links = args.data.developmentEvents.create.map(
            (link) => link.developmentEventId
          );
          if (new Set(links).size !== links.length) {
            throw Object.assign(new Error("duplicate"), { code: "P2002" });
          }
          versions.push({
            data: cloneValue(args.data),
            id,
            links,
          });
          return { id };
        }
      ),
      findUnique: vi.fn().mockImplementation(
        async (args: {
          where: {
            projectStateId_sourceFingerprint_projectionVersion: {
              projectStateId: string;
              projectionVersion: string;
              sourceFingerprint: string;
            };
          };
        }) => {
          const key =
            args.where.projectStateId_sourceFingerprint_projectionVersion;
          const found = versions.find(
            (version) =>
              version.data.projectStateId === key.projectStateId &&
              version.data.projectionVersion === key.projectionVersion &&
              version.data.sourceFingerprint === key.sourceFingerprint
          );
          return found
            ? { id: found.id, version: found.data.version as number }
            : null;
        }
      ),
    },
    contentOpportunity: { create: contentOpportunityCreate },
    gitHubCommit: { findMany: githubCall },
  };

  const prisma = {
    ...transaction,
    $transaction: vi.fn().mockImplementation(
      async (
        callback: (client: typeof transaction) => Promise<unknown>,
        _settings: unknown
      ) => {
        const beforeCurrent = current ? cloneValue(current) : null;
        const beforeVersions = versions.map(cloneValue);
        try {
          return await callback(transaction);
        } catch (error) {
          if (options.versionCreateFailure) {
            current = beforeCurrent;
            versions.splice(0, versions.length, ...beforeVersions);
          }
          throw error;
        }
      }
    ),
  };

  return {
    contentOpportunityCreate,
    developmentEventCreate,
    events,
    forceConflict: () => {
      forceConflict = true;
    },
    githubCall,
    logger,
    prisma,
    service: new ProjectStateProjectorService(
      prisma as unknown as PrismaService,
      logger as unknown as StructuredLogger
    ),
    state: () => current,
    versions,
  };
}

const request = { projectId, userId };

describe("ProjectStateProjectorService", () => {
  it("creates current ProjectState from one accepted event", async () => {
    const test = harness();
    const result = await test.service.project(request);
    expect(result.status).toBe("created");
    expect(test.state()).toMatchObject({
      projectId,
      technologies: ["TypeScript"],
      version: 1,
    });
  });

  it("projects multiple accepted event types into coherent structured state", async () => {
    const test = harness({
      events: [
        event("start", { type: "feature_started" }),
        event("complete", {
          occurredAt: new Date("2026-09-21T10:00:00.000Z"),
          technologies: ["PostgreSQL"],
        }),
        event("release", {
          occurredAt: new Date("2026-09-22T10:00:00.000Z"),
          type: "release",
        }),
      ],
    });
    await test.service.project(request);
    expect(test.state()).toMatchObject({
      technologies: ["PostgreSQL", "TypeScript"],
      version: 1,
    });
    expect(test.state()?.activeFeatures).toHaveLength(1);
    expect(test.state()?.completedFeatures).toHaveLength(1);
    expect(test.state()?.recentMilestones).toHaveLength(1);
  });

  it("removes an explicitly identified feature from active state when completed", async () => {
    const test = harness({
      events: [
        event("start", {
          relatedFeatureIds: ["feature-auth"],
          type: "feature_started",
        }),
        event("complete", {
          occurredAt: new Date("2026-09-21T10:00:00.000Z"),
          relatedFeatureIds: ["feature-auth"],
          type: "feature_completed",
        }),
      ],
    });
    await test.service.project(request);
    expect(test.state()?.activeFeatures).toEqual([]);
    expect(test.state()?.completedFeatures).toHaveLength(1);
    expect(test.versions[0]?.links).toEqual(["start", "complete"]);
  });

  it("creates version one for the first projection", async () => {
    const test = harness();
    const result = await test.service.project(request);
    expect(result.version).toBe(1);
    expect(test.versions[0]?.data.version).toBe(1);
  });

  it("creates the next immutable version when a new event is accepted", async () => {
    const test = harness();
    await test.service.project(request);
    test.events.push(
      event("event-2", {
        occurredAt: new Date("2026-09-21T10:00:00.000Z"),
      })
    );
    const result = await test.service.project(request);
    expect(result.version).toBe(2);
    expect(test.versions).toHaveLength(2);
  });

  it("does not rewrite the prior state version", async () => {
    const test = harness();
    await test.service.project(request);
    const first = cloneValue(test.versions[0]);
    test.events.push(event("event-2"));
    await test.service.project(request);
    expect(test.versions[0]).toEqual(first);
  });

  it("persists every authoritative event as applied-event provenance", async () => {
    const test = harness({ events: [event("one"), event("two")] });
    await test.service.project(request);
    expect(test.versions[0]?.links).toEqual(["one", "two"]);
  });

  it("does not create duplicate applied-event links", async () => {
    const test = harness();
    await test.service.project(request);
    await test.service.project(request);
    expect(test.versions).toHaveLength(1);
    expect(test.versions[0]?.links).toEqual(["event-1"]);
  });

  it("is idempotent for the same unchanged event set", async () => {
    const test = harness();
    const first = await test.service.project(request);
    const second = await test.service.project(request);
    expect(second).toMatchObject({
      projectStateId: first.projectStateId,
      status: "unchanged",
      version: 1,
    });
  });

  it("reuses the same replay fingerprint without creating a version", async () => {
    const test = harness();
    const first = await test.service.project(request);
    const second = await test.service.project(request);
    expect(second.replayFingerprint).toBe(first.replayFingerprint);
    expect(test.versions).toHaveLength(1);
  });

  it("changes the replay fingerprint when the authoritative event set changes", async () => {
    const test = harness();
    const first = await test.service.project(request);
    test.events.push(event("event-2"));
    const second = await test.service.project(request);
    expect(second.replayFingerprint).not.toBe(first.replayFingerprint);
  });

  it("distinguishes a projection-version change in replay identity", () => {
    const serialized = JSON.stringify([{ id: "event-1" }]);
    expect(
      buildProjectStateReplayFingerprint(serialized, "projection-v1")
    ).not.toBe(
      buildProjectStateReplayFingerprint(serialized, "projection-v2")
    );
  });

  it("excludes rejected low-confidence events", async () => {
    const test = harness({
      events: [
        event("accepted"),
        event("rejected", { status: "rejected", title: "private rejected title" }),
      ],
    });
    await test.service.project(request);
    expect(test.versions[0]?.links).toEqual(["accepted"]);
    expect(JSON.stringify(test.state())).not.toContain("private rejected title");
  });

  it("uses an active successor instead of its superseded predecessor", async () => {
    const test = harness({
      events: [
        event("old", { status: "superseded", title: "Old meaning" }),
        event("new", { title: "New meaning" }),
      ],
    });
    await test.service.project(request);
    expect(test.versions[0]?.links).toEqual(["new"]);
    expect(JSON.stringify(test.state())).not.toContain("Old meaning");
  });

  it("preserves historical versions after supersession changes authority", async () => {
    const old = event("old");
    const test = harness({ events: [old] });
    await test.service.project(request);
    const historical = cloneValue(test.versions[0]);
    old.status = "superseded";
    test.events.push(event("new"));
    await test.service.project(request);
    expect(test.versions[0]).toEqual(historical);
    expect(test.versions[1]?.links).toEqual(["new"]);
  });

  it("removes an orphaned-only event from current authority without rewriting history", async () => {
    const supported = event("orphaned-later");
    const test = harness({ events: [supported] });
    await test.service.project(request);
    const historical = cloneValue(test.versions[0]);

    supported.hasValidSupportingCommit = false;
    const result = await test.service.project(request);

    expect(result).toMatchObject({ status: "created", version: 2 });
    expect(test.versions[0]).toEqual(historical);
    expect(test.versions[1]?.links).toEqual([]);
  });

  it("keeps mixed evidence authoritative while one supporting commit remains valid", async () => {
    const test = harness({
      events: [event("mixed", { hasValidSupportingCommit: true })],
    });
    await test.service.project(request);
    expect(test.versions[0]?.links).toEqual(["mixed"]);
  });

  it("keeps PR-backed support authoritative when a subordinate commit is orphaned", async () => {
    const test = harness({
      events: [
        event("pr-backed", {
          hasValidSupportingCommit: false,
          hasValidSupportingPullRequest: true,
        }),
      ],
    });
    await test.service.project(request);
    expect(test.versions[0]?.links).toEqual(["pr-backed"]);
  });

  it("queries only active events with valid supporting-role evidence", async () => {
    const test = harness();
    await test.service.project(request);
    expect(test.prisma.developmentEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              commitEvidence: {
                some: expect.objectContaining({ role: "supporting" }),
              },
            }),
            expect.objectContaining({
              pullRequestEvidence: {
                some: expect.objectContaining({ role: "supporting" }),
              },
            }),
          ]),
          status: "active",
        }),
      })
    );
  });

  it("does not apply an event belonging to another Project", async () => {
    const test = harness({
      events: [event("owned"), event("foreign", { projectId: otherProjectId })],
    });
    await test.service.project(request);
    expect(test.versions[0]?.links).toEqual(["owned"]);
  });

  it("prevents concurrent stale projections from losing an update", async () => {
    const test = harness();
    await test.service.project(request);
    test.events.push(event("event-2"));
    const results = await Promise.allSettled([
      test.service.project(request),
      test.service.project(request),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(test.state()?.version).toBe(2);
  });

  it("reports an optimistic-concurrency conflict safely", async () => {
    const test = harness();
    await test.service.project(request);
    test.events.push(event("event-2"));
    test.forceConflict();
    await expect(test.service.project(request)).rejects.toMatchObject({
      failureCode: "PROJECT_STATE_CONFLICT",
      retryable: true,
    });
  });

  it("creates a deterministic empty state when no event is authoritative", async () => {
    const test = harness({ events: [] });
    const result = await test.service.project(request);
    expect(result).toMatchObject({ status: "created", version: 1 });
    expect(test.state()).toMatchObject({
      activeFeatures: [],
      completedFeatures: [],
      lastUpdatedAt: projectCreatedAt,
      recentMilestones: [],
      technologies: [],
    });
    expect(test.versions[0]?.links).toEqual([]);
  });

  it("never creates a DevelopmentEvent", async () => {
    const test = harness();
    await test.service.project(request);
    expect(test.developmentEventCreate).not.toHaveBeenCalled();
  });

  it("never creates a ContentOpportunity", async () => {
    const test = harness();
    await test.service.project(request);
    expect(test.contentOpportunityCreate).not.toHaveBeenCalled();
  });

  it("performs no GitHub or provider call", async () => {
    const test = harness();
    await test.service.project(request);
    expect(test.githubCall).not.toHaveBeenCalled();
  });

  it("requires no raw source evidence", async () => {
    const test = harness({
      events: [
        event("event-1", {
          summary: "Validated semantic result",
          title: "Semantic event",
        }),
      ],
    });
    await expect(test.service.project(request)).resolves.toMatchObject({
      status: "created",
    });
  });

  it("does not put private event semantics into logs", async () => {
    const privateText = "synthetic private semantic title";
    const test = harness({ events: [event("private", { title: privateText })] });
    await test.service.project(request);
    const logs = JSON.stringify(test.logger);
    expect(logs).not.toContain(privateText);
    expect(logs).not.toContain("Summary for private");
  });

  it("orders equal-time events deterministically by persisted identity", async () => {
    const test = harness({ events: [event("z-event"), event("a-event")] });
    await test.service.project(request);
    expect(test.versions[0]?.links).toEqual(["a-event", "z-event"]);
  });

  it("rolls back current state when version persistence fails", async () => {
    const test = harness({ versionCreateFailure: true });
    await expect(test.service.project(request)).rejects.toMatchObject({
      failureCode: "PROJECT_STATE_PERSISTENCE_FAILED",
    });
    expect(test.state()).toBeNull();
    expect(test.versions).toHaveLength(0);
  });

  it("rejects malformed historical structured state", async () => {
    const test = harness();
    await test.service.project(request);
    (test.state() as Record<string, unknown>).activeFeatures = {};
    test.events.push(event("event-2"));
    await expect(test.service.project(request)).rejects.toMatchObject({
      failureCode: "PROJECT_STATE_INCONSISTENT",
    });
  });

  it("uses a serializable database transaction", async () => {
    const test = harness();
    await test.service.project(request);
    expect(test.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  });

  it("bounds recent milestones by age and count", async () => {
    const events = Array.from({ length: 22 }, (_, index) =>
      event(`milestone-${index.toString().padStart(2, "0")}`, {
        occurredAt: new Date(
          Date.UTC(2026, 8, 1 + index, 10, 0, 0)
        ),
        type: "project_milestone",
      })
    );
    events.unshift(
      event("too-old", {
        occurredAt: new Date("2025-01-01T00:00:00.000Z"),
        type: "release",
      })
    );
    const test = harness({ events });
    await test.service.project(request);
    const milestones = test.state()?.recentMilestones as unknown[];
    expect(milestones).toHaveLength(20);
    expect(JSON.stringify(milestones)).not.toContain("too-old");
  });

  it("does not invent purpose, audience, or current phase", async () => {
    const test = harness();
    await test.service.project(request);
    expect(test.state()).toMatchObject({
      currentPhase: null,
      purpose: null,
      targetAudience: null,
    });
  });

  it("fails closed when Project ownership is not established", async () => {
    const test = harness({ projectAvailable: false });
    await expect(test.service.project(request)).rejects.toBeInstanceOf(
      ProjectStateProjectionError
    );
    expect(test.state()).toBeNull();
  });

  it("uses the explicit projection version in persisted state", async () => {
    const test = harness();
    await test.service.project(request);
    expect(test.state()?.projectionVersion).toBe(projectStateProjectionVersion);
    expect(test.versions[0]?.data.projectionVersion).toBe(
      projectStateProjectionVersion
    );
  });
});
