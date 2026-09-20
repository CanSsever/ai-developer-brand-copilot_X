ALTER TABLE "SyncRun"
ADD COLUMN "workerAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "leaseToken" UUID,
ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(3);

UPDATE "SyncRun"
SET
  "leaseToken" = gen_random_uuid(),
  "leaseExpiresAt" = CURRENT_TIMESTAMP
WHERE "status" = 'running';

ALTER TABLE "SyncRun"
ADD CONSTRAINT "SyncRun_worker_attempt_count_check"
CHECK ("workerAttemptCount" >= 0 AND "workerAttemptCount" <= 3);

ALTER TABLE "SyncRun"
ADD CONSTRAINT "SyncRun_lease_state_check"
CHECK (
  (
    "status" = 'running'
    AND "leaseToken" IS NOT NULL
    AND "leaseExpiresAt" IS NOT NULL
  )
  OR (
    "status" <> 'running'
    AND "leaseToken" IS NULL
    AND "leaseExpiresAt" IS NULL
  )
);

CREATE INDEX "SyncRun_worker_claim_idx"
ON "SyncRun"("status", "leaseExpiresAt", "retryAfterAt", "createdAt")
WHERE "status" IN ('queued', 'running', 'failed_retryable');
