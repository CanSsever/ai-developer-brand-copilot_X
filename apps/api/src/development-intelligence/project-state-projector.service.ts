import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";

import { PrismaService } from "../database/prisma.service";
import { StructuredLogger } from "../observability/structured-logger";

export const projectStateProjectionVersion = "project-state-projection-v1";

const recentMilestoneLimit = 20;
const recentMilestoneWindowMs = 90 * 24 * 60 * 60 * 1000;
const milestoneTypes = new Set([
  "project_milestone",
  "release",
  "testing_milestone",
]);

type ProjectionFailureCode =
  | "PROJECT_NOT_AVAILABLE"
  | "PROJECT_STATE_CONFLICT"
  | "PROJECT_STATE_INCONSISTENT"
  | "PROJECT_STATE_PERSISTENCE_FAILED";

export class ProjectStateProjectionError extends Error {
  constructor(
    readonly failureCode: ProjectionFailureCode,
    readonly retryable = false
  ) {
    super("Project state projection failed");
    this.name = "ProjectStateProjectionError";
  }
}

export interface ProjectStateProjectionRequest {
  readonly projectId: string;
  readonly userId: string;
}

export interface ProjectStateProjectionResult {
  readonly projectStateId: string;
  readonly projectStateVersionId: string;
  readonly replayFingerprint: string;
  readonly status: "created" | "unchanged";
  readonly version: number;
}

interface AuthoritativeEvent {
  readonly confidence: Prisma.Decimal;
  readonly contentPotentialScore: Prisma.Decimal;
  readonly createdAt: Date;
  readonly eventKey: string;
  readonly extractionVersion: string;
  readonly id: string;
  readonly importanceScore: Prisma.Decimal;
  readonly inputFingerprint: string;
  readonly occurredAt: Date;
  readonly relatedFeatureIds: readonly string[];
  readonly summary: string;
  readonly technologies: readonly string[];
  readonly title: string;
  readonly type: string;
}

interface StateEventReference {
  readonly developmentEventId: string;
  readonly occurredAt: string;
  readonly relatedFeatureIds: readonly string[];
  readonly summary: string;
  readonly technologies: readonly string[];
  readonly title: string;
  readonly type: string;
}

interface ProjectedState {
  readonly activeFeatures: readonly StateEventReference[];
  readonly completedFeatures: readonly StateEventReference[];
  readonly currentPhase: null;
  readonly lastUpdatedAt: Date;
  readonly purpose: null;
  readonly recentMilestones: readonly StateEventReference[];
  readonly replayFingerprint: string;
  readonly targetAudience: null;
  readonly technologies: readonly string[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: readonly string[]): string[] {
  const normalized = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const existing = normalized.get(key);
    if (!existing || compareText(trimmed, existing) < 0) {
      normalized.set(key, trimmed);
    }
  }
  return [...normalized.values()].sort(compareText);
}

function eventReference(event: AuthoritativeEvent): StateEventReference {
  return {
    developmentEventId: event.id,
    occurredAt: event.occurredAt.toISOString(),
    relatedFeatureIds: [...event.relatedFeatureIds].sort(compareText),
    summary: event.summary,
    technologies: sortedUnique(event.technologies),
    title: event.title,
    type: event.type,
  };
}

export function buildProjectStateReplayFingerprint(
  authoritativeEventsJson: string,
  projectionVersion: string
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        events: JSON.parse(authoritativeEventsJson) as unknown,
        projectionVersion,
      })
    )
    .digest("hex");
}

function fingerprint(events: readonly AuthoritativeEvent[]): string {
  const canonical = events.map((event) => ({
    confidence: event.confidence.toString(),
    contentPotentialScore: event.contentPotentialScore.toString(),
    createdAt: event.createdAt.toISOString(),
    eventKey: event.eventKey,
    extractionVersion: event.extractionVersion,
    id: event.id,
    importanceScore: event.importanceScore.toString(),
    inputFingerprint: event.inputFingerprint,
    occurredAt: event.occurredAt.toISOString(),
    relatedFeatureIds: [...event.relatedFeatureIds].sort(compareText),
    summary: event.summary,
    technologies: sortedUnique(event.technologies),
    title: event.title,
    type: event.type,
  }));

  return buildProjectStateReplayFingerprint(
    JSON.stringify(canonical),
    projectStateProjectionVersion
  );
}

function isRetryableTransactionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

function assertStructuredCurrentState(state: {
  readonly activeFeatures: unknown;
  readonly completedFeatures: unknown;
  readonly recentMilestones: unknown;
}): void {
  if (
    !Array.isArray(state.activeFeatures) ||
    !Array.isArray(state.completedFeatures) ||
    !Array.isArray(state.recentMilestones)
  ) {
    throw new ProjectStateProjectionError("PROJECT_STATE_INCONSISTENT");
  }
}

@Injectable()
export class ProjectStateProjectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLogger
  ) {}

  async project(
    request: ProjectStateProjectionRequest
  ): Promise<ProjectStateProjectionResult> {
    const startedAt = Date.now();
    this.logger.info("project_state_projection_started", {
      projectId: request.projectId,
      projectionVersion: projectStateProjectionVersion,
    });

    try {
      const result = await this.prisma.$transaction(
        async (transaction) => {
          const project = await transaction.project.findFirst({
            where: { id: request.projectId, userId: request.userId },
            select: { createdAt: true, id: true },
          });
          if (!project) {
            throw new ProjectStateProjectionError("PROJECT_NOT_AVAILABLE");
          }

          const events = await transaction.developmentEvent.findMany({
            where: { projectId: project.id, status: "active" },
            orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            select: {
              confidence: true,
              contentPotentialScore: true,
              createdAt: true,
              eventKey: true,
              extractionVersion: true,
              id: true,
              importanceScore: true,
              inputFingerprint: true,
              occurredAt: true,
              relatedFeatureIds: true,
              summary: true,
              technologies: true,
              title: true,
              type: true,
            },
          });
          const projected = this.calculateState(events, project.createdAt);
          const current = await transaction.projectState.findUnique({
            where: { projectId: project.id },
          });

          if (
            current?.sourceFingerprint === projected.replayFingerprint &&
            current.projectionVersion === projectStateProjectionVersion
          ) {
            const existingVersion =
              await transaction.projectStateVersion.findUnique({
                where: {
                  projectStateId_sourceFingerprint_projectionVersion: {
                    projectStateId: current.id,
                    projectionVersion: projectStateProjectionVersion,
                    sourceFingerprint: projected.replayFingerprint,
                  },
                },
                select: { id: true, version: true },
              });
            if (!existingVersion || existingVersion.version !== current.version) {
              throw new ProjectStateProjectionError(
                "PROJECT_STATE_INCONSISTENT"
              );
            }
            return {
              eventCount: events.length,
              projectStateId: current.id,
              projectStateVersionId: existingVersion.id,
              replayFingerprint: projected.replayFingerprint,
              status: "unchanged" as const,
              version: current.version,
            };
          }

          if (current) {
            assertStructuredCurrentState(current);
            const replayAlreadyExists =
              await transaction.projectStateVersion.findUnique({
                where: {
                  projectStateId_sourceFingerprint_projectionVersion: {
                    projectStateId: current.id,
                    projectionVersion: projectStateProjectionVersion,
                    sourceFingerprint: projected.replayFingerprint,
                  },
                },
                select: { id: true },
              });
            if (replayAlreadyExists) {
              throw new ProjectStateProjectionError(
                "PROJECT_STATE_INCONSISTENT"
              );
            }
          }

          const nextVersion = current ? current.version + 1 : 1;
          const stateData = {
            activeFeatures:
              projected.activeFeatures as unknown as Prisma.InputJsonValue,
            completedFeatures:
              projected.completedFeatures as unknown as Prisma.InputJsonValue,
            currentPhase: projected.currentPhase,
            lastUpdatedAt: projected.lastUpdatedAt,
            projectionVersion: projectStateProjectionVersion,
            purpose: projected.purpose,
            recentMilestones:
              projected.recentMilestones as unknown as Prisma.InputJsonValue,
            sourceFingerprint: projected.replayFingerprint,
            targetAudience: projected.targetAudience,
            technologies: [...projected.technologies],
            version: nextVersion,
          };

          let projectStateId: string;
          if (current) {
            const updated = await transaction.projectState.updateMany({
              where: { id: current.id, version: current.version },
              data: stateData,
            });
            if (updated.count !== 1) {
              throw new ProjectStateProjectionError(
                "PROJECT_STATE_CONFLICT",
                true
              );
            }
            projectStateId = current.id;
          } else {
            const created = await transaction.projectState.create({
              data: { ...stateData, projectId: project.id },
              select: { id: true },
            });
            projectStateId = created.id;
          }

          const stateVersion = await transaction.projectStateVersion.create({
            data: {
              ...stateData,
              projectStateId,
              developmentEvents: {
                create: events.map((event) => ({
                  developmentEventId: event.id,
                })),
              },
            },
            select: { id: true },
          });

          return {
            eventCount: events.length,
            projectStateId,
            projectStateVersionId: stateVersion.id,
            replayFingerprint: projected.replayFingerprint,
            status: "created" as const,
            version: nextVersion,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      this.logger.info(
        result.status === "created"
          ? "project_state_projection_created"
          : "project_state_projection_unchanged",
        {
          durationMs: Date.now() - startedAt,
          eventCount: result.eventCount,
          projectId: request.projectId,
          projectionVersion: projectStateProjectionVersion,
          replayFingerprint: result.replayFingerprint,
          stateVersion: result.version,
        }
      );
      const { eventCount: _eventCount, ...publicResult } = result;
      return publicResult;
    } catch (error) {
      const normalized =
        error instanceof ProjectStateProjectionError
          ? error
          : isRetryableTransactionError(error)
            ? new ProjectStateProjectionError("PROJECT_STATE_CONFLICT", true)
            : new ProjectStateProjectionError(
                "PROJECT_STATE_PERSISTENCE_FAILED",
                true
              );
      const event =
        normalized.failureCode === "PROJECT_STATE_CONFLICT"
          ? "project_state_projection_conflict"
          : "project_state_projection_failed";
      this.logger[
        normalized.failureCode === "PROJECT_STATE_CONFLICT"
          ? "warnEvent"
          : "errorEvent"
      ](event, {
        durationMs: Date.now() - startedAt,
        failureCode: normalized.failureCode,
        projectId: request.projectId,
        projectionVersion: projectStateProjectionVersion,
      });
      throw normalized;
    }
  }

  private calculateState(
    events: readonly AuthoritativeEvent[],
    projectCreatedAt: Date
  ): ProjectedState {
    const lastUpdatedAt =
      events.at(-1)?.occurredAt ?? projectCreatedAt;
    const milestoneWindowStart =
      lastUpdatedAt.getTime() - recentMilestoneWindowMs;
    const references = events.map((event) => ({
      event,
      reference: eventReference(event),
    }));
    const completedFeatureIds = new Set(
      events
        .filter((event) => event.type === "feature_completed")
        .flatMap((event) => event.relatedFeatureIds)
    );

    return {
      activeFeatures: references
        .filter(
          ({ event }) =>
            event.type === "feature_started" &&
            !event.relatedFeatureIds.some((featureId) =>
              completedFeatureIds.has(featureId)
            )
        )
        .map(({ reference }) => reference),
      completedFeatures: references
        .filter(({ event }) => event.type === "feature_completed")
        .map(({ reference }) => reference),
      currentPhase: null,
      lastUpdatedAt,
      purpose: null,
      recentMilestones: references
        .filter(
          ({ event }) =>
            milestoneTypes.has(event.type) &&
            event.occurredAt.getTime() >= milestoneWindowStart
        )
        .slice(-recentMilestoneLimit)
        .reverse()
        .map(({ reference }) => reference),
      replayFingerprint: fingerprint(events),
      targetAudience: null,
      technologies: sortedUnique(
        events.flatMap((event) => event.technologies)
      ),
    };
  }
}
