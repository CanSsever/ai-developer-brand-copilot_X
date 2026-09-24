CREATE UNIQUE INDEX "AIExecution_opportunity_canonical_result_key"
ON public."AIExecution" (
  "projectId",
  "stage",
  "inputFingerprint",
  "model",
  "modelConfigurationFingerprint",
  "promptVersion",
  "schemaVersion",
  "extractionVersion"
)
WHERE "stage" = 'opportunity_detection'
  AND "status" = 'succeeded'
  AND "validationStatus" = 'valid';

CREATE OR REPLACE FUNCTION public.assert_opportunity_detection_result_complete(result_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  result_row RECORD;
  execution_row RECORD;
  actual_candidates INTEGER;
  candidate_row RECORD;
  actual_events INTEGER;
  minimum_position INTEGER;
  maximum_position INTEGER;
BEGIN
  SELECT result.* INTO result_row
  FROM public."OpportunityDetectionResult" result
  WHERE result."id" = result_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'opportunity detection result is missing'
      USING ERRCODE = '23514';
  END IF;

  SELECT execution.* INTO execution_row
  FROM public."AIExecution" execution
  WHERE execution."id" = result_row."aiExecutionId";

  IF NOT FOUND
    OR execution_row."stage" <> 'opportunity_detection'
    OR execution_row."status" <> 'succeeded'
    OR execution_row."validationStatus" <> 'valid'
    OR execution_row."extractionVersion" IS NULL
    OR execution_row."projectId" <> result_row."projectId"
    OR execution_row."inputFingerprint" <> result_row."inputFingerprint" THEN
    RAISE EXCEPTION 'opportunity detection result requires its matching successful valid execution'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::INTEGER INTO actual_candidates
  FROM public."OpportunityDetectionCandidate" candidate
  WHERE candidate."resultId" = result_row."id";

  IF actual_candidates <> result_row."candidateCount" THEN
    RAISE EXCEPTION 'opportunity detection result candidate count is incomplete'
      USING ERRCODE = '23514';
  END IF;

  IF actual_candidates > 0 AND (
    (SELECT min(candidate."position") FROM public."OpportunityDetectionCandidate" candidate WHERE candidate."resultId" = result_row."id") <> 0
    OR (SELECT max(candidate."position") FROM public."OpportunityDetectionCandidate" candidate WHERE candidate."resultId" = result_row."id") <> actual_candidates - 1
  ) THEN
    RAISE EXCEPTION 'opportunity detection candidate ordering is incomplete'
      USING ERRCODE = '23514';
  END IF;

  FOR candidate_row IN
    SELECT candidate."id", candidate."selectedEventCount"
    FROM public."OpportunityDetectionCandidate" candidate
    WHERE candidate."resultId" = result_row."id"
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
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_opportunity_detection_result_complete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM public.assert_opportunity_detection_result_complete(NEW."id");
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.validate_opportunity_detection_children_complete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  result_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'OpportunityDetectionCandidate' THEN
    IF TG_OP = 'DELETE' THEN
      result_id := OLD."resultId";
    ELSE
      result_id := NEW."resultId";
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      SELECT candidate."resultId" INTO result_id
      FROM public."OpportunityDetectionCandidate" candidate
      WHERE candidate."id" = OLD."candidateId";
    ELSE
      SELECT candidate."resultId" INTO result_id
      FROM public."OpportunityDetectionCandidate" candidate
      WHERE candidate."id" = NEW."candidateId";
    END IF;
  END IF;

  IF result_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public."OpportunityDetectionResult" result
      WHERE result."id" = result_id
    ) THEN
    PERFORM public.assert_opportunity_detection_result_complete(result_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "OpportunityDetectionCandidate_validate_complete"
AFTER INSERT OR DELETE ON public."OpportunityDetectionCandidate"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_opportunity_detection_children_complete();

CREATE CONSTRAINT TRIGGER "OpportunityDetectionCandidateDevelopmentEvent_validate_complete"
AFTER INSERT OR DELETE ON public."OpportunityDetectionCandidateDevelopmentEvent"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_opportunity_detection_children_complete();

CREATE FUNCTION public.validate_opportunity_detection_success_has_result()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  execution_id UUID;
  execution_row RECORD;
  result_id UUID;
  matching_results INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'AIExecution' THEN
    IF TG_OP = 'DELETE' THEN
      execution_id := OLD."id";
    ELSE
      execution_id := NEW."id";
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      execution_id := OLD."aiExecutionId";
    ELSE
      execution_id := NEW."aiExecutionId";
    END IF;
  END IF;

  SELECT execution.* INTO execution_row
  FROM public."AIExecution" execution
  WHERE execution."id" = execution_id;

  IF NOT FOUND
    OR execution_row."stage" <> 'opportunity_detection'
    OR execution_row."status" <> 'succeeded'
    OR execution_row."validationStatus" <> 'valid' THEN
    RETURN NULL;
  END IF;

  IF execution_row."extractionVersion" IS NULL THEN
    RAISE EXCEPTION 'successful opportunity detection requires an extraction version'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::INTEGER INTO matching_results
  FROM public."OpportunityDetectionResult" result
  WHERE result."aiExecutionId" = execution_row."id"
    AND result."projectId" = execution_row."projectId"
    AND result."inputFingerprint" = execution_row."inputFingerprint";

  IF matching_results <> 1 THEN
    RAISE EXCEPTION 'successful valid opportunity detection requires exactly one matching result'
      USING ERRCODE = '23514';
  END IF;

  SELECT result."id" INTO result_id
  FROM public."OpportunityDetectionResult" result
  WHERE result."aiExecutionId" = execution_row."id"
    AND result."projectId" = execution_row."projectId"
    AND result."inputFingerprint" = execution_row."inputFingerprint"
  LIMIT 1;

  PERFORM public.assert_opportunity_detection_result_complete(result_id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "AIExecution_opportunity_success_requires_result"
AFTER INSERT OR UPDATE ON public."AIExecution"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_opportunity_detection_success_has_result();

CREATE CONSTRAINT TRIGGER "OpportunityDetectionResult_execution_requires_result"
AFTER DELETE ON public."OpportunityDetectionResult"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_opportunity_detection_success_has_result();

CREATE FUNCTION public.prevent_opportunity_detection_semantic_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'opportunity detection semantic history is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "OpportunityDetectionResult_append_only"
BEFORE UPDATE ON public."OpportunityDetectionResult"
FOR EACH ROW EXECUTE FUNCTION public.prevent_opportunity_detection_semantic_update();

CREATE TRIGGER "OpportunityDetectionCandidate_append_only"
BEFORE UPDATE ON public."OpportunityDetectionCandidate"
FOR EACH ROW EXECUTE FUNCTION public.prevent_opportunity_detection_semantic_update();

CREATE TRIGGER "OpportunityDetectionCandidateDevelopmentEvent_append_only"
BEFORE UPDATE ON public."OpportunityDetectionCandidateDevelopmentEvent"
FOR EACH ROW EXECUTE FUNCTION public.prevent_opportunity_detection_semantic_update();

CREATE FUNCTION public.prevent_opportunity_detection_execution_identity_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD."stage" = 'opportunity_detection' AND ROW(
    NEW."projectId",
    NEW."stage",
    NEW."inputFingerprint",
    NEW."model",
    NEW."modelConfiguration",
    NEW."modelConfigurationFingerprint",
    NEW."promptVersion",
    NEW."schemaVersion",
    NEW."extractionVersion"
  ) IS DISTINCT FROM ROW(
    OLD."projectId",
    OLD."stage",
    OLD."inputFingerprint",
    OLD."model",
    OLD."modelConfiguration",
    OLD."modelConfigurationFingerprint",
    OLD."promptVersion",
    OLD."schemaVersion",
    OLD."extractionVersion"
  ) THEN
    RAISE EXCEPTION 'opportunity detection execution identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."stage" = 'opportunity_detection'
    AND OLD."status" = 'succeeded'
    AND OLD."validationStatus" = 'valid'
    AND ROW(NEW."status", NEW."validationStatus") IS DISTINCT FROM ROW(OLD."status", OLD."validationStatus") THEN
    RAISE EXCEPTION 'successful opportunity detection history is append-only'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AIExecution_opportunity_identity_immutable"
BEFORE UPDATE ON public."AIExecution"
FOR EACH ROW EXECUTE FUNCTION public.prevent_opportunity_detection_execution_identity_update();
