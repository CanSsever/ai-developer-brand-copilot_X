import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  developmentEventPromptVersion,
  developmentEventSchemaVersion,
  parseDevelopmentEventInterpretation,
  type DevelopmentEventInterpretation,
  type DevelopmentEventInterpretationInput,
  type DevelopmentEventModelClient,
  type ModelInterpretationResult,
} from "@developer-brand-copilot/ai";

import { PrismaService } from "../database/prisma.service";
import { StructuredLogger } from "../observability/structured-logger";
import {
  DEVELOPMENT_EVENT_MODEL_CLIENT,
  OPENAI_INTERPRETATION_CONFIG,
  type OpenAIInterpretationConfig,
} from "./development-intelligence.tokens";
import { EvidenceGroupingService } from "./evidence-grouping.service";
import type {
  CandidateEvidenceGroup,
  EvidenceGroupingRequest,
} from "./evidence-grouping.types";
import {
  AIProviderError,
  openAiInterpretationModelConfiguration,
} from "./openai-development-event-model.service";

const confidenceAcceptanceThreshold = 0.6;

type InterpretationFailureCode =
  | "AI_CONFIGURATION_FAILURE"
  | "AI_OUTPUT_INVALID"
  | "AI_PROVIDER_RESPONSE_INVALID"
  | "AI_PROVIDER_TRANSIENT_FAILURE"
  | "AI_REFUSAL"
  | "EVIDENCE_GROUP_NOT_AVAILABLE"
  | "EVIDENCE_SCOPE_INVALID"
  | "INTERPRETATION_PERSISTENCE_FAILED";

export class DevelopmentEventInterpretationError extends Error {
  constructor(
    readonly failureCode: InterpretationFailureCode,
    readonly retryable = false
  ) {
    super("Development event interpretation failed");
    this.name = "DevelopmentEventInterpretationError";
  }
}

export interface InterpretDevelopmentEventRequest {
  readonly groupKey: string;
  readonly grouping: EvidenceGroupingRequest;
}

export type InterpretDevelopmentEventResult =
  | {
      readonly developmentEventId: string;
      readonly status: "created" | "reused";
    }
  | {
      readonly developmentEventId: null;
      readonly status: "insufficient_evidence";
    };

interface LoadedCommit {
  readonly additions: number | null;
  readonly committedAt: Date;
  readonly deletions: number | null;
  readonly files: readonly { readonly path: string }[];
  readonly id: string;
  readonly message: string;
  readonly sha: string;
}

interface LoadedPullRequest {
  readonly additions: number;
  readonly bodySummary: string | null;
  readonly deletions: number;
  readonly files: readonly { readonly path: string }[];
  readonly id: string;
  readonly mergedAt: Date;
  readonly providerPullRequestId: bigint;
  readonly title: string;
}

interface PreparedEvidence {
  readonly commits: readonly LoadedCommit[];
  readonly input: DevelopmentEventInterpretationInput;
  readonly inputFingerprint: string;
  readonly pullRequests: readonly LoadedPullRequest[];
}

interface ValidAttempt {
  readonly executionId: string;
  readonly interpretation: DevelopmentEventInterpretation;
  readonly result: ModelInterpretationResult;
  readonly startedAt: Date;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
export class DevelopmentEventInterpreterService {
  private readonly modelConfigurationFingerprint: string;
  private readonly extractionVersion: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly grouping: EvidenceGroupingService,
    @Inject(DEVELOPMENT_EVENT_MODEL_CLIENT)
    private readonly modelClient: DevelopmentEventModelClient,
    @Inject(OPENAI_INTERPRETATION_CONFIG)
    private readonly modelConfig: OpenAIInterpretationConfig,
    private readonly logger: StructuredLogger
  ) {
    const configuration = JSON.stringify({
      model: modelConfig.model,
      ...openAiInterpretationModelConfiguration,
    });
    this.modelConfigurationFingerprint = fingerprint(configuration);
    this.extractionVersion = fingerprint(
      JSON.stringify({
        modelConfigurationFingerprint: this.modelConfigurationFingerprint,
        promptVersion: developmentEventPromptVersion,
        schemaVersion: developmentEventSchemaVersion,
      })
    );
  }

  async interpret(
    request: InterpretDevelopmentEventRequest
  ): Promise<InterpretDevelopmentEventResult> {
    const groups = await this.grouping.selectAndGroup(request.grouping);
    const group = groups.find((candidate) => candidate.groupKey === request.groupKey);
    if (!group) {
      throw new DevelopmentEventInterpretationError(
        "EVIDENCE_GROUP_NOT_AVAILABLE"
      );
    }

    const prepared = await this.prepareEvidence(group);
    const existing = await this.prisma.developmentEvent.findUnique({
      where: {
        projectId_eventKey_extractionVersion: {
          projectId: group.projectId,
          eventKey: group.groupKey,
          extractionVersion: this.extractionVersion,
        },
      },
      select: { id: true },
    });
    if (existing) {
      return { developmentEventId: existing.id, status: "reused" };
    }

    this.logger.info("development_event_interpretation_started", {
      groupingFingerprint: group.groupKey,
      model: this.modelConfig.model,
      processingVersion: this.extractionVersion,
      projectId: group.projectId,
    });

    let validAttempt: ValidAttempt;
    try {
      validAttempt = await this.runValidatedAttempt(group, prepared);
    } catch (error) {
      const failure =
        error instanceof DevelopmentEventInterpretationError
          ? error
          : new DevelopmentEventInterpretationError(
              "INTERPRETATION_PERSISTENCE_FAILED",
              true
            );
      this.logger.errorEvent("development_event_interpretation_failed", {
        failureCode: failure.failureCode,
        groupingFingerprint: group.groupKey,
        processingVersion: this.extractionVersion,
        projectId: group.projectId,
      });
      throw failure;
    }

    if (validAttempt.interpretation.decision === "insufficient_evidence") {
      await this.completeExecution(validAttempt, {
        status: "rejected",
        validationStatus: "valid",
        failureCode: "INSUFFICIENT_EVIDENCE",
      });
      this.logger.warnEvent("development_event_interpretation_rejected", {
        groupingFingerprint: group.groupKey,
        processingVersion: this.extractionVersion,
        projectId: group.projectId,
        reason: validAttempt.interpretation.reason,
      });
      return { developmentEventId: null, status: "insufficient_evidence" };
    }

    try {
      const eventId = await this.persistEvent(group, prepared, validAttempt);
      this.logger.info("development_event_interpretation_succeeded", {
        developmentEventId: eventId,
        groupingFingerprint: group.groupKey,
        processingVersion: this.extractionVersion,
        projectId: group.projectId,
      });
      return { developmentEventId: eventId, status: "created" };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await this.prisma.developmentEvent.findUnique({
          where: {
            projectId_eventKey_extractionVersion: {
              projectId: group.projectId,
              eventKey: group.groupKey,
              extractionVersion: this.extractionVersion,
            },
          },
          select: { id: true },
        });
        if (raced) {
          await this.completeExecution(validAttempt, {
            developmentEventId: raced.id,
            status: "succeeded",
            validationStatus: "valid",
          });
          return { developmentEventId: raced.id, status: "reused" };
        }
      }
      await this.completeExecution(validAttempt, {
        status: "failed",
        validationStatus: "valid",
        failureCode: "INTERPRETATION_PERSISTENCE_FAILED",
      });
      throw new DevelopmentEventInterpretationError(
        "INTERPRETATION_PERSISTENCE_FAILED",
        true
      );
    }
  }

  private async prepareEvidence(
    group: CandidateEvidenceGroup
  ): Promise<PreparedEvidence> {
    const [commits, pullRequests] = await Promise.all([
      this.prisma.gitHubCommit.findMany({
        where: {
          id: { in: [...group.commitEvidenceIds] },
          connectedRepositoryId: group.connectedRepositoryId,
          connectedRepository: { projectId: group.projectId },
        },
        select: {
          additions: true,
          committedAt: true,
          deletions: true,
          files: { select: { path: true } },
          id: true,
          message: true,
          sha: true,
        },
      }),
      this.prisma.gitHubPullRequest.findMany({
        where: {
          id: { in: [...group.pullRequestEvidenceIds] },
          connectedRepositoryId: group.connectedRepositoryId,
          connectedRepository: { projectId: group.projectId },
        },
        select: {
          additions: true,
          bodySummary: true,
          deletions: true,
          files: { select: { path: true } },
          id: true,
          mergedAt: true,
          providerPullRequestId: true,
          title: true,
        },
      }),
    ]);
    if (
      commits.length !== group.commitEvidenceIds.length ||
      pullRequests.length !== group.pullRequestEvidenceIds.length
    ) {
      throw new DevelopmentEventInterpretationError("EVIDENCE_SCOPE_INVALID");
    }
    const commitMap = new Map(commits.map((commit) => [commit.id, commit]));
    const pullRequestMap = new Map(
      pullRequests.map((pullRequest) => [pullRequest.id, pullRequest])
    );
    const orderedCommits = group.commitEvidenceIds.map((id) => commitMap.get(id));
    const orderedPullRequests = group.pullRequestEvidenceIds.map((id) =>
      pullRequestMap.get(id)
    );
    if (
      orderedCommits.some((commit) => !commit) ||
      orderedPullRequests.some((pullRequest) => !pullRequest)
    ) {
      throw new DevelopmentEventInterpretationError("EVIDENCE_SCOPE_INVALID");
    }

    const safeCommits = orderedCommits as LoadedCommit[];
    const safePullRequests = orderedPullRequests as LoadedPullRequest[];
    const input: DevelopmentEventInterpretationInput = {
      commits: safeCommits.map((commit) => ({
        additions: commit.additions,
        committedAt: commit.committedAt.toISOString(),
        deletions: commit.deletions,
        filePaths: commit.files.map((file) => file.path).sort(),
        id: commit.id,
        message: commit.message,
      })),
      evidenceFrom: group.evidenceFrom.toISOString(),
      evidenceTo: group.evidenceTo.toISOString(),
      groupingReason: group.reason,
      groupingVersion: group.groupingVersion,
      pullRequests: safePullRequests.map((pullRequest) => ({
        additions: pullRequest.additions,
        bodySummary: pullRequest.bodySummary,
        deletions: pullRequest.deletions,
        filePaths: pullRequest.files.map((file) => file.path).sort(),
        id: pullRequest.id,
        mergedAt: pullRequest.mergedAt.toISOString(),
        title: pullRequest.title,
      })),
    };
    return {
      commits: safeCommits,
      input,
      inputFingerprint: fingerprint(JSON.stringify(input)),
      pullRequests: safePullRequests,
    };
  }

  private async runValidatedAttempt(
    group: CandidateEvidenceGroup,
    prepared: PreparedEvidence
  ): Promise<ValidAttempt> {
    let repairErrors: readonly string[] = [];
    for (let localAttempt = 0; localAttempt < 2; localAttempt += 1) {
      const attemptNumber =
        (await this.prisma.aIExecution.count({
          where: {
            projectId: group.projectId,
            stage: "development_event_interpretation",
            inputFingerprint: prepared.inputFingerprint,
            promptVersion: developmentEventPromptVersion,
            modelConfigurationFingerprint: this.modelConfigurationFingerprint,
          },
        })) + 1;
      const startedAt = new Date();
      const execution = await this.prisma.aIExecution.create({
        data: {
          attemptNumber,
          inputFingerprint: prepared.inputFingerprint,
          model: this.modelConfig.model,
          modelConfiguration: openAiInterpretationModelConfiguration,
          modelConfigurationFingerprint: this.modelConfigurationFingerprint,
          projectId: group.projectId,
          promptVersion: developmentEventPromptVersion,
          schemaVersion: developmentEventSchemaVersion,
          stage: "development_event_interpretation",
          startedAt,
        },
        select: { id: true },
      });
      let result: ModelInterpretationResult;
      try {
        result = await this.modelClient.interpret(prepared.input, repairErrors);
      } catch (error) {
        const providerError =
          error instanceof AIProviderError
            ? error
            : new AIProviderError("AI_PROVIDER_TRANSIENT_FAILURE", true);
        await this.prisma.aIExecution.update({
          where: { id: execution.id },
          data: {
            completedAt: new Date(),
            failureCode: providerError.failureCode,
            status: "failed",
          },
        });
        throw new DevelopmentEventInterpretationError(
          providerError.failureCode,
          providerError.retryable
        );
      }
      const parsed = parseDevelopmentEventInterpretation(
        result.outputText,
        new Set(group.commitEvidenceIds),
        new Set(group.pullRequestEvidenceIds)
      );
      if (parsed.value) {
        return {
          executionId: execution.id,
          interpretation: parsed.value,
          result,
          startedAt,
        };
      }
      await this.prisma.aIExecution.update({
        where: { id: execution.id },
        data: {
          completedAt: new Date(),
          failureCode: "AI_OUTPUT_INVALID",
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          status: "rejected",
          validationStatus: "invalid",
        },
      });
      repairErrors = parsed.errors;
    }
    throw new DevelopmentEventInterpretationError("AI_OUTPUT_INVALID");
  }

  private async persistEvent(
    group: CandidateEvidenceGroup,
    prepared: PreparedEvidence,
    attempt: ValidAttempt
  ): Promise<string> {
    if (attempt.interpretation.decision !== "event") {
      throw new DevelopmentEventInterpretationError("AI_OUTPUT_INVALID");
    }
    const output = attempt.interpretation.event;
    const status =
      output.confidence < confidenceAcceptanceThreshold ? "rejected" : "active";

    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.developmentEvent.findUnique({
        where: {
          projectId_eventKey_extractionVersion: {
            projectId: group.projectId,
            eventKey: group.groupKey,
            extractionVersion: this.extractionVersion,
          },
        },
        select: { id: true },
      });
      if (existing) return existing.id;

      const previous =
        status === "active"
          ? await transaction.developmentEvent.findFirst({
              where: {
                projectId: group.projectId,
                eventKey: group.groupKey,
                status: "active",
              },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            })
          : null;
      const created = await transaction.developmentEvent.create({
        data: {
          confidence: output.confidence,
          contentPotentialScore: output.contentPotentialScore,
          eventKey: group.groupKey,
          extractionVersion: this.extractionVersion,
          importanceScore: output.importanceScore,
          inputFingerprint: prepared.inputFingerprint,
          occurredAt: group.evidenceTo,
          projectId: group.projectId,
          relatedFeatureIds: [],
          status,
          summary: output.summary,
          supersedesEventId: previous?.id ?? null,
          technologies: [...output.technologies],
          title: output.title,
          type: output.type,
          commitEvidence: {
            create: prepared.commits.map((commit) => ({
              commitSha: commit.sha,
              gitHubCommitId: commit.id,
            })),
          },
          pullRequestEvidence: {
            create: prepared.pullRequests.map((pullRequest) => ({
              gitHubPullRequestId: pullRequest.id,
              providerPullRequestId: pullRequest.providerPullRequestId,
            })),
          },
        },
        select: { id: true },
      });
      if (previous) {
        await transaction.developmentEvent.update({
          where: { id: previous.id },
          data: { status: "superseded" },
        });
      }
      await transaction.aIExecution.update({
        where: { id: attempt.executionId },
        data: {
          completedAt: new Date(),
          developmentEventId: created.id,
          inputTokens: attempt.result.inputTokens,
          latencyMs: Math.max(0, Date.now() - attempt.startedAt.getTime()),
          outputTokens: attempt.result.outputTokens,
          status: "succeeded",
          validationStatus: "valid",
        },
      });
      return created.id;
    });
  }

  private async completeExecution(
    attempt: ValidAttempt,
    completion: {
      readonly developmentEventId?: string;
      readonly failureCode?: string;
      readonly status: "failed" | "rejected" | "succeeded";
      readonly validationStatus: "invalid" | "pending" | "valid";
    }
  ): Promise<void> {
    await this.prisma.aIExecution.update({
      where: { id: attempt.executionId },
      data: {
        completedAt: new Date(),
        developmentEventId: completion.developmentEventId ?? null,
        failureCode: completion.failureCode ?? null,
        inputTokens: attempt.result.inputTokens,
        latencyMs: Math.max(0, Date.now() - attempt.startedAt.getTime()),
        outputTokens: attempt.result.outputTokens,
        status: completion.status,
        validationStatus: completion.validationStatus,
      },
    });
  }
}
