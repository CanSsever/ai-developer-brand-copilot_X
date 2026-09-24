export const contentOpportunityTypes = [
  "progress_update",
  "feature_showcase",
  "technical_insight",
  "problem_solution",
  "milestone",
  "release",
] as const;

export type ContentOpportunityType = (typeof contentOpportunityTypes)[number];

export const contentOpportunityRecommendedFormats = [
  "short_update",
  "visual_progress",
  "technical_breakdown",
  "milestone_update",
  "release_announcement",
  "multi_point_story",
] as const;

export type ContentOpportunityRecommendedFormat =
  (typeof contentOpportunityRecommendedFormats)[number];

export const contentOpportunityStatuses = [
  "recommended",
  "suppressed",
  "expired",
] as const;

export type ContentOpportunityStatus =
  (typeof contentOpportunityStatuses)[number];

export const positiveContentOpportunityReasonCodes = [
  "high_importance",
  "high_content_potential",
  "fresh_work",
  "novel_topic",
  "feature_completed",
  "release_or_milestone",
  "multi_event_story",
] as const;

export const negativeContentOpportunityReasonCodes = [
  "duplicate_topic",
  "repetition_penalty",
  "low_novelty",
  "low_confidence",
] as const;

export const contentOpportunityReasonCodes = [
  ...positiveContentOpportunityReasonCodes,
  ...negativeContentOpportunityReasonCodes,
] as const;

export type ContentOpportunityReasonCode =
  (typeof contentOpportunityReasonCodes)[number];

export type ContentOpportunityReasonEffect = "positive" | "negative";

export interface ContentOpportunityReasonSignal {
  readonly code: ContentOpportunityReasonCode;
  readonly developmentEventIds: readonly string[];
  readonly effect: ContentOpportunityReasonEffect;
  readonly value: number | null;
}
