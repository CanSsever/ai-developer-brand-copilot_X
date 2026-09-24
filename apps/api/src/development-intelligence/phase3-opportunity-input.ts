import { createHash } from "node:crypto";
import type {
  ContentOpportunityStatus,
  ContentOpportunityType,
  DevelopmentEventType,
} from "@developer-brand-copilot/contracts";

export const phase3OpportunityInputSelectionVersion = "phase3-opportunity-input-v1";

export const phase3OpportunityInputBounds = Object.freeze({
  authoritativeEvents: 100,
  historyOpportunities: 100,
  stateFeatureCollections: 20,
  technologies: 50,
  eventTechnologies: 20,
  relatedFeatureIds: 50,
  historyEventLinks: 100,
  historyLinkedFeatureIds: 100,
  titleCharacters: 300,
  summaryCharacters: 2_000,
  stateTextCharacters: 500,
});

export type Phase3SupportingEvidenceKind = "commit" | "pull_request";

export interface Phase3OpportunityEventInput {
  readonly developmentEventId: string;
  readonly eventKey: string;
  readonly inputFingerprint: string;
  readonly extractionVersion: string;
  readonly type: DevelopmentEventType;
  readonly status: "active";
  readonly title: string;
  readonly summary: string;
  readonly importanceScore: number;
  readonly contentPotentialScore: number;
  readonly confidence: number;
  readonly occurredAt: string;
  readonly technologies: readonly string[];
  readonly relatedFeatureIds: readonly string[];
  readonly supportingEvidenceKinds: readonly Phase3SupportingEvidenceKind[];
  readonly truncated: {
    readonly title: boolean;
    readonly summary: boolean;
    readonly technologies: boolean;
    readonly relatedFeatureIds: boolean;
  };
}

export interface Phase3ProjectFeatureContext {
  readonly developmentEventId: string;
  readonly occurredAt: string;
  readonly type: DevelopmentEventType;
  readonly title: string;
  readonly summary: string;
  readonly technologies: readonly string[];
  readonly relatedFeatureIds: readonly string[];
  readonly truncated: {
    readonly title: boolean;
    readonly summary: boolean;
    readonly technologies: boolean;
    readonly relatedFeatureIds: boolean;
  };
}

export interface Phase3ProjectStateContext {
  readonly id: string;
  readonly version: number;
  readonly sourceFingerprint: string;
  readonly projectionVersion: string;
  readonly lastUpdatedAt: string;
  readonly purpose: string | null;
  readonly targetAudience: string | null;
  readonly currentPhase: string | null;
  readonly technologies: readonly string[];
  readonly activeFeatures: readonly Phase3ProjectFeatureContext[];
  readonly completedFeatures: readonly Phase3ProjectFeatureContext[];
  readonly recentMilestones: readonly Phase3ProjectFeatureContext[];
}

export interface Phase3OpportunityHistoryInput {
  readonly opportunityId: string;
  readonly candidateKey: string;
  readonly inputFingerprint: string;
  readonly scoringVersion: string;
  readonly topicKey: string;
  readonly opportunityType: ContentOpportunityType;
  readonly status: ContentOpportunityStatus;
  readonly shouldPost: boolean;
  readonly isCurrent: boolean;
  readonly createdAt: string;
  readonly createdDeveloperDay: string;
  readonly expiredAt: string | null;
  readonly linkedDevelopmentEvents: readonly {
    readonly developmentEventId: string;
    readonly type: DevelopmentEventType;
  }[];
  readonly linkedFeatureIds: readonly string[];
  readonly truncatedLinkedEvents: boolean;
  readonly truncatedLinkedFeatureIds: boolean;
}

export interface CanonicalPhase3OpportunityInput {
  readonly selectionVersion: string;
  readonly projectId: string;
  readonly timezone: string;
  readonly evaluationBoundary: string;
  readonly developerDay: string;
  readonly projectState: Phase3ProjectStateContext | null;
  readonly developmentEvents: readonly Phase3OpportunityEventInput[];
  readonly opportunityHistory: readonly Phase3OpportunityHistoryInput[];
  readonly truncation: {
    readonly developmentEvents: boolean;
    readonly opportunityHistory: boolean;
    readonly activeFeatures: boolean;
    readonly completedFeatures: boolean;
    readonly recentMilestones: boolean;
    readonly projectTechnologies: boolean;
    readonly stateTextFields: number;
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort(compareText);
}

function compareEventsNewestFirst(left: Phase3OpportunityEventInput, right: Phase3OpportunityEventInput): number {
  return compareText(right.occurredAt, left.occurredAt) || compareText(right.developmentEventId, left.developmentEventId);
}

function compareHistoryNewestFirst(left: Phase3OpportunityHistoryInput, right: Phase3OpportunityHistoryInput): number {
  return compareText(right.createdDeveloperDay, left.createdDeveloperDay) ||
    compareText(right.createdAt, left.createdAt) || compareText(right.opportunityId, left.opportunityId);
}

function compareFeatureNewestFirst(left: Phase3ProjectFeatureContext, right: Phase3ProjectFeatureContext): number {
  return compareText(right.occurredAt, left.occurredAt) || compareText(left.developmentEventId, right.developmentEventId);
}

/** Sort every collection included in the fingerprint; arrays never inherit DB row order. */
export function canonicalizePhase3OpportunityInput(
  input: CanonicalPhase3OpportunityInput
): CanonicalPhase3OpportunityInput {
  const canonicalFeature = (feature: Phase3ProjectFeatureContext): Phase3ProjectFeatureContext => ({
    ...feature,
    technologies: sortedUnique(feature.technologies),
    relatedFeatureIds: sortedUnique(feature.relatedFeatureIds),
  });
  const projectState = input.projectState === null ? null : {
    ...input.projectState,
    technologies: sortedUnique(input.projectState.technologies),
    activeFeatures: input.projectState.activeFeatures.map(canonicalFeature).sort(compareFeatureNewestFirst),
    completedFeatures: input.projectState.completedFeatures.map(canonicalFeature).sort(compareFeatureNewestFirst),
    recentMilestones: input.projectState.recentMilestones.map(canonicalFeature).sort(compareFeatureNewestFirst),
  };
  return {
    ...input,
    projectState,
    developmentEvents: input.developmentEvents.map((event) => ({
      ...event,
      technologies: sortedUnique(event.technologies),
      relatedFeatureIds: sortedUnique(event.relatedFeatureIds),
      supportingEvidenceKinds: [...new Set(event.supportingEvidenceKinds)].sort(compareText),
    })).sort(compareEventsNewestFirst),
    opportunityHistory: input.opportunityHistory.map((opportunity) => ({
      ...opportunity,
      linkedDevelopmentEvents: [...opportunity.linkedDevelopmentEvents].sort((left, right) => compareText(left.developmentEventId, right.developmentEventId)),
      linkedFeatureIds: sortedUnique(opportunity.linkedFeatureIds),
    })).sort(compareHistoryNewestFirst),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)!;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite Phase 3 input value");
    return JSON.stringify(value)!;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw new Error("Unsupported Phase 3 input fingerprint value");
}

export function fingerprintPhase3OpportunityInput(input: CanonicalPhase3OpportunityInput): string {
  const canonical = canonicalizePhase3OpportunityInput(input);
  return createHash("sha256").update(canonicalJson(canonical), "utf8").digest("hex");
}
