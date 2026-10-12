export const opportunityFeedbackActions = ["accepted", "dismissed"] as const;
export type OpportunityFeedbackAction = (typeof opportunityFeedbackActions)[number];

export const opportunityFeedbackDismissReasons = [
  "not_relevant",
  "repetitive",
  "too_minor",
  "sensitive",
  "other",
] as const;
export type OpportunityFeedbackDismissReason =
  (typeof opportunityFeedbackDismissReasons)[number];

export interface OpportunityFeedbackMutationRequest {
  readonly action: OpportunityFeedbackAction;
  readonly reason?: OpportunityFeedbackDismissReason | null;
}

export interface OpportunityFeedbackResponse {
  readonly id: string;
  readonly opportunityId: string;
  readonly action: OpportunityFeedbackAction;
  readonly reason: OpportunityFeedbackDismissReason | null;
  readonly createdAt: string;
  readonly isCurrent: boolean;
}

export interface CurrentOpportunityFeedbackRead {
  readonly action: OpportunityFeedbackAction;
  readonly reason: OpportunityFeedbackDismissReason | null;
  readonly createdAt: string;
}
