import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../database/prisma.service";
import type { StructuredLogger } from "../observability/structured-logger";
import { DailyDevelopmentSummaryService } from "./daily-development-summary.service";

const userId = "123e4567-e89b-42d3-a456-426614174000";
const projectId = "323e4567-e89b-42d3-a456-426614174000";
const now = new Date("2026-03-29T22:30:00.000Z");

function event(id = "event-1") {
  return {
    commitEvidence: [{ commitSha: "a".repeat(40) }], confidence: 0.9,
    extractionVersion: "extraction-v1", id,
    occurredAt: new Date("2026-03-29T12:00:00.000Z"),
    summary: `Summary ${id}`, title: `Title ${id}`, type: "feature_completed" as const,
  };
}

function harness(options: {
  commits?: readonly { id: string; sha: string }[];
  events?: readonly ReturnType<typeof event>[];
  existing?: Record<string, unknown> | null;
  runStatus?: "queued" | "running" | "succeeded" | "failed_retryable" | "failed_terminal";
  timezone?: string;
  transactionError?: Error;
  concurrentlyCreated?: Record<string, unknown> | null;
} = {}) {
  const projectFindFirst = vi.fn()
    .mockResolvedValueOnce({ id: projectId, timezone: options.timezone ?? "Europe/Berlin" })
    .mockResolvedValueOnce({
      connectedRepository: { commits: options.commits ?? [] },
      developmentEvents: options.events ?? [],
      intelligenceRuns: options.runStatus ? [{ failureCode: null, groupsDiscovered: 1, groupsFailed: 0, groupsRejected: 0, groupsSucceeded: 1, processingVersion: "processing-v1", status: options.runStatus }] : [],
      projectState: { projectionVersion: "projection-v2", sourceFingerprint: "b".repeat(64), version: 2 },
    });
  const summaryFindFirst = vi.fn()
    .mockResolvedValueOnce(options.existing ?? null)
    .mockResolvedValueOnce(null);
  const create = vi.fn().mockImplementation(({ data }) => ({ id: "summary-1", ...data }));
  const transaction = {
    dailyDevelopmentSummary: { create, findFirst: summaryFindFirst, updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    project: { findFirst: projectFindFirst },
    dailyDevelopmentSummary: { findFirst: vi.fn().mockResolvedValue(options.concurrentlyCreated ?? null) },
    $transaction: options.transactionError
      ? vi.fn().mockRejectedValue(options.transactionError)
      : vi.fn().mockImplementation((callback) => callback(transaction)),
  } as unknown as PrismaService;
  const info = vi.fn();
  const service = new DailyDevelopmentSummaryService(prisma, { info } as unknown as StructuredLogger, () => now);
  return { create, info, projectFindFirst, service, summaryFindFirst };
}

describe("DailyDevelopmentSummaryService", () => {
  it("uses the Project timezone across a UTC/local-date and DST boundary", async () => {
    const { projectFindFirst, service } = harness();
    const result = await service.getToday(userId, projectId);
    expect(result.developerDay).toBe("2026-03-30");
    const query = projectFindFirst.mock.calls[1]?.[0];
    expect(query.select.connectedRepository.select.commits.where.committedAt).toEqual({
      gte: new Date("2026-03-29T22:00:00.000Z"),
      lt: new Date("2026-03-30T22:00:00.000Z"),
    });
  });

  it("returns a coherent evidence-backed completed summary", async () => {
    const first = event("event-1");
    const second = { ...event("event-2"), confidence: 0.8, commitEvidence: [{ commitSha: "b".repeat(40) }] };
    const { service } = harness({
      commits: [{ id: "commit-1", sha: "a".repeat(40) }, { id: "commit-2", sha: "b".repeat(40) }, { id: "noise", sha: "c".repeat(40) }],
      events: [first, second], runStatus: "succeeded",
    });
    const result = await service.getToday(userId, projectId);
    expect(result.status).toBe("completed");
    expect(result.counts).toEqual({ commits: 3, excludedActivities: 1, meaningfulEvents: 2 });
    expect(result.confidence).toBeCloseTo(0.85);
    expect(result.items.map((item) => item.developmentEventId)).toEqual(["event-1", "event-2"]);
  });

  it.each([
    { commits: [], runStatus: undefined, expected: "no_activity" },
    { commits: [{ id: "commit-1", sha: "a".repeat(40) }], runStatus: "succeeded", expected: "no_meaningful_events" },
    { commits: [{ id: "commit-1", sha: "a".repeat(40) }], runStatus: "queued", expected: "processing" },
    { commits: [{ id: "commit-1", sha: "a".repeat(40) }], runStatus: "running", expected: "processing" },
    { commits: [{ id: "commit-1", sha: "a".repeat(40) }], runStatus: "failed_terminal", expected: "failed" },
  ] as const)("represents $expected without fabricating progress", async ({ commits, expected, runStatus }) => {
    const result = await harness({ commits, ...(runStatus ? { runStatus } : {}) }).service.getToday(userId, projectId);
    expect(result.status).toBe(expected);
    expect(result.items).toEqual([]);
  });

  it("uses the established authoritative-event predicate", async () => {
    const { projectFindFirst, service } = harness();
    await service.getToday(userId, projectId);
    const where = projectFindFirst.mock.calls[1]?.[0].select.developmentEvents.where;
    expect(where.status).toBe("active");
    expect(JSON.stringify(where)).toContain('"role":"supporting"');
    expect(JSON.stringify(where)).toContain('"orphanedAt":null');
  });

  it("uses a half-open day window that excludes yesterday and future events", async () => {
    const { projectFindFirst, service } = harness();
    await service.getToday(userId, projectId);
    expect(projectFindFirst.mock.calls[1]?.[0].select.developmentEvents.where.occurredAt).toEqual({
      gte: new Date("2026-03-29T22:00:00.000Z"),
      lt: new Date("2026-03-30T22:00:00.000Z"),
    });
  });

  it("reuses an unchanged fingerprint instead of creating a duplicate", async () => {
    const existing = {
      commitCount: 0, confidence: null, eventCount: 0, excludedActivityCount: 0,
      generationVersion: "daily-development-summary-v1", projectStateVersion: 2,
      status: "no_activity", summaryItems: [], timezone: "Europe/Berlin", version: 4,
    };
    const { create, service } = harness({ existing });
    const result = await service.getToday(userId, projectId);
    expect(result.version).toBe(4);
    expect(create).not.toHaveBeenCalled();
  });

  it("reuses the winning identical row after a concurrent transaction conflict", async () => {
    const concurrentlyCreated = {
      commitCount: 0, confidence: null, eventCount: 0, excludedActivityCount: 0,
      generationVersion: "daily-development-summary-v1", projectStateVersion: 2,
      status: "no_activity", summaryItems: [], timezone: "Europe/Berlin", version: 1,
    };
    const result = await harness({
      concurrentlyCreated,
      transactionError: new Error("serialization conflict"),
    }).service.getToday(userId, projectId);
    expect(result.version).toBe(1);
    expect(result.status).toBe("no_activity");
  });

  it("returns safe not-found for malformed, unknown, and cross-user Projects", async () => {
    const invalid = harness().service.getToday(userId, "not-a-uuid");
    await expect(invalid).rejects.toBeInstanceOf(NotFoundException);
    const { service } = harness();
    vi.mocked((service as unknown as { prisma: PrismaService }).prisma.project.findFirst).mockReset().mockResolvedValue(null);
    await expect(service.getToday(userId, projectId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("fails closed for an invalid persisted timezone", async () => {
    await expect(harness({ timezone: "Invalid/Timezone" }).service.getToday(userId, projectId)).rejects.toBeInstanceOf(RangeError);
  });

  it("does not call OpenAI, GitHub, or expose raw evidence in its response or logs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { info, service } = harness({ events: [event()] });
    const result = await service.getToday(userId, projectId);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/"commitSha"|"commitMessage"|"pullRequestTitle"|"filePath"|"prompt"|"rawResponse"|"credential"/i);
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/Summary event-1|Title event-1|commitSha/i);
    fetchSpy.mockRestore();
  });
});
