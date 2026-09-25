CREATE TYPE "OpportunityRunStatus" AS ENUM (
  'queued',
  'running',
  'succeeded',
  'failed_retryable',
  'failed_terminal'
);

CREATE TYPE "OpportunityRunTrigger" AS ENUM (
  'intelligence_completion',
  'manual_reprocess'
);

CREATE TABLE public."OpportunityRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "sourceIntelligenceRunId" UUID NOT NULL,
  "status" "OpportunityRunStatus" NOT NULL DEFAULT 'queued',
  "trigger" "OpportunityRunTrigger" NOT NULL,
  "runKey" VARCHAR(64) NOT NULL,
  "processingVersion" VARCHAR(64) NOT NULL,
  "orchestrationVersion" VARCHAR(64) NOT NULL,
  "inputSelectionVersion" VARCHAR(64) NOT NULL,
  "detectorVersion" VARCHAR(64) NOT NULL,
  "extractionVersion" VARCHAR(64) NOT NULL,
  "modelConfigurationFingerprint" VARCHAR(64) NOT NULL,
  "scoringVersion" VARCHAR(64) NOT NULL,
  "expectedInputFingerprint" VARCHAR(64) NOT NULL,
  "evaluationBoundary" TIMESTAMPTZ(3) NOT NULL,
  "queuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "retryAfterAt" TIMESTAMPTZ(3),
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "recommendedCount" INTEGER NOT NULL DEFAULT 0,
  "suppressedCount" INTEGER NOT NULL DEFAULT 0,
  "createdOpportunityCount" INTEGER NOT NULL DEFAULT 0,
  "reusedOpportunityCount" INTEGER NOT NULL DEFAULT 0,
  "failureCode" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpportunityRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpportunityRun_run_key_format_check" CHECK ("runKey" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "OpportunityRun_processing_version_format_check" CHECK ("processingVersion" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "OpportunityRun_input_fingerprint_format_check" CHECK ("expectedInputFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "OpportunityRun_model_configuration_fingerprint_check" CHECK ("modelConfigurationFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "OpportunityRun_component_versions_nonempty_check" CHECK (
    length("orchestrationVersion") > 0 AND length("inputSelectionVersion") > 0
    AND length("detectorVersion") > 0 AND length("extractionVersion") > 0
    AND length("scoringVersion") > 0
  ),
  CONSTRAINT "OpportunityRun_attempt_count_check" CHECK ("attemptCount" >= 0 AND "attemptCount" <= 3),
  CONSTRAINT "OpportunityRun_counters_check" CHECK (
    "candidateCount" >= 0 AND "recommendedCount" >= 0 AND "suppressedCount" >= 0
    AND "createdOpportunityCount" >= 0 AND "reusedOpportunityCount" >= 0
    AND "recommendedCount" + "suppressedCount" <= "candidateCount"
    AND "createdOpportunityCount" + "reusedOpportunityCount" <= "candidateCount"
  ),
  CONSTRAINT "OpportunityRun_lease_state_check" CHECK (
    ("status" = 'running' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND "startedAt" IS NOT NULL AND "finishedAt" IS NULL)
    OR ("status" <> 'running' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)
  ),
  CONSTRAINT "OpportunityRun_completion_state_check" CHECK (
    (("status" IN ('succeeded', 'failed_terminal')) AND "finishedAt" IS NOT NULL)
    OR (("status" NOT IN ('succeeded', 'failed_terminal')) AND "finishedAt" IS NULL)
  ),
  CONSTRAINT "OpportunityRun_success_counters_check" CHECK (
    "status" <> 'succeeded' OR (
      "recommendedCount" + "suppressedCount" = "candidateCount"
      AND "createdOpportunityCount" + "reusedOpportunityCount" = "candidateCount"
    )
  ),
  CONSTRAINT "OpportunityRun_projectId_fkey" FOREIGN KEY ("projectId")
    REFERENCES public."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OpportunityRun_sourceIntelligenceRunId_fkey" FOREIGN KEY ("sourceIntelligenceRunId")
    REFERENCES public."IntelligenceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OpportunityRun_projectId_runKey_key"
  ON public."OpportunityRun"("projectId", "runKey");
CREATE UNIQUE INDEX "OpportunityRun_exact_identity_key"
  ON public."OpportunityRun"("projectId", "sourceIntelligenceRunId", "expectedInputFingerprint", "processingVersion");
CREATE UNIQUE INDEX "OpportunityRun_one_active_project_idx"
  ON public."OpportunityRun"("projectId")
  WHERE "status" IN ('queued', 'running', 'failed_retryable');
CREATE INDEX "OpportunityRun_projectId_createdAt_idx"
  ON public."OpportunityRun"("projectId", "createdAt");
CREATE INDEX "OpportunityRun_worker_claim_idx"
  ON public."OpportunityRun"("status", "retryAfterAt", "leaseExpiresAt", "queuedAt")
  WHERE "status" IN ('queued', 'running', 'failed_retryable');

CREATE FUNCTION public.validate_opportunity_run_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."IntelligenceRun" source
    WHERE source."id" = NEW."sourceIntelligenceRunId"
      AND source."projectId" = NEW."projectId"
      AND source."status" = 'succeeded'
      AND source."sourceWindowEnd" = NEW."evaluationBoundary"
  ) THEN
    RAISE EXCEPTION 'opportunity run source must be a succeeded intelligence run from the same project and boundary'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OpportunityRun_validate_source"
BEFORE INSERT OR UPDATE OF "projectId", "sourceIntelligenceRunId", "evaluationBoundary"
ON public."OpportunityRun"
FOR EACH ROW EXECUTE FUNCTION public.validate_opportunity_run_source();

REVOKE ALL ON TABLE public."OpportunityRun" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public."OpportunityRun" TO authenticated;
ALTER TABLE public."OpportunityRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "opportunity_runs_select_own"
ON public."OpportunityRun"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."Project"
    WHERE "Project"."id" = "OpportunityRun"."projectId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
);
