export const developmentEventTypes = [
  "feature_started",
  "feature_completed",
  "bug_fixed",
  "ui_improved",
  "architecture_decision",
  "testing_milestone",
  "performance_improvement",
  "release",
  "project_milestone",
  "refactor_completed",
] as const;

export type DevelopmentEventType = (typeof developmentEventTypes)[number];

export type DevelopmentEventStatus = "active" | "superseded" | "rejected";

export type IntelligenceProcessingStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed_retryable"
  | "failed_terminal";

export type IntelligenceFailureCode =
  | "temporarily_unavailable"
  | "processing_failed";

export interface ProjectStateEventReference {
  readonly developmentEventId: string;
  readonly occurredAt: string;
  readonly relatedFeatureIds: readonly string[];
  readonly summary: string;
  readonly technologies: readonly string[];
  readonly title: string;
  readonly type: DevelopmentEventType;
}

export interface CurrentProjectStateSummary {
  readonly activeFeatures: readonly ProjectStateEventReference[];
  readonly completedFeatures: readonly ProjectStateEventReference[];
  readonly currentPhase: string | null;
  readonly purpose: string | null;
  readonly recentMilestones: readonly ProjectStateEventReference[];
  readonly targetAudience: string | null;
  readonly technologies: readonly string[];
  readonly updatedAt: string;
  readonly version: number;
  readonly projectionVersion: string;
}

export interface DevelopmentEventSummary {
  readonly confidence: number;
  readonly eventId: string;
  readonly extractionVersion: string;
  readonly occurredAt: string;
  readonly provenance: {
    readonly commitCount: number;
    readonly pullRequestCount: number;
  };
  readonly status: "active";
  readonly summary: string;
  readonly title: string;
  readonly type: DevelopmentEventType;
}

export interface IntelligenceProcessingSummary {
  readonly counters: {
    readonly groupsDiscovered: number;
    readonly groupsFailed: number;
    readonly groupsRejected: number;
    readonly groupsSucceeded: number;
  };
  readonly failureCode: IntelligenceFailureCode | null;
  readonly finishedAt: string | null;
  readonly processingVersion: string;
  readonly queuedAt: string;
  readonly retryAfterAt: string | null;
  readonly startedAt: string | null;
  readonly status: IntelligenceProcessingStatus;
  readonly statusMessage: string;
}

export interface ProjectIntelligenceSummary {
  readonly currentState: CurrentProjectStateSummary | null;
  readonly events: readonly DevelopmentEventSummary[];
  readonly eventLimit: number;
  readonly processing: IntelligenceProcessingSummary | null;
  readonly projectId: string;
}

export type DailyDevelopmentSummaryStatus =
  | "no_activity"
  | "no_meaningful_events"
  | "processing"
  | "failed"
  | "completed";

export interface DailyDevelopmentSummaryItem {
  readonly developmentEventId: string;
  readonly summary: string;
  readonly title: string;
  readonly type: DevelopmentEventType;
}

export interface DailyDevelopmentSummaryResponse {
  readonly confidence: number | null;
  readonly counts: {
    readonly commits: number;
    readonly excludedActivities: number;
    readonly meaningfulEvents: number;
  };
  readonly developerDay: string;
  readonly generationVersion: string;
  readonly items: readonly DailyDevelopmentSummaryItem[];
  readonly projectId: string;
  readonly projectStateVersion: number | null;
  readonly status: DailyDevelopmentSummaryStatus;
  readonly statusMessage: string;
  readonly timezone: string;
  readonly version: number;
}
