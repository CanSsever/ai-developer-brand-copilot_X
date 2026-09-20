export type SyncRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed_retryable"
  | "failed_terminal"
  | "cancelled";

export interface SyncRunSummary {
  readonly attemptCount: number;
  readonly commitsDiscovered: number;
  readonly commitsInserted: number;
  readonly pullRequestsDiscovered: number;
  readonly pullRequestsInserted: number;
  readonly failureCode: string | null;
  readonly finishedAt: string | null;
  readonly retryAfterAt: string | null;
  readonly startedAt: string | null;
  readonly status: SyncRunStatus;
  readonly syncRunId: string;
}

export interface RepositorySyncSummary {
  readonly lastSuccessfulSyncAt: string | null;
  readonly latestRun: SyncRunSummary | null;
}

export interface StartSyncRunResponse {
  readonly status: "queued";
  readonly syncRunId: string;
}
