CREATE TYPE "DailyDevelopmentSummaryStatus" AS ENUM ('no_activity', 'no_meaningful_events', 'processing', 'failed', 'completed');

CREATE TABLE "DailyDevelopmentSummary" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "developerDay" DATE NOT NULL,
  "timezone" TEXT NOT NULL,
  "inputFingerprint" VARCHAR(64) NOT NULL,
  "generationVersion" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "status" "DailyDevelopmentSummaryStatus" NOT NULL,
  "commitCount" INTEGER NOT NULL,
  "eventCount" INTEGER NOT NULL,
  "excludedActivityCount" INTEGER NOT NULL,
  "confidence" DECIMAL(4,3),
  "summaryItems" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "projectStateVersion" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyDevelopmentSummary_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DailyDevelopmentSummary_version_check" CHECK ("version" >= 1),
  CONSTRAINT "DailyDevelopmentSummary_counts_check" CHECK ("commitCount" >= 0 AND "eventCount" >= 0 AND "excludedActivityCount" >= 0),
  CONSTRAINT "DailyDevelopmentSummary_confidence_check" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1),
  CONSTRAINT "DailyDevelopmentSummary_fingerprint_check" CHECK ("inputFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DailyDevelopmentSummary_items_check" CHECK (jsonb_typeof("summaryItems") = 'array')
);

CREATE TABLE "DailyDevelopmentSummaryEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "dailyDevelopmentSummaryId" UUID NOT NULL,
  "developmentEventId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyDevelopmentSummaryEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyDevelopmentSummary_project_day_input_key" ON "DailyDevelopmentSummary"("projectId", "developerDay", "timezone", "inputFingerprint", "generationVersion");
CREATE UNIQUE INDEX "DailyDevelopmentSummary_project_day_version_key" ON "DailyDevelopmentSummary"("projectId", "developerDay", "timezone", "version");
CREATE UNIQUE INDEX "DailyDevelopmentSummary_one_current_key" ON "DailyDevelopmentSummary"("projectId", "developerDay", "timezone") WHERE "isCurrent";
CREATE INDEX "DailyDevelopmentSummary_project_day_current_idx" ON "DailyDevelopmentSummary"("projectId", "developerDay", "timezone", "isCurrent");
CREATE UNIQUE INDEX "DailyDevelopmentSummaryEvent_summary_event_key" ON "DailyDevelopmentSummaryEvent"("dailyDevelopmentSummaryId", "developmentEventId");
CREATE INDEX "DailyDevelopmentSummaryEvent_event_idx" ON "DailyDevelopmentSummaryEvent"("developmentEventId");

ALTER TABLE "DailyDevelopmentSummary" ADD CONSTRAINT "DailyDevelopmentSummary_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyDevelopmentSummaryEvent" ADD CONSTRAINT "DailyDevelopmentSummaryEvent_summaryId_fkey" FOREIGN KEY ("dailyDevelopmentSummaryId") REFERENCES "DailyDevelopmentSummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyDevelopmentSummaryEvent" ADD CONSTRAINT "DailyDevelopmentSummaryEvent_eventId_fkey" FOREIGN KEY ("developmentEventId") REFERENCES "DevelopmentEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION public.validate_daily_summary_event() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."DailyDevelopmentSummary" summary
    INNER JOIN public."DevelopmentEvent" event ON event."id" = NEW."developmentEventId"
    WHERE summary."id" = NEW."dailyDevelopmentSummaryId" AND summary."projectId" = event."projectId"
  ) THEN
    RAISE EXCEPTION 'daily summary events must remain within one project' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "DailyDevelopmentSummaryEvent_validate" BEFORE INSERT OR UPDATE ON public."DailyDevelopmentSummaryEvent" FOR EACH ROW EXECUTE FUNCTION public.validate_daily_summary_event();

CREATE FUNCTION public.prevent_daily_summary_semantic_update() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF ROW(NEW."projectId", NEW."developerDay", NEW."timezone", NEW."inputFingerprint", NEW."generationVersion", NEW."version", NEW."status", NEW."commitCount", NEW."eventCount", NEW."excludedActivityCount", NEW."confidence", NEW."summaryItems", NEW."projectStateVersion")
    IS DISTINCT FROM ROW(OLD."projectId", OLD."developerDay", OLD."timezone", OLD."inputFingerprint", OLD."generationVersion", OLD."version", OLD."status", OLD."commitCount", OLD."eventCount", OLD."excludedActivityCount", OLD."confidence", OLD."summaryItems", OLD."projectStateVersion")
  THEN RAISE EXCEPTION 'daily summary semantic history is append-only' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "DailyDevelopmentSummary_semantic_append_only" BEFORE UPDATE ON public."DailyDevelopmentSummary" FOR EACH ROW EXECUTE FUNCTION public.prevent_daily_summary_semantic_update();

REVOKE ALL ON TABLE public."DailyDevelopmentSummary" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."DailyDevelopmentSummaryEvent" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public."DailyDevelopmentSummary" TO authenticated;
GRANT SELECT ON TABLE public."DailyDevelopmentSummaryEvent" TO authenticated;
ALTER TABLE public."DailyDevelopmentSummary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DailyDevelopmentSummaryEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_development_summaries_select_own" ON public."DailyDevelopmentSummary" FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public."Project" WHERE "Project"."id" = "DailyDevelopmentSummary"."projectId" AND "Project"."userId" = (SELECT auth.uid())
));
CREATE POLICY "daily_development_summary_events_select_own" ON public."DailyDevelopmentSummaryEvent" FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public."DailyDevelopmentSummary" INNER JOIN public."Project" ON "Project"."id" = "DailyDevelopmentSummary"."projectId"
  WHERE "DailyDevelopmentSummary"."id" = "DailyDevelopmentSummaryEvent"."dailyDevelopmentSummaryId" AND "Project"."userId" = (SELECT auth.uid())
));
