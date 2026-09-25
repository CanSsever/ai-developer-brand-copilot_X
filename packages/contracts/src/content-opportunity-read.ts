import type {
  ContentOpportunityReasonCode,
  ContentOpportunityReasonEffect,
  ContentOpportunityRecommendedFormat,
  ContentOpportunityType,
} from "./content-opportunity.js";
import type { DevelopmentEventType } from "./development-intelligence.js";

export interface ContentOpportunityListRequest {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ContentOpportunityReasonSignalRead {
  readonly code: ContentOpportunityReasonCode;
  readonly effect: ContentOpportunityReasonEffect;
  readonly value: number | null;
  readonly developmentEventIds: readonly string[];
}

export interface ContentOpportunityDevelopmentEventReference {
  readonly developmentEventId: string;
  readonly type: DevelopmentEventType;
  readonly title: string;
  readonly occurredAt: string;
}

export interface ContentOpportunityCard {
  readonly id: string;
  readonly title: string;
  readonly opportunityType: ContentOpportunityType;
  readonly recommendedFormat: ContentOpportunityRecommendedFormat;
  readonly priorityScore: number;
  readonly noveltyScore: number;
  readonly confidence: number;
  readonly scoringVersion: string;
  readonly createdAt: string;
  readonly reasonSignals: readonly ContentOpportunityReasonSignalRead[];
  readonly developmentEvents: readonly ContentOpportunityDevelopmentEventReference[];
}

export type OpportunityProcessingStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed_retryable"
  | "failed_terminal";

export interface OpportunityProcessingSummary {
  readonly status: OpportunityProcessingStatus;
  readonly statusMessage: string;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly retryAfterAt: string | null;
  readonly processingVersion: string;
  readonly candidateCount: number;
  readonly recommendedCount: number;
  readonly suppressedCount: number;
}

export interface ContentOpportunityListResponse {
  readonly projectId: string;
  readonly items: readonly ContentOpportunityCard[];
  readonly nextCursor: string | null;
  readonly processing: OpportunityProcessingSummary | null;
}
