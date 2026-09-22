CREATE TYPE "AIExecutionStage" AS ENUM (
  'development_event_interpretation'
);

CREATE TYPE "AIExecutionStatus" AS ENUM (
  'running',
  'succeeded',
  'rejected',
  'failed'
);

CREATE TYPE "AIValidationStatus" AS ENUM (
  'pending',
  'valid',
  'invalid'
);

CREATE TABLE "AIExecution" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "developmentEventId" UUID,
  "stage" "AIExecutionStage" NOT NULL,
  "status" "AIExecutionStatus" NOT NULL DEFAULT 'running',
  "inputFingerprint" VARCHAR(64) NOT NULL,
  "model" VARCHAR(100) NOT NULL,
  "modelConfiguration" JSONB NOT NULL,
  "modelConfigurationFingerprint" VARCHAR(64) NOT NULL,
  "promptVersion" VARCHAR(64) NOT NULL,
  "schemaVersion" VARCHAR(64) NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "validationStatus" "AIValidationStatus" NOT NULL DEFAULT 'pending',
  "failureCode" VARCHAR(64),
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "latencyMs" INTEGER,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AIExecution_input_fingerprint_format_check"
    CHECK ("inputFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AIExecution_model_configuration_fingerprint_format_check"
    CHECK ("modelConfigurationFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AIExecution_versions_nonempty_check"
    CHECK (
      length("model") > 0
      AND length("promptVersion") > 0
      AND length("schemaVersion") > 0
    ),
  CONSTRAINT "AIExecution_attempt_number_check" CHECK ("attemptNumber" >= 1),
  CONSTRAINT "AIExecution_metrics_nonnegative_check"
    CHECK (
      ("latencyMs" IS NULL OR "latencyMs" >= 0)
      AND ("inputTokens" IS NULL OR "inputTokens" >= 0)
      AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
    ),
  CONSTRAINT "AIExecution_completion_check"
    CHECK (
      ("status" = 'running' AND "completedAt" IS NULL)
      OR ("status" <> 'running' AND "completedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "AIExecution_execution_identity_key"
ON "AIExecution"(
  "projectId",
  "stage",
  "inputFingerprint",
  "promptVersion",
  "modelConfigurationFingerprint",
  "attemptNumber"
);

CREATE INDEX "AIExecution_projectId_stage_createdAt_idx"
ON "AIExecution"("projectId", "stage", "createdAt");

CREATE INDEX "AIExecution_developmentEventId_idx"
ON "AIExecution"("developmentEventId");

ALTER TABLE "AIExecution"
ADD CONSTRAINT "AIExecution_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AIExecution"
ADD CONSTRAINT "AIExecution_developmentEventId_fkey"
FOREIGN KEY ("developmentEventId") REFERENCES "DevelopmentEvent"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION public.validate_ai_execution_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW."developmentEventId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public."DevelopmentEvent" event
    WHERE event."id" = NEW."developmentEventId"
      AND event."projectId" = NEW."projectId"
  ) THEN
    RAISE EXCEPTION 'AI execution event must remain within one project'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AIExecution_validate_event"
BEFORE INSERT OR UPDATE OF "projectId", "developmentEventId"
ON public."AIExecution"
FOR EACH ROW EXECUTE FUNCTION public.validate_ai_execution_event();

REVOKE ALL ON TABLE public."AIExecution" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public."AIExecution" TO authenticated;

ALTER TABLE public."AIExecution" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_executions_select_own"
ON public."AIExecution"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."Project"
    WHERE "Project"."id" = "AIExecution"."projectId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
);
