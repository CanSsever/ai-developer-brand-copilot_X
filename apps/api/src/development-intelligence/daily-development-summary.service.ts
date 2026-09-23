import { createHash } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { DailyDevelopmentSummaryItem, DailyDevelopmentSummaryResponse, DailyDevelopmentSummaryStatus, DevelopmentEventType } from "@developer-brand-copilot/contracts";
import { PrismaService } from "../database/prisma.service";
import { StructuredLogger } from "../observability/structured-logger";
import { developerDayWindow } from "./developer-day";

export const dailySummaryGenerationVersion = "daily-development-summary-v1";
export const dailySummaryItemLimit = 10;
export const DAILY_SUMMARY_CLOCK = Symbol("DAILY_SUMMARY_CLOCK");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function statusMessage(status: DailyDevelopmentSummaryStatus): string {
  if (status === "no_activity") return "No repository activity was recorded for this developer day.";
  if (status === "no_meaningful_events") return "Repository activity was recorded, but no meaningful development event was detected.";
  if (status === "processing") return "Repository activity for today is still being processed.";
  if (status === "failed") return "Development intelligence for today could not be processed. Try syncing again later.";
  return "Meaningful development for today is ready.";
}

function summaryItems(value: unknown): readonly DailyDevelopmentSummaryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const entry = item as Record<string, unknown>;
    return typeof entry.developmentEventId === "string" && typeof entry.summary === "string" && typeof entry.title === "string" && typeof entry.type === "string"
      ? [{ developmentEventId: entry.developmentEventId, summary: entry.summary, title: entry.title, type: entry.type as DevelopmentEventType }]
      : [];
  });
}

@Injectable()
export class DailyDevelopmentSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLogger,
    @Inject(DAILY_SUMMARY_CLOCK) private readonly clock: () => Date
  ) {}

  async getToday(userId: string, projectId: string): Promise<DailyDevelopmentSummaryResponse> {
    if (!uuidPattern.test(projectId)) throw new NotFoundException("Project not found");
    const owned = await this.prisma.project.findFirst({ where: { id: projectId, userId }, select: { id: true, timezone: true } });
    if (!owned) throw new NotFoundException("Project not found");
    const day = developerDayWindow(this.clock(), owned.timezone);
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: {
        connectedRepository: { select: { commits: {
          where: { committedAt: { gte: day.start, lt: day.end }, orphanedAt: null },
          orderBy: [{ committedAt: "asc" }, { id: "asc" }], select: { id: true, sha: true },
        } } },
        developmentEvents: {
          where: {
            occurredAt: { gte: day.start, lt: day.end }, status: "active",
            OR: [
              { commitEvidence: { some: { detachedAt: null, role: "supporting", gitHubCommit: { orphanedAt: null } } } },
              { pullRequestEvidence: { some: { detachedAt: null, role: "supporting", gitHubPullRequestId: { not: null } } } },
            ],
          },
          orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: {
            commitEvidence: { where: { detachedAt: null, role: "supporting", gitHubCommit: { orphanedAt: null } }, select: { commitSha: true } },
            confidence: true, extractionVersion: true, id: true, occurredAt: true,
            summary: true, title: true, type: true,
          },
        },
        intelligenceRuns: {
          where: { sourceWindowStart: { lt: day.end }, sourceWindowEnd: { gt: day.start } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1,
          select: { failureCode: true, groupsDiscovered: true, groupsFailed: true, groupsRejected: true, groupsSucceeded: true, processingVersion: true, status: true },
        },
        projectState: { select: { projectionVersion: true, sourceFingerprint: true, version: true } },
      },
    });
    if (!project) throw new NotFoundException("Project not found");
    const commits = project.connectedRepository?.commits ?? [];
    const events = project.developmentEvents;
    const run = project.intelligenceRuns[0] ?? null;
    const supportedCommitShas = new Set(events.flatMap((event) => event.commitEvidence.map((link) => link.commitSha)));
    const excludedActivityCount = commits.filter((commit) => !supportedCommitShas.has(commit.sha)).length;
    let status: DailyDevelopmentSummaryStatus;
    if (run?.status === "queued" || run?.status === "running") status = "processing";
    else if (run?.status === "failed_retryable" || run?.status === "failed_terminal") status = "failed";
    else if (events.length > 0) status = "completed";
    else if (commits.length > 0) status = "no_meaningful_events";
    else status = "no_activity";

    const items = events.slice(0, dailySummaryItemLimit).map((event) => ({
      developmentEventId: event.id, summary: event.summary, title: event.title,
      type: event.type as DevelopmentEventType,
    }));
    const confidence = events.length === 0 ? null : events.reduce((sum, event) => sum + Number(event.confidence), 0) / events.length;
    const inputFingerprint = fingerprint({
      commits: commits.map((commit) => commit.sha), day: day.dateString,
      events: events.map((event) => ({ confidence: Number(event.confidence), extractionVersion: event.extractionVersion, id: event.id, occurredAt: event.occurredAt.toISOString(), summary: event.summary, title: event.title, type: event.type })),
      generationVersion: dailySummaryGenerationVersion, projectState: project.projectState,
      run, timezone: owned.timezone,
    });
    const persisted = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.dailyDevelopmentSummary.findFirst({
        where: { projectId, developerDay: day.date, timezone: owned.timezone, inputFingerprint, generationVersion: dailySummaryGenerationVersion },
      });
      if (existing) return existing;
      const latest = await transaction.dailyDevelopmentSummary.findFirst({
        where: { projectId, developerDay: day.date, timezone: owned.timezone },
        orderBy: { version: "desc" }, select: { version: true },
      });
      await transaction.dailyDevelopmentSummary.updateMany({
        where: { projectId, developerDay: day.date, timezone: owned.timezone, isCurrent: true },
        data: { isCurrent: false },
      });
      return transaction.dailyDevelopmentSummary.create({
        data: {
          projectId, developerDay: day.date, timezone: owned.timezone, inputFingerprint,
          generationVersion: dailySummaryGenerationVersion, version: (latest?.version ?? 0) + 1,
          status, commitCount: commits.length, eventCount: events.length, excludedActivityCount,
          confidence, summaryItems: items, projectStateVersion: project.projectState?.version ?? null,
          developmentEvents: { create: events.map((event) => ({ developmentEventId: event.id })) },
        },
      });
    }, { isolationLevel: "Serializable" }).catch(async (error: unknown) => {
      const concurrentlyCreated = await this.prisma.dailyDevelopmentSummary.findFirst({
        where: {
          projectId,
          developerDay: day.date,
          timezone: owned.timezone,
          inputFingerprint,
          generationVersion: dailySummaryGenerationVersion,
        },
      });
      if (!concurrentlyCreated) throw error;
      return concurrentlyCreated;
    });
    const response: DailyDevelopmentSummaryResponse = {
      confidence: persisted.confidence === null ? null : Number(persisted.confidence),
      counts: {
        commits: persisted.commitCount,
        excludedActivities: persisted.excludedActivityCount,
        meaningfulEvents: persisted.eventCount,
      },
      developerDay: day.dateString,
      generationVersion: persisted.generationVersion,
      items: summaryItems(persisted.summaryItems),
      projectId,
      projectStateVersion: persisted.projectStateVersion,
      status: persisted.status,
      statusMessage: statusMessage(persisted.status),
      timezone: persisted.timezone,
      version: persisted.version,
    };
    this.logger.info("daily_development_summary_read", {
      commitCount: response.counts.commits,
      eventCount: response.counts.meaningfulEvents,
      projectId,
      status: response.status,
      version: response.version,
    });
    return response;
  }
}
