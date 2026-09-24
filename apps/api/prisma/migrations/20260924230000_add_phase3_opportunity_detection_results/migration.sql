ALTER TYPE "AIExecutionStage" ADD VALUE 'opportunity_detection';
ALTER TABLE "AIExecution" ADD COLUMN "isRepairAttempt" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "OpportunityDetectionResult" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aiExecutionId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "inputFingerprint" VARCHAR(64) NOT NULL,
  "candidateCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpportunityDetectionResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpportunityDetectionResult_aiExecutionId_key" UNIQUE ("aiExecutionId"),
  CONSTRAINT "OpportunityDetectionResult_fingerprint_check"
    CHECK ("inputFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "OpportunityDetectionResult_candidate_count_check"
    CHECK ("candidateCount" BETWEEN 0 AND 12)
);

CREATE TABLE "OpportunityDetectionCandidate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "resultId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "opportunityType" "ContentOpportunityType" NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "recommendedFormat" "ContentOpportunityRecommendedFormat" NOT NULL,
  "topicDescriptor" VARCHAR(240) NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "selectedEventCount" INTEGER NOT NULL,
  CONSTRAINT "OpportunityDetectionCandidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpportunityDetectionCandidate_result_position_key" UNIQUE ("resultId", "position"),
  CONSTRAINT "OpportunityDetectionCandidate_position_check" CHECK ("position" BETWEEN 0 AND 11),
  CONSTRAINT "OpportunityDetectionCandidate_text_check"
    CHECK (length(btrim("title")) BETWEEN 1 AND 300 AND length(btrim("topicDescriptor")) BETWEEN 1 AND 240),
  CONSTRAINT "OpportunityDetectionCandidate_confidence_check" CHECK ("confidence" BETWEEN 0 AND 1),
  CONSTRAINT "OpportunityDetectionCandidate_event_count_check" CHECK ("selectedEventCount" BETWEEN 1 AND 20)
);

CREATE TABLE "OpportunityDetectionCandidateDevelopmentEvent" (
  "candidateId" UUID NOT NULL,
  "developmentEventId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpportunityDetectionCandidateDevelopmentEvent_pkey" PRIMARY KEY ("candidateId", "developmentEventId"),
  CONSTRAINT "OpportunityDetectionCandidateDevelopmentEvent_candidate_position_key" UNIQUE ("candidateId", "position"),
  CONSTRAINT "OpportunityDetectionCandidateDevelopmentEvent_position_check" CHECK ("position" BETWEEN 0 AND 19)
);

CREATE INDEX "OpportunityDetectionResult_project_input_idx"
ON "OpportunityDetectionResult"("projectId", "inputFingerprint");

CREATE INDEX "OpportunityDetectionCandidateDevelopmentEvent_event_idx"
ON "OpportunityDetectionCandidateDevelopmentEvent"("developmentEventId");

ALTER TABLE "OpportunityDetectionResult"
ADD CONSTRAINT "OpportunityDetectionResult_execution_fkey"
FOREIGN KEY ("aiExecutionId") REFERENCES "AIExecution"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpportunityDetectionResult"
ADD CONSTRAINT "OpportunityDetectionResult_project_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpportunityDetectionCandidate"
ADD CONSTRAINT "OpportunityDetectionCandidate_result_fkey"
FOREIGN KEY ("resultId") REFERENCES "OpportunityDetectionResult"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpportunityDetectionCandidateDevelopmentEvent"
ADD CONSTRAINT "OpportunityDetectionCandidate_candidate_fkey"
FOREIGN KEY ("candidateId") REFERENCES "OpportunityDetectionCandidate"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpportunityDetectionCandidateDevelopmentEvent"
ADD CONSTRAINT "OpportunityDetectionCandidateDevelopmentEvent_event_fkey"
FOREIGN KEY ("developmentEventId") REFERENCES "DevelopmentEvent"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION public.validate_opportunity_detection_result()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
     FROM public."AIExecution" execution
     WHERE execution."id" = NEW."aiExecutionId"
       AND execution."projectId" = NEW."projectId"
       AND execution."inputFingerprint" = NEW."inputFingerprint"
       AND execution."stage" = 'opportunity_detection'
  ) THEN
    RAISE EXCEPTION 'opportunity detection result must match its project-scoped execution'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OpportunityDetectionResult_validate_execution"
BEFORE INSERT OR UPDATE OF "aiExecutionId", "projectId", "inputFingerprint"
ON public."OpportunityDetectionResult"
FOR EACH ROW EXECUTE FUNCTION public.validate_opportunity_detection_result();

CREATE FUNCTION public.validate_opportunity_detection_candidate_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
     FROM public."OpportunityDetectionCandidate" candidate
     INNER JOIN public."OpportunityDetectionResult" result
       ON result."id" = candidate."resultId"
     INNER JOIN public."DevelopmentEvent" event
       ON event."id" = NEW."developmentEventId"
     WHERE candidate."id" = NEW."candidateId"
       AND event."projectId" = result."projectId"
       AND NEW."position" < candidate."selectedEventCount"
  ) THEN
    RAISE EXCEPTION 'opportunity detection provenance must remain within its Project and selected-event bounds'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OpportunityDetectionCandidateDevelopmentEvent_validate"
BEFORE INSERT OR UPDATE
ON public."OpportunityDetectionCandidateDevelopmentEvent"
FOR EACH ROW EXECUTE FUNCTION public.validate_opportunity_detection_candidate_event();

CREATE FUNCTION public.validate_opportunity_detection_result_complete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  actual_candidates INTEGER;
  candidate_row RECORD;
  actual_events INTEGER;
  minimum_position INTEGER;
  maximum_position INTEGER;
BEGIN
  SELECT count(*)::INTEGER INTO actual_candidates
   FROM public."OpportunityDetectionCandidate" candidate
   WHERE candidate."resultId" = NEW."id";

  IF actual_candidates <> NEW."candidateCount" THEN
    RAISE EXCEPTION 'opportunity detection result candidate count is incomplete'
      USING ERRCODE = '23514';
  END IF;

  IF actual_candidates > 0 AND (
     (SELECT min(candidate."position") FROM public."OpportunityDetectionCandidate" candidate WHERE candidate."resultId" = NEW."id") <> 0
     OR (SELECT max(candidate."position") FROM public."OpportunityDetectionCandidate" candidate WHERE candidate."resultId" = NEW."id") <> actual_candidates - 1
  ) THEN
    RAISE EXCEPTION 'opportunity detection candidate ordering is incomplete'
      USING ERRCODE = '23514';
  END IF;

  FOR candidate_row IN
     SELECT candidate."id", candidate."selectedEventCount"
     FROM public."OpportunityDetectionCandidate" candidate
     WHERE candidate."resultId" = NEW."id"
  LOOP
     SELECT count(*)::INTEGER, min(link."position"), max(link."position")
      INTO actual_events, minimum_position, maximum_position
     FROM public."OpportunityDetectionCandidateDevelopmentEvent" link
     WHERE link."candidateId" = candidate_row."id";
    IF actual_events <> candidate_row."selectedEventCount"
      OR minimum_position <> 0
      OR maximum_position <> actual_events - 1 THEN
      RAISE EXCEPTION 'opportunity detection candidate provenance is incomplete'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF NOT EXISTS (
     SELECT 1 FROM public."AIExecution" execution
     WHERE execution."id" = NEW."aiExecutionId"
       AND execution."status" = 'succeeded'
       AND execution."validationStatus" = 'valid'
  ) THEN
    RAISE EXCEPTION 'opportunity detection result requires a successful valid AI execution'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "OpportunityDetectionResult_validate_complete"
AFTER INSERT OR UPDATE
ON public."OpportunityDetectionResult"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_opportunity_detection_result_complete();

REVOKE ALL ON TABLE public."OpportunityDetectionResult" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."OpportunityDetectionCandidate" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."OpportunityDetectionCandidateDevelopmentEvent" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public."OpportunityDetectionResult" TO authenticated;
GRANT SELECT ON TABLE public."OpportunityDetectionCandidate" TO authenticated;
GRANT SELECT ON TABLE public."OpportunityDetectionCandidateDevelopmentEvent" TO authenticated;

ALTER TABLE public."OpportunityDetectionResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OpportunityDetectionCandidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OpportunityDetectionCandidateDevelopmentEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opportunity_detection_results_select_own"
ON public."OpportunityDetectionResult"
FOR SELECT TO authenticated
USING (
  EXISTS (
     SELECT 1 FROM public."Project"
     WHERE "Project"."id" = "OpportunityDetectionResult"."projectId"
       AND "Project"."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "opportunity_detection_candidates_select_own"
ON public."OpportunityDetectionCandidate"
FOR SELECT TO authenticated
USING (
  EXISTS (
     SELECT 1 FROM public."OpportunityDetectionResult" result
     INNER JOIN public."Project" project ON project."id" = result."projectId"
     WHERE result."id" = "OpportunityDetectionCandidate"."resultId"
       AND project."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "opportunity_detection_candidate_events_select_own"
ON public."OpportunityDetectionCandidateDevelopmentEvent"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
     FROM public."OpportunityDetectionCandidate" candidate
     INNER JOIN public."OpportunityDetectionResult" result ON result."id" = candidate."resultId"
     INNER JOIN public."Project" project ON project."id" = result."projectId"
     WHERE candidate."id" = "OpportunityDetectionCandidateDevelopmentEvent"."candidateId"
       AND project."userId" = (SELECT auth.uid())
  )
);
