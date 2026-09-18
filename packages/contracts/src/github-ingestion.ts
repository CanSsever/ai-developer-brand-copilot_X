export type SyncRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed_retryable"
  | "failed_terminal"
  | "cancelled";
