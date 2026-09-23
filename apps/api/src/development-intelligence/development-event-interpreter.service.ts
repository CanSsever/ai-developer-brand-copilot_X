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
import { Prisma } from "../generated/prisma/client";

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

export const developmentEventScoringPolicy = {
  confidenceAcceptanceThreshold: 0.6,
  version: "development-event-scoring-v1",
} as const;

export const developmentEventLifecyclePolicyVersion =
  "development-event-lifecycle-v1";

export function developmentEventInterpretationVersion(versions: {
  readonly lifecyclePolicyVersion: string;
  readonly modelConfigurationFingerprint: string;
  readonly promptVersion: string;
  readonly scoringPolicyVersion: string;
  readonly schemaVersion: string;
}): string {
  return fingerprint(JSON.stringify(versions));
}

type InterpretationFailureCode =
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
  | "EVIDENCE_GROUP_NOT_AVAILABLE"
  | "EVIDENCE_SCOPE_INVALID"
  | "INTERPRETATION_PERSISTENCE_FAILED";

export class DevelopmentEventInterpretationError extends Error {
  constructor(
    readonly failureCode: InterpretationFailureCode,
    readonly retryable = false,
    readonly retryAfterAt: Date | null = null
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
      readonly eventStatus: "active" | "rejected";
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
  readonly repositoryProviderId: bigint;
}

interface PriorCandidateEvent {
  readonly commitEvidence: readonly { readonly commitSha: string; readonly gitHubCommitId: string | null; readonly repositoryProviderId: bigint | null }[];
  readonly createdAt: Date;
  readonly id: string;
  readonly pullRequestEvidence: readonly { readonly gitHubPullRequestId: string | null; readonly providerPullRequestId: bigint; readonly repositoryProviderId: bigint | null }[];
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

function featureIdentity(
  projectId: string,
  repositoryId: string,
  prepared: PreparedEvidence
): string {
  const anchor = prepared.commits[0]
    ? `commit:${prepared.commits[0].sha}`
    : `pr:${prepared.pullRequests[0]?.providerPullRequestId.toString() ?? "missing"}`;
  return fingerprint(
    JSON.stringify({ anchor, projectId, repositoryId, version: "feature-identity-v1" })
  );
}

function candidateIsContained(
  prior: PriorCandidateEvent,
  commitShas: ReadonlySet<string>,
  commitIds: ReadonlySet<string>,
  pullRequestProviderIds: ReadonlySet<bigint>,
  pullRequestIds: ReadonlySet<string>,
  repositoryProviderId: bigint
): boolean {
  const commitMatches = prior.commitEvidence.every((link) =>
    link.repositoryProviderId !== null
      ? link.repositoryProviderId === repositoryProviderId && commitShas.has(link.commitSha)
      : link.gitHubCommitId !== null && commitIds.has(link.gitHubCommitId)
  );
  const pullRequestMatches = prior.pullRequestEvidence.every((link) =>
    link.repositoryProviderId !== null
      ? link.repositoryProviderId === repositoryProviderId &&
        pullRequestProviderIds.has(link.providerPullRequestId)
      : link.gitHubPullRequestId !== null && pullRequestIds.has(link.gitHubPullRequestId)
  );
  return (
    prior.commitEvidence.length + prior.pullRequestEvidence.length > 0 &&
    commitMatches && pullRequestMatches
  );
}

function localDateParts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    day: values.day ?? 1,
    month: values.month ?? 1,
    year: values.year ?? 1970,
  };
}

function zonedMidnightUtc(
  date: { readonly day: number; readonly month: number; readonly year: number },
  timeZone: string
): Date {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  let candidate = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const values = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)])
    );
    const represented = Date.UTC(
      values.year ?? date.year,
      (values.month ?? date.month) - 1,
      values.day ?? date.day,
      values.hour ?? 0,
      values.minute ?? 0,
      values.second ?? 0
    );
    candidate += target - represented;
  }
  return new Date(candidate);
}

function dailyBudgetWindow(now: Date, timeZone: string) {
  const local = localDateParts(now, timeZone);
  const nextCalendarDate = new Date(
    Date.UTC(local.year, local.month - 1, local.day + 1)
  );
  return {
    start: zonedMidnightUtc(local, timeZone),
    end: zonedMidnightUtc(
      {
        day: nextCalendarDate.getUTCDate(),
        month: nextCalendarDate.getUTCMonth() + 1,
        year: nextCalendarDate.getUTCFullYear(),
      },
      timeZone
    ),
  };
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
  private readonly dailyAttemptLimit: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly grouping: EvidenceGroupingService,
    @Inject(DEVELOPMENT_EVENT_MODEL_CLIENT)
    private readonly modelClient: DevelopmentEventModelClient,
    @Inject(OPENAI_INTERPRETATION_CONFIG)
    private readonly modelConfig: OpenAIInterpretationConfig,
    private readonly logger: StructuredLogger
  ) {
    this.dailyAttemptLimit = modelConfig.dailyAttemptLimit ?? 100;
    const configuration = JSON.stringify({
      model: modelConfig.model,
      ...openAiInterpretationModelConfiguration,
    });
    this.modelConfigurationFingerprint = fingerprint(configuration);
    this.extractionVersion = developmentEventInterpretationVersion({
      lifecyclePolicyVersion: developmentEventLifecyclePolicyVersion,
      modelConfigurationFingerprint: this.modelConfigurationFingerprint,
      promptVersion: developmentEventPromptVersion,
      scoringPolicyVersion: developmentEventScoringPolicy.version,
      schemaVersion: developmentEventSchemaVersion,
    });
  }

  getProcessingVersion(): string {
    return this.extractionVersion;
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
        projectId_eventKey_extractionVersion_inputFingerprint: {
          projectId: group.projectId,
          eventKey: group.groupKey,
          extractionVersion: this.extractionVersion,
          inputFingerprint: prepared.inputFingerprint,
        },
      },
      select: { id: true, status: true },
    });
    if (existing) {
      return {
        developmentEventId: existing.id,
        eventStatus: existing.status === "rejected" ? "rejected" : "active",
        status: "reused",
      };
    }
    const priorInsufficientDecision = await this.prisma.aIExecution.findFirst({
      where: {
        projectId: group.projectId,
        stage: "development_event_interpretation",
        inputFingerprint: prepared.inputFingerprint,
        promptVersion: developmentEventPromptVersion,
        schemaVersion: developmentEventSchemaVersion,
        modelConfigurationFingerprint: this.modelConfigurationFingerprint,
        extractionVersion: this.extractionVersion,
        status: "rejected",
        validationStatus: "valid",
        failureCode: "INSUFFICIENT_EVIDENCE",
      },
      select: { id: true },
    });
    if (priorInsufficientDecision) {
      return { developmentEventId: null, status: "insufficient_evidence" };
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
      const persisted = await this.persistEvent(group, prepared, validAttempt);
      this.logger.info("development_event_interpretation_succeeded", {
        developmentEventId: persisted.id,
        groupingFingerprint: group.groupKey,
        processingVersion: this.extractionVersion,
        projectId: group.projectId,
      });
      return {
        developmentEventId: persisted.id,
        eventStatus: persisted.status,
        status: "created",
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await this.prisma.developmentEvent.findUnique({
          where: {
            projectId_eventKey_extractionVersion_inputFingerprint: {
              projectId: group.projectId,
              eventKey: group.groupKey,
              extractionVersion: this.extractionVersion,
              inputFingerprint: prepared.inputFingerprint,
            },
          },
          select: { id: true, status: true },
        });
        if (raced) {
          await this.completeExecution(validAttempt, {
            developmentEventId: raced.id,
            status: "succeeded",
            validationStatus: "valid",
          });
          return {
            developmentEventId: raced.id,
            eventStatus: raced.status === "rejected" ? "rejected" : "active",
            status: "reused",
          };
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
    const [commits, repository, pullRequests] = await Promise.all([
      this.prisma.gitHubCommit.findMany({
        where: {
          id: { in: [...group.commitEvidenceIds] },
          connectedRepositoryId: group.connectedRepositoryId,
          connectedRepository: { projectId: group.projectId },
          orphanedAt: null,
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
      this.prisma.connectedRepository.findFirst({
        where: { id: group.connectedRepositoryId, projectId: group.projectId },
        select: { providerRepositoryId: true },
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
      !repository ||
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
    const activeFeatures = await this.activeFeatureContext(group);
    const input: DevelopmentEventInterpretationInput = {
      activeFeatures,
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
      repositoryProviderId: repository.providerRepositoryId,
    };
  }

  private async activeFeatureContext(
    group: CandidateEvidenceGroup
  ): Promise<DevelopmentEventInterpretationInput["activeFeatures"]> {
    const events = await this.prisma.developmentEvent.findMany({
      where: {
        projectId: group.projectId,
        status: "active",
        type: { in: ["feature_started", "feature_completed"] },
        OR: [
          {
            commitEvidence: {
              some: {
                detachedAt: null,
                role: "supporting",
                gitHubCommit: {
                  connectedRepositoryId: group.connectedRepositoryId,
                  orphanedAt: null,
                },
              },
            },
          },
          {
            pullRequestEvidence: {
              some: {
                detachedAt: null,
                role: "supporting",
                gitHubPullRequest: {
                  connectedRepositoryId: group.connectedRepositoryId,
                },
              },
            },
          },
        ],
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { relatedFeatureIds: true, summary: true, title: true, type: true },
    });
    const completedIds = new Set(
      events
        .filter((event) => event.type === "feature_completed")
        .flatMap((event) => event.relatedFeatureIds)
    );
    const active = new Map<string, { readonly id: string; readonly summary: string; readonly title: string }>();
    for (const event of events) {
      if (event.type !== "feature_started") continue;
      for (const id of event.relatedFeatureIds) {
        if (completedIds.has(id) || active.has(id)) continue;
        active.set(id, {
          id,
          summary: event.summary.slice(0, 400),
          title: event.title.slice(0, 160),
        });
      }
    }
    return [...active.values()].slice(0, 20);
  }

  private async runValidatedAttempt(
    group: CandidateEvidenceGroup,
    prepared: PreparedEvidence
  ): Promise<ValidAttempt> {
    let repairErrors: readonly string[] = [];
    for (let localAttempt = 0; localAttempt < 2; localAttempt += 1) {
      const startedAt = new Date();
      const execution = await this.prisma.$transaction(
        async (transaction) => {
          const project = await transaction.project.findUnique({
            where: { id: group.projectId },
            select: { timezone: true, userId: true },
          });
          if (!project) {
            throw new DevelopmentEventInterpretationError(
              "EVIDENCE_SCOPE_INVALID"
            );
          }
          const budgetWindow = dailyBudgetWindow(
            startedAt,
            project.timezone
          );
          const dailyAttempts = await transaction.aIExecution.count({
            where: {
              project: { userId: project.userId },
              startedAt: {
                gte: budgetWindow.start,
                lt: budgetWindow.end,
              },
            },
          });
          if (dailyAttempts >= this.dailyAttemptLimit) {
            throw new DevelopmentEventInterpretationError(
              "AI_BUDGET_EXHAUSTED",
              true,
              budgetWindow.end
            );
          }
          const attemptNumber =
            (await transaction.aIExecution.count({
              where: {
                projectId: group.projectId,
                stage: "development_event_interpretation",
                inputFingerprint: prepared.inputFingerprint,
                promptVersion: developmentEventPromptVersion,
                modelConfigurationFingerprint:
                  this.modelConfigurationFingerprint,
              },
            })) + 1;
          return transaction.aIExecution.create({
            data: {
              attemptNumber,
              inputFingerprint: prepared.inputFingerprint,
              extractionVersion: this.extractionVersion,
              model: this.modelConfig.model,
              modelConfiguration: openAiInterpretationModelConfiguration,
              modelConfigurationFingerprint:
                this.modelConfigurationFingerprint,
              projectId: group.projectId,
              promptVersion: developmentEventPromptVersion,
              schemaVersion: developmentEventSchemaVersion,
              stage: "development_event_interpretation",
              startedAt,
            },
            select: { id: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
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
          providerError.retryable,
          providerError.retryAfterAt
        );
      }
      const parsed = parseDevelopmentEventInterpretation(
        result.outputText,
        new Set(group.commitEvidenceIds),
        new Set(group.pullRequestEvidenceIds),
        new Set(prepared.input.activeFeatures.map((feature) => feature.id))
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
  ): Promise<{ readonly id: string; readonly status: "active" | "rejected" }> {
    if (attempt.interpretation.decision !== "event") {
      throw new DevelopmentEventInterpretationError("AI_OUTPUT_INVALID");
    }
    const output = attempt.interpretation.event;
    const selectedCommitIds = new Set(output.evidenceRefs.commitIds);
    const selectedPullRequestIds = new Set(output.evidenceRefs.pullRequestIds);
    const status =
      output.confidence < developmentEventScoringPolicy.confidenceAcceptanceThreshold ? "rejected" : "active";
    const relatedFeatureIds =
      output.type === "feature_started" || output.type === "feature_completed"
        ? output.relatedFeatureIds.length > 0
          ? [...output.relatedFeatureIds]
          : [featureIdentity(group.projectId, group.connectedRepositoryId, prepared)]
        : [];

    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.developmentEvent.findUnique({
        where: {
          projectId_eventKey_extractionVersion_inputFingerprint: {
            projectId: group.projectId,
            eventKey: group.groupKey,
            extractionVersion: this.extractionVersion,
            inputFingerprint: prepared.inputFingerprint,
          },
        },
        select: { id: true, status: true },
      });
      if (existing) {
        return {
          id: existing.id,
          status: existing.status === "rejected" ? "rejected" : "active",
        };
      }

      const currentCommitShas = new Set(prepared.commits.map((commit) => commit.sha));
      const currentCommitIds = new Set(prepared.commits.map((commit) => commit.id));
      const currentPullRequestProviderIds = new Set(prepared.pullRequests.map((pullRequest) => pullRequest.providerPullRequestId));
      const currentPullRequestIds = new Set(prepared.pullRequests.map((pullRequest) => pullRequest.id));
      const previousCandidates =
        status === "active"
          ? await transaction.developmentEvent.findMany({
              where: {
                projectId: group.projectId,
                status: "active",
                OR: [
                  {
                    commitEvidence: {
                      some: {
                        OR: [
                          {
                            commitSha: { in: [...currentCommitShas] },
                            repositoryProviderId: prepared.repositoryProviderId,
                          },
                          {
                            gitHubCommitId: { in: [...currentCommitIds] },
                            repositoryProviderId: null,
                          },
                        ],
                      },
                    },
                  },
                  {
                    pullRequestEvidence: {
                      some: {
                        OR: [
                          {
                            providerPullRequestId: {
                              in: [...currentPullRequestProviderIds],
                            },
                            repositoryProviderId: prepared.repositoryProviderId,
                          },
                          {
                            gitHubPullRequestId: { in: [...currentPullRequestIds] },
                            repositoryProviderId: null,
                          },
                        ],
                      },
                    },
                  },
                ],
              },
              orderBy: { createdAt: "desc" },
              select: {
                commitEvidence: {
                  select: {
                    commitSha: true,
                    gitHubCommitId: true,
                    repositoryProviderId: true,
                  },
                },
                createdAt: true,
                id: true,
                pullRequestEvidence: {
                  select: {
                    gitHubPullRequestId: true,
                    providerPullRequestId: true,
                    repositoryProviderId: true,
                  },
                },
              },
            })
          : [];
      const superseded = previousCandidates.filter((candidate) =>
        candidateIsContained(
          candidate,
          currentCommitShas,
          currentCommitIds,
          currentPullRequestProviderIds,
          currentPullRequestIds,
          prepared.repositoryProviderId
        )
      );
      const previous = superseded[0] ?? null;
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
          relatedFeatureIds,
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
              repositoryProviderId: prepared.repositoryProviderId,
              role: selectedCommitIds.has(commit.id) ? "supporting" : "candidate",
            })),
          },
          pullRequestEvidence: {
            create: prepared.pullRequests.map((pullRequest) => ({
              gitHubPullRequestId: pullRequest.id,
              providerPullRequestId: pullRequest.providerPullRequestId,
              repositoryProviderId: prepared.repositoryProviderId,
              role: selectedPullRequestIds.has(pullRequest.id)
                ? "supporting"
                : "candidate",
            })),
          },
        },
        select: { id: true },
      });
      if (superseded.length > 0) {
        await transaction.developmentEvent.updateMany({
          where: {
            id: { in: superseded.map((event) => event.id) },
            status: "active",
          },
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
      return { id: created.id, status };
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
