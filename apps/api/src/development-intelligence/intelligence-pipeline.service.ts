import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";
import { StructuredLogger } from "../observability/structured-logger";
import {
  DevelopmentEventInterpretationError,
  DevelopmentEventInterpreterService,
} from "./development-event-interpreter.service";
import { EvidenceGroupingService } from "./evidence-grouping.service";
import {
  evidenceGroupingVersion,
  type EvidenceGroupingRequest,
} from "./evidence-grouping.types";
import {
  projectStateProjectionVersion,
  ProjectStateProjectorService,
} from "./project-state-projector.service";
import { INTELLIGENCE_PIPELINE_CLOCK } from "./intelligence-pipeline.tokens";

export type IntelligenceFailureCode =
  | "INTELLIGENCE_CONFIGURATION_FAILURE"
  | "INTELLIGENCE_GROUP_RETRYABLE_FAILURE"
  | "INTELLIGENCE_GROUP_TERMINAL_FAILURE"
  | "INTELLIGENCE_LEASE_LOST"
  | "INTELLIGENCE_PERSISTENCE_FAILURE"
  | "INTELLIGENCE_PROJECT_NOT_AVAILABLE"
  | "INTELLIGENCE_SOURCE_NOT_AVAILABLE"
  | "INTELLIGENCE_VERSION_STALE";

export class IntelligencePipelineError extends Error {
  constructor(
    readonly failureCode: IntelligenceFailureCode,
    readonly retryable = false,
    readonly retryAfterAt: Date | null = null
  ) {
    super("Intelligence pipeline execution failed");
    this.name = "IntelligencePipelineError";
  }
}

export interface IntelligenceProcessingVersions {
  readonly groupingVersion: string;
  readonly interpretationVersion: string;
  readonly processingVersion: string;
  readonly projectionVersion: string;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

@Injectable()
export class IntelligencePipelineService {
  readonly versions: IntelligenceProcessingVersions;

  constructor(
    private readonly prisma: PrismaService,
    private readonly grouping: EvidenceGroupingService,
    private readonly interpreter: DevelopmentEventInterpreterService,
    private readonly projector: ProjectStateProjectorService,
    private readonly logger: StructuredLogger,
    @Inject(INTELLIGENCE_PIPELINE_CLOCK) private readonly clock: () => Date
  ) {
    const interpretationVersion = interpreter.getProcessingVersion();
    this.versions = {
      groupingVersion: evidenceGroupingVersion,
      interpretationVersion,
      processingVersion: sha256({
        groupingVersion: evidenceGroupingVersion,
        interpretationVersion,
        projectionVersion: projectStateProjectionVersion,
      }),
      projectionVersion: projectStateProjectionVersion,
    };
  }

  async enqueueEligibleCompletedSync(): Promise<boolean> {
    const source = await this.prisma.syncRun.findFirst({
      where: {
        status: "succeeded",
        intelligenceRuns: { none: {} },
        connectedRepository: {
          project: {
            intelligenceRuns: {
              none: {
                status: {
                  in: ["queued", "running", "failed_retryable"],
                },
              },
            },
          },
        },
      },
      orderBy: [{ finishedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        windowEnd: true,
        windowStart: true,
        connectedRepository: { select: { projectId: true } },
      },
    });
    if (!source) return false;

    try {
      const run = await this.createRun(
        source.connectedRepository.projectId,
        source.id,
        source.windowStart,
        source.windowEnd,
        "sync_completion"
      );
      this.logger.info("intelligence_run_queued", {
        intelligenceRunId: run.id,
        processingVersion: this.versions.processingVersion,
        projectId: source.connectedRepository.projectId,
        sourceSyncRunId: source.id,
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintError(error)) return false;
      throw new IntelligencePipelineError(
        "INTELLIGENCE_PERSISTENCE_FAILURE",
        true
      );
    }
  }

  async enqueueReprocessing(
    projectId: string,
    userId: string
  ): Promise<{ readonly intelligenceRunId: string; readonly status: "queued" | "reused" }> {
    const source = await this.prisma.syncRun.findFirst({
      where: {
        status: "succeeded",
        connectedRepository: { projectId, project: { userId } },
      },
      orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
      select: { id: true, windowEnd: true, windowStart: true },
    });
    if (!source) {
      throw new IntelligencePipelineError(
        "INTELLIGENCE_SOURCE_NOT_AVAILABLE"
      );
    }
    const existing = await this.prisma.intelligenceRun.findUnique({
      where: {
        sourceSyncRunId_processingVersion: {
          sourceSyncRunId: source.id,
          processingVersion: this.versions.processingVersion,
        },
      },
      select: { id: true },
    });
    if (existing) {
      return { intelligenceRunId: existing.id, status: "reused" };
    }
    try {
      const run = await this.createRun(
        projectId,
        source.id,
        source.windowStart,
        source.windowEnd,
        "manual_reprocess"
      );
      this.logger.info("intelligence_reprocessing_started", {
        intelligenceRunId: run.id,
        processingVersion: this.versions.processingVersion,
        projectId,
      });
      return { intelligenceRunId: run.id, status: "queued" };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new IntelligencePipelineError(
          "INTELLIGENCE_PERSISTENCE_FAILURE",
          true
        );
      }
      throw error;
    }
  }

  async executeClaimed(runId: string, leaseToken: string): Promise<void> {
    const run = await this.prisma.intelligenceRun.findFirst({
      where: { id: runId, leaseToken, status: "running" },
      select: {
        id: true,
        processingVersion: true,
        projectId: true,
        sourceWindowEnd: true,
        sourceWindowStart: true,
        project: { select: { userId: true } },
      },
    });
    if (!run) {
      throw new IntelligencePipelineError("INTELLIGENCE_LEASE_LOST");
    }
    if (run.processingVersion !== this.versions.processingVersion) {
      throw new IntelligencePipelineError("INTELLIGENCE_VERSION_STALE");
    }

    const groupingRequest: EvidenceGroupingRequest = {
      evaluationBoundary: run.sourceWindowEnd,
      projectId: run.projectId,
      sourceWindowStart: run.sourceWindowStart,
      userId: run.project.userId,
    };
    const groups = await this.grouping.selectAndGroup(groupingRequest);
    let groupsSucceeded = 0;
    let groupsRejected = 0;
    let groupsFailed = 0;
    let retryableFailure = false;
    let terminalFailure = false;
    let retryAfterAt: Date | null = null;

    for (const group of groups) {
      try {
        const result = await this.interpreter.interpret({
          groupKey: group.groupKey,
          grouping: groupingRequest,
        });
        if (result.status === "insufficient_evidence") {
          groupsRejected += 1;
        } else {
          groupsSucceeded += 1;
        }
        this.logger.info("intelligence_group_processed", {
          groupingFingerprint: group.groupKey,
          intelligenceRunId: run.id,
          result: result.status,
        });
      } catch (error) {
        groupsFailed += 1;
        if (
          error instanceof DevelopmentEventInterpretationError &&
          error.retryable
        ) {
          retryableFailure = true;
          if (
            error.retryAfterAt &&
            (!retryAfterAt || error.retryAfterAt > retryAfterAt)
          ) {
            retryAfterAt = error.retryAfterAt;
          }
        } else {
          terminalFailure = true;
        }
      }
    }

    await this.updateClaimed(run.id, leaseToken, {
      groupsDiscovered: groups.length,
      groupsFailed,
      groupsRejected,
      groupsSucceeded,
    });

    if (retryableFailure) {
      throw new IntelligencePipelineError(
        "INTELLIGENCE_GROUP_RETRYABLE_FAILURE",
        true,
        retryAfterAt
      );
    }

    await this.projector.project({
      projectId: run.projectId,
      userId: run.project.userId,
    });

    if (terminalFailure) {
      throw new IntelligencePipelineError(
        "INTELLIGENCE_GROUP_TERMINAL_FAILURE"
      );
    }

    const completed = await this.prisma.intelligenceRun.updateMany({
      where: { id: run.id, leaseToken, status: "running" },
      data: {
        failureCode: null,
        finishedAt: this.clock(),
        leaseExpiresAt: null,
        leaseToken: null,
        retryAfterAt: null,
        status: "succeeded",
      },
    });
    if (completed.count !== 1) {
      throw new IntelligencePipelineError("INTELLIGENCE_LEASE_LOST");
    }
  }

  private createRun(
    projectId: string,
    sourceSyncRunId: string,
    sourceWindowStart: Date,
    sourceWindowEnd: Date,
    trigger: "manual_reprocess" | "sync_completion"
  ) {
    return this.prisma.intelligenceRun.create({
      data: {
        ...this.versions,
        projectId,
        runKey: sha256({
          processingVersion: this.versions.processingVersion,
          projectId,
          sourceSyncRunId,
        }),
        sourceSyncRunId,
        sourceWindowEnd,
        sourceWindowStart,
        trigger,
      },
      select: { id: true },
    });
  }

  private async updateClaimed(
    id: string,
    leaseToken: string,
    data: {
      readonly groupsDiscovered: number;
      readonly groupsFailed: number;
      readonly groupsRejected: number;
      readonly groupsSucceeded: number;
    }
  ): Promise<void> {
    const updated = await this.prisma.intelligenceRun.updateMany({
      where: { id, leaseToken, status: "running" },
      data,
    });
    if (updated.count !== 1) {
      throw new IntelligencePipelineError("INTELLIGENCE_LEASE_LOST");
    }
  }
}
