CREATE TYPE "IntelligenceRunStatus" AS ENUM (
  'queued',
  'running',
  'succeeded',
  'failed_retryable',
  'failed_terminal'
);

CREATE TYPE "IntelligenceRunTrigger" AS ENUM (
  'sync_completion',
  'manual_reprocess'
);

CREATE TABLE "IntelligenceRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "sourceSyncRunId" UUID NOT NULL,
  "status" "IntelligenceRunStatus" NOT NULL DEFAULT 'queued',
  "trigger" "IntelligenceRunTrigger" NOT NULL,
  "runKey" VARCHAR(64) NOT NULL,
  "processingVersion" VARCHAR(64) NOT NULL,
  "groupingVersion" VARCHAR(64) NOT NULL,
  "interpretationVersion" VARCHAR(64) NOT NULL,
  "projectionVersion" VARCHAR(64) NOT NULL,
  "sourceWindowStart" TIMESTAMPTZ(3) NOT NULL,
  "sourceWindowEnd" TIMESTAMPTZ(3) NOT NULL,
  "queuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "retryAfterAt" TIMESTAMPTZ(3),
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "groupsDiscovered" INTEGER NOT NULL DEFAULT 0,
  "groupsSucceeded" INTEGER NOT NULL DEFAULT 0,
  "groupsRejected" INTEGER NOT NULL DEFAULT 0,
  "groupsFailed" INTEGER NOT NULL DEFAULT 0,
  "failureCode" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntelligenceRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntelligenceRun_run_key_format_check"
    CHECK ("runKey" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "IntelligenceRun_processing_version_format_check"
    CHECK ("processingVersion" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "IntelligenceRun_component_versions_nonempty_check"
    CHECK (
      length("groupingVersion") > 0
      AND length("interpretationVersion") > 0
      AND length("projectionVersion") > 0
    ),
  CONSTRAINT "IntelligenceRun_source_window_check"
    CHECK ("sourceWindowStart" <= "sourceWindowEnd"),
  CONSTRAINT "IntelligenceRun_attempt_count_check"
    CHECK ("attemptCount" >= 0 AND "attemptCount" <= 3),
  CONSTRAINT "IntelligenceRun_counters_check"
    CHECK (
      "groupsDiscovered" >= 0
      AND "groupsSucceeded" >= 0
      AND "groupsRejected" >= 0
      AND "groupsFailed" >= 0
      AND "groupsSucceeded" + "groupsRejected" + "groupsFailed"
        <= "groupsDiscovered"
    ),
  CONSTRAINT "IntelligenceRun_lease_state_check"
    CHECK (
      (
        "status" = 'running'
        AND "leaseToken" IS NOT NULL
        AND "leaseExpiresAt" IS NOT NULL
        AND "startedAt" IS NOT NULL
        AND "finishedAt" IS NULL
      )
      OR (
        "status" <> 'running'
        AND "leaseToken" IS NULL
        AND "leaseExpiresAt" IS NULL
      )
    ),
  CONSTRAINT "IntelligenceRun_completion_state_check"
    CHECK (
      (
        "status" IN ('succeeded', 'failed_terminal')
        AND "finishedAt" IS NOT NULL
      )
      OR (
        "status" NOT IN ('succeeded', 'failed_terminal')
        AND "finishedAt" IS NULL
      )
    )
);

CREATE UNIQUE INDEX "IntelligenceRun_projectId_runKey_key"
ON "IntelligenceRun"("projectId", "runKey");
CREATE UNIQUE INDEX "IntelligenceRun_sourceSyncRunId_processingVersion_key"
ON "IntelligenceRun"("sourceSyncRunId", "processingVersion");
CREATE UNIQUE INDEX "IntelligenceRun_one_active_project_idx"
ON "IntelligenceRun"("projectId")
WHERE "status" IN ('queued', 'running', 'failed_retryable');
CREATE INDEX "IntelligenceRun_projectId_createdAt_idx"
ON "IntelligenceRun"("projectId", "createdAt");
CREATE INDEX "IntelligenceRun_worker_claim_idx"
ON "IntelligenceRun"("status", "retryAfterAt", "leaseExpiresAt", "queuedAt")
WHERE "status" IN ('queued', 'running', 'failed_retryable');

ALTER TABLE "IntelligenceRun"
ADD CONSTRAINT "IntelligenceRun_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntelligenceRun"
ADD CONSTRAINT "IntelligenceRun_sourceSyncRunId_fkey"
FOREIGN KEY ("sourceSyncRunId") REFERENCES "SyncRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION public.validate_intelligence_run_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."SyncRun" sync_run
    INNER JOIN public."ConnectedRepository" repository
      ON repository."id" = sync_run."connectedRepositoryId"
    WHERE sync_run."id" = NEW."sourceSyncRunId"
      AND sync_run."status" = 'succeeded'
      AND repository."projectId" = NEW."projectId"
      AND sync_run."windowStart" = NEW."sourceWindowStart"
      AND sync_run."windowEnd" = NEW."sourceWindowEnd"
  ) THEN
    RAISE EXCEPTION 'intelligence run source must be a succeeded sync from the same project'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "IntelligenceRun_validate_source"
BEFORE INSERT OR UPDATE OF
  "projectId",
  "sourceSyncRunId",
  "sourceWindowStart",
  "sourceWindowEnd"
ON public."IntelligenceRun"
FOR EACH ROW EXECUTE FUNCTION public.validate_intelligence_run_source();

REVOKE ALL ON TABLE public."IntelligenceRun" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public."IntelligenceRun" TO authenticated;
ALTER TABLE public."IntelligenceRun" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intelligence_runs_select_own"
ON public."IntelligenceRun"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."Project"
    WHERE "Project"."id" = "IntelligenceRun"."projectId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
);
