CREATE TYPE "ContentOpportunityType" AS ENUM (
  'progress_update',
  'feature_showcase',
  'technical_insight',
  'problem_solution',
  'milestone',
  'release'
);

CREATE TYPE "ContentOpportunityRecommendedFormat" AS ENUM (
  'short_update',
  'visual_progress',
  'technical_breakdown',
  'milestone_update',
  'release_announcement',
  'multi_point_story'
);

CREATE TYPE "ContentOpportunityStatus" AS ENUM (
  'recommended',
  'suppressed',
  'expired'
);

CREATE TYPE "ContentOpportunityReasonCode" AS ENUM (
  'high_importance',
  'high_content_potential',
  'fresh_work',
  'novel_topic',
  'feature_completed',
  'release_or_milestone',
  'multi_event_story',
  'duplicate_topic',
  'repetition_penalty',
  'low_novelty',
  'low_confidence'
);

CREATE TYPE "ContentOpportunityReasonEffect" AS ENUM (
  'positive',
  'negative'
);

CREATE TABLE "ContentOpportunity" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "candidateKey" VARCHAR(64) NOT NULL,
  "inputFingerprint" VARCHAR(64) NOT NULL,
  "opportunityType" "ContentOpportunityType" NOT NULL,
  "topicKey" VARCHAR(160) NOT NULL,
  "title" TEXT NOT NULL,
  "recommendedFormat" "ContentOpportunityRecommendedFormat" NOT NULL,
  "priorityScore" DECIMAL(4,3) NOT NULL,
  "noveltyScore" DECIMAL(4,3) NOT NULL,
  "shouldPost" BOOLEAN NOT NULL,
  "confidence" DECIMAL(4,3) NOT NULL,
  "status" "ContentOpportunityStatus" NOT NULL,
  "scoringVersion" VARCHAR(64) NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "expiredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentOpportunity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentOpportunity_candidate_key_format_check"
    CHECK ("candidateKey" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ContentOpportunity_input_fingerprint_format_check"
    CHECK ("inputFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ContentOpportunity_text_check"
    CHECK (
      length(btrim("title")) > 0
      AND length(btrim("topicKey")) > 0
      AND length(btrim("scoringVersion")) > 0
    ),
  CONSTRAINT "ContentOpportunity_scores_range_check"
    CHECK (
      "priorityScore" BETWEEN 0 AND 1
      AND "noveltyScore" BETWEEN 0 AND 1
      AND "confidence" BETWEEN 0 AND 1
    ),
  CONSTRAINT "ContentOpportunity_lifecycle_check"
    CHECK (
      (
        "status" = 'recommended'
        AND "shouldPost" = true
        AND "isCurrent" = true
        AND "expiredAt" IS NULL
      )
      OR (
        "status" = 'suppressed'
        AND "shouldPost" = false
        AND "isCurrent" = true
        AND "expiredAt" IS NULL
      )
      OR (
        "status" = 'expired'
        AND "isCurrent" = false
        AND "expiredAt" IS NOT NULL
      )
    )
);

CREATE TABLE "ContentOpportunityDevelopmentEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contentOpportunityId" UUID NOT NULL,
  "developmentEventId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentOpportunityDevelopmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentOpportunityReasonSignal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contentOpportunityId" UUID NOT NULL,
  "code" "ContentOpportunityReasonCode" NOT NULL,
  "effect" "ContentOpportunityReasonEffect" NOT NULL,
  "value" DECIMAL(4,3),
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentOpportunityReasonSignal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentOpportunityReasonSignal_value_check"
    CHECK ("value" IS NULL OR "value" BETWEEN 0 AND 1),
  CONSTRAINT "ContentOpportunityReasonSignal_position_check"
    CHECK ("position" BETWEEN 0 AND 10),
  CONSTRAINT "ContentOpportunityReasonSignal_effect_check"
    CHECK (
      (
        "code" IN (
          'high_importance',
          'high_content_potential',
          'fresh_work',
          'novel_topic',
          'feature_completed',
          'release_or_milestone',
          'multi_event_story'
        )
        AND "effect" = 'positive'
      )
      OR (
        "code" IN (
          'duplicate_topic',
          'repetition_penalty',
          'low_novelty',
          'low_confidence'
        )
        AND "effect" = 'negative'
      )
    )
);

CREATE TABLE "ContentOpportunityReasonSignalEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reasonSignalId" UUID NOT NULL,
  "developmentEventId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentOpportunityReasonSignalEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentOpportunity_identity_key"
ON "ContentOpportunity"("projectId", "candidateKey", "inputFingerprint", "scoringVersion");

CREATE UNIQUE INDEX "ContentOpportunity_one_current_candidate_key"
ON "ContentOpportunity"("projectId", "candidateKey")
WHERE "isCurrent";

CREATE INDEX "ContentOpportunity_project_status_priority_idx"
ON "ContentOpportunity"("projectId", "status", "priorityScore");

CREATE INDEX "ContentOpportunity_project_topic_created_idx"
ON "ContentOpportunity"("projectId", "topicKey", "createdAt");

CREATE INDEX "ContentOpportunity_project_created_idx"
ON "ContentOpportunity"("projectId", "createdAt");

CREATE UNIQUE INDEX "ContentOpportunityDevelopmentEvent_opportunity_event_key"
ON "ContentOpportunityDevelopmentEvent"("contentOpportunityId", "developmentEventId");

CREATE INDEX "ContentOpportunityDevelopmentEvent_event_idx"
ON "ContentOpportunityDevelopmentEvent"("developmentEventId");

CREATE UNIQUE INDEX "ContentOpportunityReasonSignal_opportunity_code_key"
ON "ContentOpportunityReasonSignal"("contentOpportunityId", "code");

CREATE UNIQUE INDEX "ContentOpportunityReasonSignal_opportunity_position_key"
ON "ContentOpportunityReasonSignal"("contentOpportunityId", "position");

CREATE INDEX "ContentOpportunityReasonSignal_opportunity_effect_idx"
ON "ContentOpportunityReasonSignal"("contentOpportunityId", "effect");

CREATE UNIQUE INDEX "ContentOpportunityReasonSignalEvent_signal_event_key"
ON "ContentOpportunityReasonSignalEvent"("reasonSignalId", "developmentEventId");

CREATE INDEX "ContentOpportunityReasonSignalEvent_event_idx"
ON "ContentOpportunityReasonSignalEvent"("developmentEventId");

ALTER TABLE "ContentOpportunity"
ADD CONSTRAINT "ContentOpportunity_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentOpportunityDevelopmentEvent"
ADD CONSTRAINT "ContentOpportunityDevelopmentEvent_opportunityId_fkey"
FOREIGN KEY ("contentOpportunityId") REFERENCES "ContentOpportunity"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentOpportunityDevelopmentEvent"
ADD CONSTRAINT "ContentOpportunityDevelopmentEvent_eventId_fkey"
FOREIGN KEY ("developmentEventId") REFERENCES "DevelopmentEvent"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContentOpportunityReasonSignal"
ADD CONSTRAINT "ContentOpportunityReasonSignal_opportunityId_fkey"
FOREIGN KEY ("contentOpportunityId") REFERENCES "ContentOpportunity"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentOpportunityReasonSignalEvent"
ADD CONSTRAINT "ContentOpportunityReasonSignalEvent_signalId_fkey"
FOREIGN KEY ("reasonSignalId") REFERENCES "ContentOpportunityReasonSignal"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentOpportunityReasonSignalEvent"
ADD CONSTRAINT "ContentOpportunityReasonSignalEvent_eventId_fkey"
FOREIGN KEY ("developmentEventId") REFERENCES "DevelopmentEvent"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION public.validate_content_opportunity_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."ContentOpportunity" opportunity
    INNER JOIN public."DevelopmentEvent" event
      ON event."id" = NEW."developmentEventId"
    WHERE opportunity."id" = NEW."contentOpportunityId"
      AND opportunity."projectId" = event."projectId"
  ) THEN
    RAISE EXCEPTION 'content opportunities may only reference development events from the same project'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ContentOpportunityDevelopmentEvent_validate"
BEFORE INSERT OR UPDATE
ON public."ContentOpportunityDevelopmentEvent"
FOR EACH ROW EXECUTE FUNCTION public.validate_content_opportunity_event();

CREATE FUNCTION public.validate_content_opportunity_reason_signal_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."ContentOpportunityReasonSignal" signal
    INNER JOIN public."ContentOpportunityDevelopmentEvent" opportunity_event
      ON opportunity_event."contentOpportunityId" = signal."contentOpportunityId"
    WHERE signal."id" = NEW."reasonSignalId"
      AND opportunity_event."developmentEventId" = NEW."developmentEventId"
  ) THEN
    RAISE EXCEPTION 'reason signals may only reference development events linked to their opportunity'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ContentOpportunityReasonSignalEvent_validate"
BEFORE INSERT OR UPDATE
ON public."ContentOpportunityReasonSignalEvent"
FOR EACH ROW EXECUTE FUNCTION public.validate_content_opportunity_reason_signal_event();

CREATE FUNCTION public.prevent_content_opportunity_semantic_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF ROW(
    NEW."projectId",
    NEW."candidateKey",
    NEW."inputFingerprint",
    NEW."opportunityType",
    NEW."topicKey",
    NEW."title",
    NEW."recommendedFormat",
    NEW."priorityScore",
    NEW."noveltyScore",
    NEW."shouldPost",
    NEW."confidence",
    NEW."scoringVersion",
    NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."projectId",
    OLD."candidateKey",
    OLD."inputFingerprint",
    OLD."opportunityType",
    OLD."topicKey",
    OLD."title",
    OLD."recommendedFormat",
    OLD."priorityScore",
    OLD."noveltyScore",
    OLD."shouldPost",
    OLD."confidence",
    OLD."scoringVersion",
    OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'content opportunity semantic history is append-only'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ContentOpportunity_semantic_append_only"
BEFORE UPDATE ON public."ContentOpportunity"
FOR EACH ROW EXECUTE FUNCTION public.prevent_content_opportunity_semantic_update();

CREATE FUNCTION public.prevent_content_opportunity_child_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'content opportunity provenance and reason history is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "ContentOpportunityDevelopmentEvent_append_only"
BEFORE UPDATE ON public."ContentOpportunityDevelopmentEvent"
FOR EACH ROW EXECUTE FUNCTION public.prevent_content_opportunity_child_update();

CREATE TRIGGER "ContentOpportunityReasonSignal_append_only"
BEFORE UPDATE ON public."ContentOpportunityReasonSignal"
FOR EACH ROW EXECUTE FUNCTION public.prevent_content_opportunity_child_update();

CREATE TRIGGER "ContentOpportunityReasonSignalEvent_append_only"
BEFORE UPDATE ON public."ContentOpportunityReasonSignalEvent"
FOR EACH ROW EXECUTE FUNCTION public.prevent_content_opportunity_child_update();

REVOKE ALL ON TABLE public."ContentOpportunity" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."ContentOpportunityDevelopmentEvent" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."ContentOpportunityReasonSignal" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."ContentOpportunityReasonSignalEvent" FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public."ContentOpportunity" TO authenticated;
GRANT SELECT ON TABLE public."ContentOpportunityDevelopmentEvent" TO authenticated;
GRANT SELECT ON TABLE public."ContentOpportunityReasonSignal" TO authenticated;
GRANT SELECT ON TABLE public."ContentOpportunityReasonSignalEvent" TO authenticated;

ALTER TABLE public."ContentOpportunity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ContentOpportunityDevelopmentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ContentOpportunityReasonSignal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ContentOpportunityReasonSignalEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_opportunities_select_own"
ON public."ContentOpportunity"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."Project"
    WHERE "Project"."id" = "ContentOpportunity"."projectId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "content_opportunity_events_select_own"
ON public."ContentOpportunityDevelopmentEvent"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."ContentOpportunity"
    INNER JOIN public."Project"
      ON "Project"."id" = "ContentOpportunity"."projectId"
    WHERE "ContentOpportunity"."id" = "ContentOpportunityDevelopmentEvent"."contentOpportunityId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "content_opportunity_reason_signals_select_own"
ON public."ContentOpportunityReasonSignal"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."ContentOpportunity"
    INNER JOIN public."Project"
      ON "Project"."id" = "ContentOpportunity"."projectId"
    WHERE "ContentOpportunity"."id" = "ContentOpportunityReasonSignal"."contentOpportunityId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "content_opportunity_reason_signal_events_select_own"
ON public."ContentOpportunityReasonSignalEvent"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."ContentOpportunityReasonSignal"
    INNER JOIN public."ContentOpportunity"
      ON "ContentOpportunity"."id" = "ContentOpportunityReasonSignal"."contentOpportunityId"
    INNER JOIN public."Project"
      ON "Project"."id" = "ContentOpportunity"."projectId"
    WHERE "ContentOpportunityReasonSignal"."id" = "ContentOpportunityReasonSignalEvent"."reasonSignalId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
);
