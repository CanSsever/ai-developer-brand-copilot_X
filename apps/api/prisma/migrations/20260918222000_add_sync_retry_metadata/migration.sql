ALTER TABLE "SyncRun"
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "retryAfterAt" TIMESTAMPTZ(3);

ALTER TABLE "SyncRun"
ADD CONSTRAINT "SyncRun_attempt_count_check"
CHECK ("attemptCount" >= 0);

ALTER TABLE "SyncRun"
ADD CONSTRAINT "SyncRun_retry_after_status_check"
CHECK ("retryAfterAt" IS NULL OR "status" = 'failed_retryable');
