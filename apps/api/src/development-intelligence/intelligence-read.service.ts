import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  DevelopmentEventType,
  IntelligenceFailureCode,
  IntelligenceProcessingStatus,
  ProjectIntelligenceSummary,
  ProjectStateEventReference,
} from "@developer-brand-copilot/contracts";
import { developmentEventTypes } from "@developer-brand-copilot/contracts";

import { PrismaService } from "../database/prisma.service";
import { StructuredLogger } from "../observability/structured-logger";
import { authoritativeDevelopmentEventWhere } from "./authoritative-development-event-where";

export const intelligenceEventLimit = 20;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeFailureCode(
  status: IntelligenceProcessingStatus
): IntelligenceFailureCode | null {
  if (status === "failed_retryable") return "temporarily_unavailable";
  if (status === "failed_terminal") return "processing_failed";
  return null;
}

function statusMessage(status: IntelligenceProcessingStatus): string {
  switch (status) {
    case "queued":
      return "Development intelligence is queued.";
    case "running":
      return "Development intelligence is being processed.";
    case "succeeded":
      return "Development intelligence is up to date.";
    case "failed_retryable":
      return "Development intelligence is temporarily delayed and will retry automatically.";
    case "failed_terminal":
      return "Development intelligence could not be processed. Try syncing again later.";
  }
}

const developmentEventTypeSet = new Set<string>(developmentEventTypes);

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

function stateReferences(value: unknown): readonly ProjectStateEventReference[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const relatedFeatureIds = stringArray(record.relatedFeatureIds);
    const technologies = stringArray(record.technologies);
    if (
      typeof record.developmentEventId !== "string" ||
      typeof record.occurredAt !== "string" ||
      relatedFeatureIds === null ||
      typeof record.summary !== "string" ||
      technologies === null ||
      typeof record.title !== "string" ||
      typeof record.type !== "string" ||
      !developmentEventTypeSet.has(record.type)
    ) {
      return [];
    }

    return [{
      developmentEventId: record.developmentEventId,
      occurredAt: record.occurredAt,
      relatedFeatureIds,
      summary: record.summary,
      technologies,
      title: record.title,
      type: record.type as DevelopmentEventType,
    }];
  });
}

@Injectable()
export class IntelligenceReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLogger
  ) {}

  async getProjectIntelligence(
    userId: string,
    projectId: string
  ): Promise<ProjectIntelligenceSummary> {
    if (!uuidPattern.test(projectId)) {
      throw new NotFoundException("Project not found");
    }

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: {
        id: true,
        projectState: {
          select: {
            activeFeatures: true,
            completedFeatures: true,
            currentPhase: true,
            lastUpdatedAt: true,
            projectionVersion: true,
            purpose: true,
            recentMilestones: true,
            targetAudience: true,
            technologies: true,
            version: true,
          },
        },
        developmentEvents: {
          where: {
            ...authoritativeDevelopmentEventWhere(projectId),
          },
          orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: intelligenceEventLimit,
          select: {
            _count: { select: { commitEvidence: true, pullRequestEvidence: true } },
            confidence: true,
            extractionVersion: true,
            id: true,
            occurredAt: true,
            status: true,
            summary: true,
            title: true,
            type: true,
          },
        },
        intelligenceRuns: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            finishedAt: true,
            groupsDiscovered: true,
            groupsFailed: true,
            groupsRejected: true,
            groupsSucceeded: true,
            processingVersion: true,
            queuedAt: true,
            retryAfterAt: true,
            startedAt: true,
            status: true,
          },
        },
      },
    });

    if (!project) throw new NotFoundException("Project not found");

    const latestRun = project.intelligenceRuns[0] ?? null;
    const result: ProjectIntelligenceSummary = {
      projectId: project.id,
      eventLimit: intelligenceEventLimit,
      currentState: project.projectState
        ? {
            activeFeatures: stateReferences(project.projectState.activeFeatures),
            completedFeatures: stateReferences(project.projectState.completedFeatures),
            currentPhase: project.projectState.currentPhase,
            projectionVersion: project.projectState.projectionVersion,
            purpose: project.projectState.purpose,
            recentMilestones: stateReferences(project.projectState.recentMilestones),
            targetAudience: project.projectState.targetAudience,
            technologies: project.projectState.technologies,
            updatedAt: project.projectState.lastUpdatedAt.toISOString(),
            version: project.projectState.version,
          }
        : null,
      events: project.developmentEvents.map((event) => ({
        confidence: Number(event.confidence),
        eventId: event.id,
        extractionVersion: event.extractionVersion,
        occurredAt: event.occurredAt.toISOString(),
        provenance: {
          commitCount: event._count.commitEvidence,
          pullRequestCount: event._count.pullRequestEvidence,
        },
        status: "active",
        summary: event.summary,
        title: event.title,
        type: event.type as DevelopmentEventType,
      })),
      processing: latestRun
        ? {
            counters: {
              groupsDiscovered: latestRun.groupsDiscovered,
              groupsFailed: latestRun.groupsFailed,
              groupsRejected: latestRun.groupsRejected,
              groupsSucceeded: latestRun.groupsSucceeded,
            },
            failureCode: safeFailureCode(latestRun.status),
            finishedAt: latestRun.finishedAt?.toISOString() ?? null,
            processingVersion: latestRun.processingVersion,
            queuedAt: latestRun.queuedAt.toISOString(),
            retryAfterAt: latestRun.retryAfterAt?.toISOString() ?? null,
            startedAt: latestRun.startedAt?.toISOString() ?? null,
            status: latestRun.status,
            statusMessage: statusMessage(latestRun.status),
          }
        : null,
    };

    this.logger.info("project_intelligence_read", {
      eventCount: result.events.length,
      intelligenceStatus: result.processing?.status ?? "not_started",
      projectId: result.projectId,
      stateVersion: result.currentState?.version ?? null,
    });
    return result;
  }
}
