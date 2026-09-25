import { createHash } from "node:crypto";

import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  opportunityDetectionBounds,
  opportunityDetectionPromptVersion,
  opportunityDetectionSchemaVersion,
  opportunityDetectionValidationVersion,
  parseOpportunityDetectionResult,
  type DetectedOpportunityCandidate,
  type OpportunityDetectionModelClient,
} from "@developer-brand-copilot/ai";
import { Prisma } from "../generated/prisma/client";

import { PrismaService } from "../database/prisma.service";
import {
  OPENAI_INTERPRETATION_CONFIG,
  OPPORTUNITY_DETECTION_MODEL_CLIENT,
  type OpenAIInterpretationConfig,
} from "./development-intelligence.tokens";
import {
  AIProviderError,
  openAiInterpretationModelConfiguration,
} from "./openai-development-event-model.service";
import {
  minimizeOpportunityDetectionInput,
  openAiOpportunityDetectionModelConfiguration,
} from "./openai-opportunity-detection-model.service";
import {
  fingerprintPhase3OpportunityInput,
  phase3OpportunityInputSelectionVersion,
  type CanonicalPhase3OpportunityInput,
} from "./phase3-opportunity-input";
import { Phase3OpportunityInputSelectorService } from "./phase3-opportunity-input-selector.service";
import { developerDayWindow } from "./developer-day";

export const opportunityDetectionVersion = "phase3-opportunity-detector-v1";

const opportunityDetectionModelConfiguration = Object.freeze({
  ...openAiInterpretationModelConfiguration,
  ...openAiOpportunityDetectionModelConfiguration,
  candidateBounds: opportunityDetectionBounds,
});

export type OpportunityDetectionFailureCode =
  | "AI_REQUEST_INVALID"
  | "AI_AUTHENTICATION_FAILURE"
  | "AI_AUTHORIZATION_FAILURE"
  | "AI_MODEL_NOT_FOUND"
  | "AI_RATE_LIMITED"
  | "AI_BUDGET_EXHAUSTED"
  | "AI_OUTPUT_INVALID"
  | "AI_PROVIDER_RESPONSE_INVALID"
  | "AI_PROVIDER_TRANSIENT_FAILURE"
  | "AI_NETWORK_FAILURE"
  | "AI_REFUSAL"
  | "OPPORTUNITY_DETECTION_RESULT_INCOMPLETE"
  | "OPPORTUNITY_DETECTION_PERSISTENCE_FAILED";

export class OpportunityDetectionError extends Error {
  constructor(
    readonly failureCode: OpportunityDetectionFailureCode,
    readonly retryable = false,
    readonly retryAfterAt: Date | null = null
  ) {
    super("Opportunity detection failed");
    this.name = "OpportunityDetectionError";
  }
}

export interface OpportunityDetectionOutcome {
  readonly candidates: readonly DetectedOpportunityCandidate[];
  readonly inputFingerprint: string;
  readonly execution: {
    readonly aiExecutionId: string;
    readonly opportunityDetectionResultId: string;
    readonly model: string;
    readonly modelConfigurationFingerprint: string;
    readonly promptVersion: string;
    readonly schemaVersion: string;
    readonly extractionVersion: string;
    readonly detectorVersion: string;
    readonly reused: boolean;
    readonly initialAttemptCount: number;
    readonly repairAttemptCount: number;
  };
}

export interface OpportunityDetectionProcessingIdentity {
  readonly detectorVersion: string;
  readonly extractionVersion: string;
  readonly inputSelectionVersion: string;
  readonly modelConfigurationFingerprint: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly validationVersion: string;
}

interface StartedAttempt {
  readonly id: string;
  readonly attemptNumber: number;
  readonly startedAt: Date;
}

interface ReusableExecution {
  readonly id: string;
  readonly attemptNumber: number;
  readonly isRepairAttempt: boolean;
  readonly inputFingerprint: string;
  readonly model: string;
  readonly modelConfigurationFingerprint: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly extractionVersion: string | null;
  readonly opportunityDetectionResult: null | {
    readonly id: string;
    readonly projectId: string;
    readonly inputFingerprint: string;
    readonly candidateCount: number;
    readonly candidates: readonly {
      readonly position: number;
      readonly opportunityType: string;
      readonly title: string;
      readonly recommendedFormat: string;
      readonly topicDescriptor: string;
      readonly confidence: number;
      readonly selectedEventCount: number;
      readonly developmentEvents: readonly {
        readonly position: number;
        readonly developmentEventId: string;
      }[];
    }[];
  };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export interface OpportunityDetectionIdentityVersions {
  readonly detectorVersion: string;
  readonly inputSelectionVersion: string;
  readonly modelConfigurationFingerprint: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly validationVersion: string;
}

export function opportunityDetectionExtractionVersion(versions: OpportunityDetectionIdentityVersions): string {
  return fingerprint({
    ...versions,
  });
}

function sameCandidates(
  execution: ReusableExecution,
  projectId: string,
  inputFingerprint: string,
  suppliedEventIds: ReadonlySet<string>
): readonly DetectedOpportunityCandidate[] | null {
  const result = execution.opportunityDetectionResult;
  if (!result || result.projectId !== projectId || result.inputFingerprint !== inputFingerprint ||
    !Number.isInteger(result.candidateCount) || result.candidateCount < 0 || result.candidateCount !== result.candidates.length ||
    result.candidateCount > opportunityDetectionBounds.candidates) return null;

  const candidates: DetectedOpportunityCandidate[] = [];
  for (let position = 0; position < result.candidates.length; position += 1) {
    const candidate = result.candidates[position];
    if (!candidate || candidate.position !== position || candidate.selectedEventCount < 1 ||
      candidate.selectedEventCount > opportunityDetectionBounds.eventIdsPerCandidate ||
      candidate.selectedEventCount !== candidate.developmentEvents.length) return null;
    const eventIds: string[] = [];
    for (let eventPosition = 0; eventPosition < candidate.developmentEvents.length; eventPosition += 1) {
      const event = candidate.developmentEvents[eventPosition];
      if (!event || event.position !== eventPosition || !suppliedEventIds.has(event.developmentEventId)) return null;
      eventIds.push(event.developmentEventId);
    }
    if (new Set(eventIds).size !== eventIds.length) return null;
    candidates.push({
      eventIds,
      opportunityType: candidate.opportunityType as DetectedOpportunityCandidate["opportunityType"],
      title: candidate.title,
      recommendedFormat: candidate.recommendedFormat as DetectedOpportunityCandidate["recommendedFormat"],
      topicDescriptor: candidate.topicDescriptor,
      confidence: candidate.confidence,
    });
  }
  const reparsed = parseOpportunityDetectionResult(JSON.stringify({ candidates }), suppliedEventIds);
  if (!reparsed.value || JSON.stringify(reparsed.value) !== JSON.stringify(candidates)) return null;
  return candidates;
}

@Injectable()
export class OpportunityDetectionService {
  private readonly dailyAttemptLimit: number;
  private readonly modelConfigurationFingerprint: string;
  private readonly extractionVersion: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inputSelector: Phase3OpportunityInputSelectorService,
    @Inject(OPPORTUNITY_DETECTION_MODEL_CLIENT)
    private readonly modelClient: OpportunityDetectionModelClient,
    @Inject(OPENAI_INTERPRETATION_CONFIG)
    private readonly modelConfig: OpenAIInterpretationConfig
  ) {
    this.dailyAttemptLimit = modelConfig.dailyAttemptLimit ?? 100;
    this.modelConfigurationFingerprint = fingerprint({
      model: modelConfig.model,
      ...opportunityDetectionModelConfiguration,
    });
    this.extractionVersion = opportunityDetectionExtractionVersion({
      detectorVersion: opportunityDetectionVersion,
      inputSelectionVersion: phase3OpportunityInputSelectionVersion,
      modelConfigurationFingerprint: this.modelConfigurationFingerprint,
      promptVersion: opportunityDetectionPromptVersion,
      schemaVersion: opportunityDetectionSchemaVersion,
      validationVersion: opportunityDetectionValidationVersion,
    });
  }

  getProcessingIdentity(): OpportunityDetectionProcessingIdentity {
    return {
      detectorVersion: opportunityDetectionVersion,
      extractionVersion: this.extractionVersion,
      inputSelectionVersion: phase3OpportunityInputSelectionVersion,
      modelConfigurationFingerprint: this.modelConfigurationFingerprint,
      promptVersion: opportunityDetectionPromptVersion,
      schemaVersion: opportunityDetectionSchemaVersion,
      validationVersion: opportunityDetectionValidationVersion,
    };
  }

  async detect(
    userId: string,
    projectId: string,
    evaluationBoundary: Date
  ): Promise<OpportunityDetectionOutcome> {
    const selection = await this.inputSelector.select(userId, projectId, evaluationBoundary);
    const input: CanonicalPhase3OpportunityInput = selection.input;
    const inputFingerprint = fingerprintPhase3OpportunityInput(input);
    if (input.projectId !== projectId || inputFingerprint !== selection.inputFingerprint) {
      throw new OpportunityDetectionError("AI_REQUEST_INVALID");
    }

    let promptInput;
    try {
      promptInput = minimizeOpportunityDetectionInput(input);
    } catch {
      throw new OpportunityDetectionError("AI_REQUEST_INVALID");
    }
    const suppliedEventIds = new Set(input.developmentEvents.map((event) => event.developmentEventId));
    if (suppliedEventIds.size !== input.developmentEvents.length) {
      throw new OpportunityDetectionError("AI_REQUEST_INVALID");
    }

    const reusable = await this.findReusableExecution(userId, projectId, input.timezone, inputFingerprint, suppliedEventIds);
    if (reusable) return this.outcome(reusable.candidates, inputFingerprint, reusable.execution, reusable.resultId, true);

    let repairErrors: readonly string[] = [];
    for (let providerAttempt = 0; providerAttempt < 2; providerAttempt += 1) {
      const started = await this.startAttempt(userId, projectId, input, inputFingerprint, providerAttempt === 1);
      let response;
      try {
        response = await this.modelClient.detect(promptInput, repairErrors);
      } catch (error) {
        const providerError = error instanceof AIProviderError
          ? error
          : new AIProviderError("AI_PROVIDER_TRANSIENT_FAILURE", true);
        await this.finishProviderFailure(started, providerError);
        throw new OpportunityDetectionError(providerError.failureCode, providerError.retryable, providerError.retryAfterAt);
      }

      const parsed = parseOpportunityDetectionResult(response.outputText, suppliedEventIds);
      if (parsed.value !== null) {
        try {
          const resultId = await this.persistSuccessfulResult(started, projectId, inputFingerprint, parsed.value, response);
          return this.outcome(parsed.value, inputFingerprint, started, resultId, false, providerAttempt === 1 ? 1 : 0);
        } catch {
          await this.failPersistence(started);
          try {
            const canonical = await this.findReusableExecution(
              userId,
              projectId,
              input.timezone,
              inputFingerprint,
              suppliedEventIds
            );
            if (canonical) {
              return this.outcome(canonical.candidates, inputFingerprint, canonical.execution, canonical.resultId, true);
            }
          } catch {
            // A failed or ambiguous persistence attempt is never returned as a candidate result.
          }
          throw new OpportunityDetectionError("OPPORTUNITY_DETECTION_PERSISTENCE_FAILED");
        }
      }

      await this.finishInvalidOutput(started, response);
      repairErrors = parsed.errors;
    }
    throw new OpportunityDetectionError("AI_OUTPUT_INVALID");
  }

  private async findReusableExecution(
    userId: string,
    projectId: string,
    timezone: string,
    inputFingerprint: string,
    suppliedEventIds: ReadonlySet<string>
  ): Promise<{ readonly candidates: readonly DetectedOpportunityCandidate[]; readonly execution: StartedAttempt & { readonly isRepairAttempt: boolean }; readonly resultId: string } | null> {
    return this.prisma.$transaction(async (transaction) => {
      const project = await transaction.project.findFirst({
        where: { id: projectId, userId },
        select: { timezone: true },
      });
      if (!project) throw new NotFoundException("Project not found");
      if (project.timezone !== timezone) throw new OpportunityDetectionError("AI_REQUEST_INVALID");
      const executions = await transaction.aIExecution.findMany({
        where: {
          projectId,
          project: { userId },
          stage: "opportunity_detection",
          inputFingerprint,
          model: this.modelConfig.model,
          modelConfigurationFingerprint: this.modelConfigurationFingerprint,
          promptVersion: opportunityDetectionPromptVersion,
          schemaVersion: opportunityDetectionSchemaVersion,
          extractionVersion: this.extractionVersion,
          status: "succeeded",
          validationStatus: "valid",
        },
        orderBy: [{ attemptNumber: "desc" }, { id: "desc" }],
        select: {
          id: true,
          attemptNumber: true,
          isRepairAttempt: true,
          inputFingerprint: true,
          model: true,
          modelConfigurationFingerprint: true,
          promptVersion: true,
          schemaVersion: true,
          extractionVersion: true,
          opportunityDetectionResult: {
            select: {
              id: true,
              projectId: true,
              inputFingerprint: true,
              candidateCount: true,
              candidates: {
                orderBy: [{ position: "asc" }, { id: "asc" }],
                select: {
                  position: true,
                  opportunityType: true,
                  title: true,
                  recommendedFormat: true,
                  topicDescriptor: true,
                  confidence: true,
                  selectedEventCount: true,
                  developmentEvents: {
                    orderBy: [{ position: "asc" }, { developmentEventId: "asc" }],
                    select: { position: true, developmentEventId: true },
                  },
                },
              },
            },
          },
        },
      }) as unknown as readonly ReusableExecution[];
      if (executions.length === 0) return null;
      const reusableResults = executions.map((execution) => sameCandidates(execution, projectId, inputFingerprint, suppliedEventIds));
      if (reusableResults.some((result) => result === null)) {
        throw new OpportunityDetectionError("OPPORTUNITY_DETECTION_RESULT_INCOMPLETE");
      }
      const execution = executions[0]!;
      return {
        candidates: reusableResults[0]!,
        execution: { id: execution.id, attemptNumber: execution.attemptNumber, startedAt: new Date(0), isRepairAttempt: execution.isRepairAttempt },
        resultId: execution.opportunityDetectionResult!.id,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async startAttempt(
    userId: string,
    projectId: string,
    input: CanonicalPhase3OpportunityInput,
    inputFingerprint: string,
    isRepairAttempt: boolean
  ): Promise<StartedAttempt> {
    const startedAt = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const project = await transaction.project.findFirst({
        where: { id: projectId, userId },
        select: { timezone: true },
      });
      if (!project) throw new NotFoundException("Project not found");
      if (project.timezone !== input.timezone) throw new OpportunityDetectionError("AI_REQUEST_INVALID");
      const budgetWindow = developerDayWindow(startedAt, project.timezone);
      const dailyAttempts = await transaction.aIExecution.count({
        where: {
          project: { userId },
          startedAt: { gte: budgetWindow.start, lt: budgetWindow.end },
        },
      });
      if (dailyAttempts >= this.dailyAttemptLimit) throw new OpportunityDetectionError("AI_BUDGET_EXHAUSTED");

      // Attempt numbers span schema/extraction revisions because the DB identity index does too.
      const attemptNumber = (await transaction.aIExecution.count({
        where: {
          projectId,
          stage: "opportunity_detection",
          inputFingerprint,
          promptVersion: opportunityDetectionPromptVersion,
          modelConfigurationFingerprint: this.modelConfigurationFingerprint,
        },
      })) + 1;
      const execution = await transaction.aIExecution.create({
        data: {
          attemptNumber,
          isRepairAttempt,
          inputFingerprint,
          extractionVersion: this.extractionVersion,
          model: this.modelConfig.model,
          modelConfiguration: { model: this.modelConfig.model, ...opportunityDetectionModelConfiguration },
          modelConfigurationFingerprint: this.modelConfigurationFingerprint,
          projectId,
          promptVersion: opportunityDetectionPromptVersion,
          schemaVersion: opportunityDetectionSchemaVersion,
          stage: "opportunity_detection",
          startedAt,
        },
        select: { id: true },
      });
      return { id: execution.id, attemptNumber, startedAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async finishProviderFailure(started: StartedAttempt, error: AIProviderError): Promise<void> {
    const completedAt = new Date();
    await this.prisma.aIExecution.update({
      where: { id: started.id },
      data: {
        completedAt,
        latencyMs: Math.max(0, completedAt.getTime() - started.startedAt.getTime()),
        failureCode: error.failureCode,
        status: "failed",
      },
    });
  }

  private async finishInvalidOutput(
    started: StartedAttempt,
    response: { readonly inputTokens: number | null; readonly outputTokens: number | null }
  ): Promise<void> {
    const completedAt = new Date();
    await this.prisma.aIExecution.update({
      where: { id: started.id },
      data: {
        completedAt,
        failureCode: "AI_OUTPUT_INVALID",
        inputTokens: response.inputTokens,
        latencyMs: Math.max(0, completedAt.getTime() - started.startedAt.getTime()),
        outputTokens: response.outputTokens,
        status: "rejected",
        validationStatus: "invalid",
      },
    });
  }

  private async persistSuccessfulResult(
    started: StartedAttempt,
    projectId: string,
    inputFingerprint: string,
    candidates: readonly DetectedOpportunityCandidate[],
    response: { readonly inputTokens: number | null; readonly outputTokens: number | null }
  ): Promise<string> {
    const completedAt = new Date();
    return await this.prisma.$transaction(async (transaction) => {
      await transaction.aIExecution.update({
        where: { id: started.id },
        data: {
          completedAt,
          inputTokens: response.inputTokens,
          latencyMs: Math.max(0, completedAt.getTime() - started.startedAt.getTime()),
          outputTokens: response.outputTokens,
          status: "succeeded",
          validationStatus: "valid",
        },
      });
      const result = await transaction.opportunityDetectionResult.create({
        data: {
          aiExecutionId: started.id,
          projectId,
          inputFingerprint,
          candidateCount: candidates.length,
          candidates: {
            create: candidates.map((candidate, position) => ({
              position,
              opportunityType: candidate.opportunityType,
              title: candidate.title,
              recommendedFormat: candidate.recommendedFormat,
              topicDescriptor: candidate.topicDescriptor,
              confidence: candidate.confidence,
              selectedEventCount: candidate.eventIds.length,
              developmentEvents: {
                create: candidate.eventIds.map((developmentEventId, eventPosition) => ({
                  position: eventPosition,
                  developmentEvent: { connect: { id: developmentEventId } },
                })),
              },
            })),
          },
        },
        select: { id: true },
      });
      return result.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async failPersistence(started: StartedAttempt): Promise<void> {
    const completedAt = new Date();
    await this.prisma.aIExecution.updateMany({
      where: { id: started.id, status: "running" },
      data: {
        completedAt,
        failureCode: "OPPORTUNITY_DETECTION_PERSISTENCE_FAILED",
        latencyMs: Math.max(0, completedAt.getTime() - started.startedAt.getTime()),
        status: "failed",
      },
    });
  }

  private outcome(
    candidates: readonly DetectedOpportunityCandidate[],
    inputFingerprint: string,
    execution: StartedAttempt & { readonly isRepairAttempt?: boolean },
    opportunityDetectionResultId: string,
    reused: boolean,
    repairAttemptCount = execution.isRepairAttempt ? 1 : 0
  ): OpportunityDetectionOutcome {
    return {
      candidates,
      inputFingerprint,
      execution: {
        aiExecutionId: execution.id,
        opportunityDetectionResultId,
        model: this.modelConfig.model,
        modelConfigurationFingerprint: this.modelConfigurationFingerprint,
        promptVersion: opportunityDetectionPromptVersion,
        schemaVersion: opportunityDetectionSchemaVersion,
        extractionVersion: this.extractionVersion,
        detectorVersion: opportunityDetectionVersion,
        reused,
        initialAttemptCount: 1,
        repairAttemptCount,
      },
    };
  }
}
