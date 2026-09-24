import { Injectable, NotFoundException } from "@nestjs/common";
import {
  developmentEventTypes,
  type DevelopmentEventType,
} from "@developer-brand-copilot/contracts";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../database/prisma.service";
import {
  authoritativeDevelopmentEventWhere,
  validSupportingCommitEvidenceWhere,
  validSupportingPullRequestEvidenceWhere,
} from "./authoritative-development-event-where";
import { developerDayStartForDate, developerDayWindow, offsetDeveloperDay } from "./developer-day";
import {
  canonicalizePhase3OpportunityInput,
  fingerprintPhase3OpportunityInput,
  phase3OpportunityInputBounds,
  phase3OpportunityInputSelectionVersion,
  type CanonicalPhase3OpportunityInput,
  type Phase3OpportunityEventInput,
  type Phase3OpportunityHistoryInput,
  type Phase3ProjectFeatureContext,
  type Phase3ProjectStateContext,
  type Phase3SupportingEvidenceKind,
} from "./phase3-opportunity-input";

export const phase3OpportunityHistoryDeveloperDays = 30;
export const PHASE3_OPPORTUNITY_INPUT_TRANSACTION_ISOLATION = Prisma.TransactionIsolationLevel.RepeatableRead;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface Phase3OpportunityInputSelection {
  readonly input: CanonicalPhase3OpportunityInput;
  readonly inputFingerprint: string;
}

interface TruncationState {
  activeFeatures: boolean;
  completedFeatures: boolean;
  recentMilestones: boolean;
  projectTechnologies: boolean;
  stateTextFields: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort(compareText);
}

function boundedString(value: unknown, limit: number, onTruncated?: () => void): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  onTruncated?.();
  return trimmed.slice(0, limit);
}

function numberValue(value: Prisma.Decimal): number {
  const number = Number(value.toString());
  if (!Number.isFinite(number)) throw new Error("Invalid persisted Phase 3 numeric input");
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function featureContexts(value: unknown, limit: number, state: TruncationState, kind: "activeFeatures" | "completedFeatures" | "recentMilestones") {
  if (!Array.isArray(value)) return [] as Phase3ProjectFeatureContext[];
  const mapped: Phase3ProjectFeatureContext[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.developmentEventId !== "string" || typeof item.occurredAt !== "string" ||
      typeof item.type !== "string" || !developmentEventTypes.includes(item.type as DevelopmentEventType)) continue;
    const parsedDate = new Date(item.occurredAt);
    if (!Number.isFinite(parsedDate.getTime())) continue;
    const title = boundedString(item.title, phase3OpportunityInputBounds.titleCharacters, () => { state.stateTextFields += 1; });
    const summary = boundedString(item.summary, phase3OpportunityInputBounds.summaryCharacters, () => { state.stateTextFields += 1; });
    const technologies = uniqueSorted(Array.isArray(item.technologies) ? item.technologies.filter((entry): entry is string => typeof entry === "string") : []);
    const relatedFeatureIds = uniqueSorted(Array.isArray(item.relatedFeatureIds) ? item.relatedFeatureIds.filter((entry): entry is string => typeof entry === "string") : []);
    const technologiesTruncated = technologies.length > phase3OpportunityInputBounds.eventTechnologies;
    const relatedFeatureIdsTruncated = relatedFeatureIds.length > phase3OpportunityInputBounds.relatedFeatureIds;
    technologies.length = Math.min(technologies.length, phase3OpportunityInputBounds.eventTechnologies);
    relatedFeatureIds.length = Math.min(relatedFeatureIds.length, phase3OpportunityInputBounds.relatedFeatureIds);
    mapped.push({
      developmentEventId: item.developmentEventId,
      occurredAt: parsedDate.toISOString(),
      type: item.type as DevelopmentEventType,
      title: title ?? "",
      summary: summary ?? "",
      technologies,
      relatedFeatureIds,
      truncated: {
        title: typeof item.title === "string" && item.title.trim().length > phase3OpportunityInputBounds.titleCharacters,
        summary: typeof item.summary === "string" && item.summary.trim().length > phase3OpportunityInputBounds.summaryCharacters,
        technologies: technologiesTruncated,
        relatedFeatureIds: relatedFeatureIdsTruncated,
      },
    });
  }
  mapped.sort((left, right) => compareText(right.occurredAt, left.occurredAt) || compareText(left.developmentEventId, right.developmentEventId));
  if (mapped.length > limit) state[kind] = true;
  return mapped.slice(0, limit);
}

function projectStateContext(value: {
  id: string;
  version: number;
  sourceFingerprint: string;
  projectionVersion: string;
  lastUpdatedAt: Date;
  purpose: string | null;
  targetAudience: string | null;
  currentPhase: string | null;
  technologies: string[];
  activeFeatures: unknown;
  completedFeatures: unknown;
  recentMilestones: unknown;
} | null, state: TruncationState): Phase3ProjectStateContext | null {
  if (!value) return null;
  const boundedStateText = (text: string | null): string | null => {
    if (text === null) return null;
    return boundedString(text, phase3OpportunityInputBounds.stateTextCharacters, () => { state.stateTextFields += 1; });
  };
  const technologies = uniqueSorted(value.technologies);
  if (technologies.length > phase3OpportunityInputBounds.technologies) state.projectTechnologies = true;
  return {
    id: value.id,
    version: value.version,
    sourceFingerprint: value.sourceFingerprint,
    projectionVersion: value.projectionVersion,
    lastUpdatedAt: value.lastUpdatedAt.toISOString(),
    purpose: boundedStateText(value.purpose),
    targetAudience: boundedStateText(value.targetAudience),
    currentPhase: boundedStateText(value.currentPhase),
    technologies: technologies.slice(0, phase3OpportunityInputBounds.technologies),
    activeFeatures: featureContexts(value.activeFeatures, phase3OpportunityInputBounds.stateFeatureCollections, state, "activeFeatures"),
    completedFeatures: featureContexts(value.completedFeatures, phase3OpportunityInputBounds.stateFeatureCollections, state, "completedFeatures"),
    recentMilestones: featureContexts(value.recentMilestones, phase3OpportunityInputBounds.stateFeatureCollections, state, "recentMilestones"),
  };
}

@Injectable()
export class Phase3OpportunityInputSelectorService {
  constructor(private readonly prisma: PrismaService) {}

  async select(
    userId: string,
    projectId: string,
    evaluationBoundary: Date
  ): Promise<Phase3OpportunityInputSelection> {
    if (!uuidPattern.test(projectId)) throw new NotFoundException("Project not found");
    if (!(evaluationBoundary instanceof Date) || !Number.isFinite(evaluationBoundary.getTime())) {
      throw new RangeError("Invalid Phase 3 evaluation boundary");
    }
    const evaluationInstant = new Date(evaluationBoundary.getTime());
    return this.prisma.$transaction(async (transaction) => {
      const project = await transaction.project.findFirst({
        where: { id: projectId, userId },
        select: {
          id: true,
          timezone: true,
          projectState: {
            select: {
              activeFeatures: true,
              completedFeatures: true,
              currentPhase: true,
              id: true,
              lastUpdatedAt: true,
              projectionVersion: true,
              purpose: true,
              recentMilestones: true,
              sourceFingerprint: true,
              targetAudience: true,
              technologies: true,
              version: true,
            },
          },
        },
      });
      if (!project) throw new NotFoundException("Project not found");

      const evaluationDay = developerDayWindow(evaluationInstant, project.timezone);
      const historyStartDay = offsetDeveloperDay(evaluationDay.dateString, -phase3OpportunityHistoryDeveloperDays);
      const historyStart = developerDayStartForDate(historyStartDay, project.timezone);

      const events = await transaction.developmentEvent.findMany({
        where: {
          ...authoritativeDevelopmentEventWhere(project.id),
          confidence: { gte: new Prisma.Decimal("0.600") },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: phase3OpportunityInputBounds.authoritativeEvents + 1,
        select: {
          commitEvidence: { where: validSupportingCommitEvidenceWhere, take: 1, select: { id: true } },
          pullRequestEvidence: { where: validSupportingPullRequestEvidenceWhere, take: 1, select: { id: true } },
          confidence: true,
          contentPotentialScore: true,
          eventKey: true,
          extractionVersion: true,
          id: true,
          importanceScore: true,
          inputFingerprint: true,
          occurredAt: true,
          relatedFeatureIds: true,
          status: true,
          summary: true,
          technologies: true,
          title: true,
          type: true,
        },
      });

      const history = await transaction.contentOpportunity.findMany({
        where: {
          projectId: project.id,
          createdAt: { gte: historyStart, lt: evaluationDay.start },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: phase3OpportunityInputBounds.historyOpportunities + 1,
        select: {
          candidateKey: true,
          createdAt: true,
          expiredAt: true,
          id: true,
          inputFingerprint: true,
          isCurrent: true,
          opportunityType: true,
          scoringVersion: true,
          shouldPost: true,
          status: true,
          topicKey: true,
          developmentEvents: {
            where: { developmentEvent: { projectId: project.id } },
            orderBy: { developmentEventId: "asc" },
            take: phase3OpportunityInputBounds.historyEventLinks + 1,
            select: {
              developmentEventId: true,
              developmentEvent: { select: { relatedFeatureIds: true, type: true } },
            },
          },
        },
      });

      const truncation: TruncationState = {
        activeFeatures: false,
        completedFeatures: false,
        recentMilestones: false,
        projectTechnologies: false,
        stateTextFields: 0,
      };
      const selectedEvents = events.slice(0, phase3OpportunityInputBounds.authoritativeEvents).map((event): Phase3OpportunityEventInput => {
        const title = boundedString(event.title, phase3OpportunityInputBounds.titleCharacters) ?? "";
        const summary = boundedString(event.summary, phase3OpportunityInputBounds.summaryCharacters) ?? "";
        const technologies = uniqueSorted(event.technologies);
        const relatedFeatureIds = uniqueSorted(event.relatedFeatureIds);
        const kinds: Phase3SupportingEvidenceKind[] = [];
        if (event.commitEvidence.length > 0) kinds.push("commit");
        if (event.pullRequestEvidence.length > 0) kinds.push("pull_request");
        return {
          developmentEventId: event.id,
          eventKey: event.eventKey,
          inputFingerprint: event.inputFingerprint,
          extractionVersion: event.extractionVersion,
          type: event.type,
          status: "active",
          title,
          summary,
          importanceScore: numberValue(event.importanceScore),
          contentPotentialScore: numberValue(event.contentPotentialScore),
          confidence: numberValue(event.confidence),
          occurredAt: event.occurredAt.toISOString(),
          technologies: technologies.slice(0, phase3OpportunityInputBounds.eventTechnologies),
          relatedFeatureIds: relatedFeatureIds.slice(0, phase3OpportunityInputBounds.relatedFeatureIds),
          supportingEvidenceKinds: kinds,
          truncated: {
            title: event.title.trim().length > phase3OpportunityInputBounds.titleCharacters,
            summary: event.summary.trim().length > phase3OpportunityInputBounds.summaryCharacters,
            technologies: technologies.length > phase3OpportunityInputBounds.eventTechnologies,
            relatedFeatureIds: relatedFeatureIds.length > phase3OpportunityInputBounds.relatedFeatureIds,
          },
        };
      });

      const selectedHistory = history.slice(0, phase3OpportunityInputBounds.historyOpportunities).map((opportunity): Phase3OpportunityHistoryInput => {
        const links = opportunity.developmentEvents.slice(0, phase3OpportunityInputBounds.historyEventLinks);
        const linkedFeatureIds = uniqueSorted(links.flatMap((link) => link.developmentEvent.relatedFeatureIds));
        return {
          opportunityId: opportunity.id,
          candidateKey: opportunity.candidateKey,
          inputFingerprint: opportunity.inputFingerprint,
          scoringVersion: opportunity.scoringVersion,
          topicKey: opportunity.topicKey,
          opportunityType: opportunity.opportunityType,
          status: opportunity.status,
          shouldPost: opportunity.shouldPost,
          isCurrent: opportunity.isCurrent,
          createdAt: opportunity.createdAt.toISOString(),
          createdDeveloperDay: developerDayWindow(opportunity.createdAt, project.timezone).dateString,
          expiredAt: opportunity.expiredAt?.toISOString() ?? null,
          linkedDevelopmentEvents: links.map((link) => ({ developmentEventId: link.developmentEventId, type: link.developmentEvent.type })),
          linkedFeatureIds: linkedFeatureIds.slice(0, phase3OpportunityInputBounds.historyLinkedFeatureIds),
          truncatedLinkedEvents: opportunity.developmentEvents.length > phase3OpportunityInputBounds.historyEventLinks,
          truncatedLinkedFeatureIds: linkedFeatureIds.length > phase3OpportunityInputBounds.historyLinkedFeatureIds,
        };
      });

      const state = projectStateContext(project.projectState, truncation);
      const input = canonicalizePhase3OpportunityInput({
        selectionVersion: phase3OpportunityInputSelectionVersion,
        projectId: project.id,
        timezone: project.timezone,
        evaluationBoundary: evaluationInstant.toISOString(),
        developerDay: evaluationDay.dateString,
        projectState: state,
        developmentEvents: selectedEvents,
        opportunityHistory: selectedHistory,
        truncation: {
          developmentEvents: events.length > phase3OpportunityInputBounds.authoritativeEvents,
          opportunityHistory: history.length > phase3OpportunityInputBounds.historyOpportunities,
          activeFeatures: truncation.activeFeatures,
          completedFeatures: truncation.completedFeatures,
          recentMilestones: truncation.recentMilestones,
          projectTechnologies: truncation.projectTechnologies,
          stateTextFields: truncation.stateTextFields,
        },
      });
      return { input, inputFingerprint: fingerprintPhase3OpportunityInput(input) };
    }, { isolationLevel: PHASE3_OPPORTUNITY_INPUT_TRANSACTION_ISOLATION });
  }
}
