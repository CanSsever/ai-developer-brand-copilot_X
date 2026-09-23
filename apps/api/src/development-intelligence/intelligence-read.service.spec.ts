import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../database/prisma.service";
import type { StructuredLogger } from "../observability/structured-logger";
import {
  intelligenceEventLimit,
  IntelligenceReadService,
} from "./intelligence-read.service";

const userId = "123e4567-e89b-42d3-a456-426614174000";
const projectId = "323e4567-e89b-42d3-a456-426614174000";

interface RunFixture {
  failureCode: string | null;
  finishedAt: Date | null;
  groupsDiscovered: number;
  groupsFailed: number;
  groupsRejected: number;
  groupsSucceeded: number;
  processingVersion: string;
  queuedAt: Date;
  retryAfterAt: Date | null;
  startedAt: Date | null;
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed_retryable"
    | "failed_terminal";
}

function event(id: string, occurredAt: string) {
  return {
    _count: { commitEvidence: 2, pullRequestEvidence: 1 },
    confidence: 0.91,
    extractionVersion: "development-event-extraction-v1",
    id,
    occurredAt: new Date(occurredAt),
    status: "active" as const,
    summary: `Safe summary ${id}`,
    title: `Safe title ${id}`,
    type: "feature_completed" as const,
  };
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: projectId,
    projectState: {
      activeFeatures: [],
      completedFeatures: [
        {
          developmentEventId: "event-1",
          occurredAt: "2026-09-22T10:00:00.000Z",
          relatedFeatureIds: ["feature-1"],
          summary: "Safe state summary",
          technologies: ["TypeScript"],
          title: "Safe state title",
          type: "feature_completed",
        },
      ],
      currentPhase: null,
      lastUpdatedAt: new Date("2026-09-22T10:00:00.000Z"),
      projectionVersion: "project-state-projection-v1",
      purpose: null,
      recentMilestones: [],
      targetAudience: null,
      technologies: ["TypeScript"],
      version: 3,
    },
    developmentEvents: [
      event("event-2", "2026-09-22T11:00:00.000Z"),
      event("event-1", "2026-09-22T10:00:00.000Z"),
    ],
    intelligenceRuns: [
      {
        failureCode: null,
        finishedAt: new Date("2026-09-22T11:01:00.000Z"),
        groupsDiscovered: 3,
        groupsFailed: 0,
        groupsRejected: 1,
        groupsSucceeded: 2,
        processingVersion: "processing-v1",
        queuedAt: new Date("2026-09-22T10:59:00.000Z"),
        retryAfterAt: null,
        startedAt: new Date("2026-09-22T11:00:00.000Z"),
        status: "succeeded" as const,
      } as RunFixture,
    ],
    ...overrides,
  };
}

function harness(result: unknown = project()) {
  const findFirst = vi.fn().mockResolvedValue(result);
  const info = vi.fn();
  const service = new IntelligenceReadService(
    { project: { findFirst } } as unknown as PrismaService,
    { info } as unknown as StructuredLogger
  );
  return { findFirst, info, service };
}

describe("IntelligenceReadService", () => {
  it("returns the owned current state, active events, and latest safe run", async () => {
    const { service } = harness();
    const result = await service.getProjectIntelligence(userId, projectId);

    expect(result).toMatchObject({
      projectId,
      eventLimit: intelligenceEventLimit,
      currentState: {
        version: 3,
        projectionVersion: "project-state-projection-v1",
        technologies: ["TypeScript"],
      },
      processing: {
        failureCode: null,
        status: "succeeded",
        statusMessage: "Development intelligence is up to date.",
      },
    });
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      eventId: "event-2",
      confidence: 0.91,
      provenance: { commitCount: 2, pullRequestCount: 1 },
      status: "active",
    });
  });

  it("scopes the single bounded read to the authenticated owner", async () => {
    const { findFirst, service } = harness();
    await service.getProjectIntelligence(userId, projectId);

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: projectId, userId },
        select: expect.objectContaining({
          developmentEvents: expect.objectContaining({
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
            take: intelligenceEventLimit,
            orderBy: [
              { occurredAt: "desc" },
              { createdAt: "desc" },
              { id: "desc" },
            ],
          }),
          intelligenceRuns: expect.objectContaining({ take: 1 }),
        }),
      })
    );
  });

  it.each(["unknown Project", "another user's Project"])(
    "uses the same safe not-found result for %s",
    async () => {
      const { service } = harness(null);
      await expect(
        service.getProjectIntelligence(userId, projectId)
      ).rejects.toEqual(new NotFoundException("Project not found"));
    }
  );

  it("uses safe not-found behavior for malformed identifiers without querying", async () => {
    const { findFirst, service } = harness();
    await expect(
      service.getProjectIntelligence(userId, "not-a-project-id")
    ).rejects.toEqual(new NotFoundException("Project not found"));
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("preserves deterministic event order from the bounded database query", async () => {
    const { service } = harness();
    const result = await service.getProjectIntelligence(userId, projectId);
    expect(result.events.map(({ eventId }) => eventId)).toEqual([
      "event-2",
      "event-1",
    ]);
  });

  it("returns a clear empty read model before intelligence exists", async () => {
    const { service } = harness(
      project({ projectState: null, developmentEvents: [], intelligenceRuns: [] })
    );
    await expect(
      service.getProjectIntelligence(userId, projectId)
    ).resolves.toEqual({
      currentState: null,
      eventLimit: intelligenceEventLimit,
      events: [],
      processing: null,
      projectId,
    });
  });

  it("fails closed to empty state collections if persisted JSON is not an array", async () => {
    const value = project();
    value.projectState.activeFeatures = null as never;
    const { service } = harness(value);
    const result = await service.getProjectIntelligence(userId, projectId);
    expect(result.currentState?.activeFeatures).toEqual([]);
  });

  it("field-projects persisted state references and drops unexpected private keys", async () => {
    const value = project();
    const completed = value.projectState.completedFeatures[0] as Record<
      string,
      unknown
    >;
    completed.commitMessage = "private evidence";
    completed.filePath = "private/path.ts";
    const { service } = harness(value);
    const result = await service.getProjectIntelligence(userId, projectId);
    const serialized = JSON.stringify(result.currentState?.completedFeatures);
    expect(serialized).toContain("Safe state title");
    expect(serialized).not.toMatch(/commitMessage|private evidence|filePath|private\/path/);
  });

  it("maps retryable failures and retry timing without exposing internal codes", async () => {
    const value = project();
    const run = value.intelligenceRuns[0] as RunFixture;
    value.intelligenceRuns[0] = {
      ...run,
      failureCode: "AI_PROVIDER_TRANSIENT_FAILURE",
      finishedAt: null,
      retryAfterAt: new Date("2026-09-22T12:00:00.000Z"),
      status: "failed_retryable",
    };
    const { service } = harness(value);
    const result = await service.getProjectIntelligence(userId, projectId);
    expect(result.processing).toMatchObject({
      failureCode: "temporarily_unavailable",
      retryAfterAt: "2026-09-22T12:00:00.000Z",
      status: "failed_retryable",
    });
    expect(JSON.stringify(result)).not.toContain("AI_PROVIDER_TRANSIENT_FAILURE");
  });

  it("maps terminal failures to human-readable safe output", async () => {
    const value = project();
    const run = value.intelligenceRuns[0] as RunFixture;
    value.intelligenceRuns[0] = {
      ...run,
      failureCode: "INTELLIGENCE_GROUP_TERMINAL_FAILURE",
      status: "failed_terminal",
    };
    const { service } = harness(value);
    const result = await service.getProjectIntelligence(userId, projectId);
    expect(result.processing).toMatchObject({
      failureCode: "processing_failed",
      statusMessage:
        "Development intelligence could not be processed. Try syncing again later.",
    });
    expect(JSON.stringify(result)).not.toContain(
      "INTELLIGENCE_GROUP_TERMINAL_FAILURE"
    );
  });

  it.each([
    ["queued", "Development intelligence is queued."],
    ["running", "Development intelligence is being processed."],
    ["succeeded", "Development intelligence is up to date."],
  ] as const)("maps %s to human-readable status", async (status, message) => {
    const value = project();
    const run = value.intelligenceRuns[0] as RunFixture;
    value.intelligenceRuns[0] = { ...run, status };
    const { service } = harness(value);
    const result = await service.getProjectIntelligence(userId, projectId);
    expect(result.processing?.statusMessage).toBe(message);
  });

  it("does not expose raw evidence, AIExecution data, credentials, or worker leases", async () => {
    const { service } = harness();
    const serialized = JSON.stringify(
      await service.getProjectIntelligence(userId, projectId)
    );
    expect(serialized).not.toMatch(
      /commitMessage|pullRequestTitle|pullRequestBody|filePath|prompt|rawResponse|modelConfiguration|inputTokens|outputTokens|leaseToken|leaseExpiresAt|accessToken|credential/i
    );
  });

  it("logs only safe read metadata rather than intelligence text", async () => {
    const { info, service } = harness();
    await service.getProjectIntelligence(userId, projectId);
    expect(info).toHaveBeenCalledWith("project_intelligence_read", {
      eventCount: 2,
      intelligenceStatus: "succeeded",
      projectId,
      stateVersion: 3,
    });
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/Safe title|Safe summary/);
  });
});
