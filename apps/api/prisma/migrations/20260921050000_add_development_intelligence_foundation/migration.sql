CREATE TYPE "DevelopmentEventType" AS ENUM (
  'feature_started',
  'feature_completed',
  'bug_fixed',
  'ui_improved',
  'architecture_decision',
  'testing_milestone',
  'performance_improvement',
  'release',
  'project_milestone',
  'refactor_completed'
);

CREATE TYPE "DevelopmentEventStatus" AS ENUM (
  'active',
  'superseded',
  'rejected'
);

CREATE TABLE "DevelopmentEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "eventKey" VARCHAR(64) NOT NULL,
  "inputFingerprint" VARCHAR(64) NOT NULL,
  "extractionVersion" VARCHAR(64) NOT NULL,
  "type" "DevelopmentEventType" NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "importanceScore" DECIMAL(4,3) NOT NULL,
  "contentPotentialScore" DECIMAL(4,3) NOT NULL,
  "confidence" DECIMAL(4,3) NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "technologies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "relatedFeatureIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "DevelopmentEventStatus" NOT NULL DEFAULT 'active',
  "supersedesEventId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DevelopmentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DevelopmentEvent_event_key_format_check"
    CHECK ("eventKey" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DevelopmentEvent_input_fingerprint_format_check"
    CHECK ("inputFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DevelopmentEvent_extraction_version_nonempty_check"
    CHECK (length("extractionVersion") > 0),
  CONSTRAINT "DevelopmentEvent_text_nonempty_check"
    CHECK (length("title") > 0 AND length("summary") > 0),
  CONSTRAINT "DevelopmentEvent_scores_range_check"
    CHECK (
      "importanceScore" BETWEEN 0 AND 1
      AND "contentPotentialScore" BETWEEN 0 AND 1
      AND "confidence" BETWEEN 0 AND 1
    ),
  CONSTRAINT "DevelopmentEvent_not_self_superseding_check"
    CHECK ("supersedesEventId" IS NULL OR "supersedesEventId" <> "id")
);

CREATE TABLE "DevelopmentEventCommitEvidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "developmentEventId" UUID NOT NULL,
  "gitHubCommitId" UUID,
  "commitSha" VARCHAR(64) NOT NULL,
  "detachedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DevelopmentEventCommitEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DevelopmentEventCommitEvidence_sha_format_check"
    CHECK ("commitSha" ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  CONSTRAINT "DevelopmentEventCommitEvidence_attachment_check"
    CHECK (
      ("gitHubCommitId" IS NOT NULL AND "detachedAt" IS NULL)
      OR ("gitHubCommitId" IS NULL AND "detachedAt" IS NOT NULL)
    )
);

CREATE TABLE "DevelopmentEventPullRequestEvidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "developmentEventId" UUID NOT NULL,
  "gitHubPullRequestId" UUID,
  "providerPullRequestId" BIGINT NOT NULL,
  "detachedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DevelopmentEventPullRequestEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DevelopmentEventPullRequestEvidence_provider_id_check"
    CHECK ("providerPullRequestId" > 0),
  CONSTRAINT "DevelopmentEventPullRequestEvidence_attachment_check"
    CHECK (
      ("gitHubPullRequestId" IS NOT NULL AND "detachedAt" IS NULL)
      OR ("gitHubPullRequestId" IS NULL AND "detachedAt" IS NOT NULL)
    )
);

CREATE TABLE "ProjectState" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "purpose" TEXT,
  "targetAudience" TEXT,
  "technologies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "currentPhase" TEXT,
  "activeFeatures" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "completedFeatures" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "recentMilestones" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "sourceFingerprint" VARCHAR(64) NOT NULL,
  "projectionVersion" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL,
  "lastUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectState_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ProjectState_source_fingerprint_format_check"
    CHECK ("sourceFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ProjectState_projection_version_nonempty_check"
    CHECK (length("projectionVersion") > 0),
  CONSTRAINT "ProjectState_structured_arrays_check"
    CHECK (
      jsonb_typeof("activeFeatures") = 'array'
      AND jsonb_typeof("completedFeatures") = 'array'
      AND jsonb_typeof("recentMilestones") = 'array'
    )
);

CREATE TABLE "ProjectStateVersion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectStateId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "purpose" TEXT,
  "targetAudience" TEXT,
  "technologies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "currentPhase" TEXT,
  "activeFeatures" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "completedFeatures" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "recentMilestones" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "sourceFingerprint" VARCHAR(64) NOT NULL,
  "projectionVersion" VARCHAR(64) NOT NULL,
  "lastUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectStateVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectStateVersion_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ProjectStateVersion_source_fingerprint_format_check"
    CHECK ("sourceFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ProjectStateVersion_projection_version_nonempty_check"
    CHECK (length("projectionVersion") > 0),
  CONSTRAINT "ProjectStateVersion_structured_arrays_check"
    CHECK (
      jsonb_typeof("activeFeatures") = 'array'
      AND jsonb_typeof("completedFeatures") = 'array'
      AND jsonb_typeof("recentMilestones") = 'array'
    )
);

CREATE TABLE "ProjectStateVersionEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectStateVersionId" UUID NOT NULL,
  "developmentEventId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectStateVersionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DevelopmentEvent_projectId_eventKey_extractionVersion_key"
ON "DevelopmentEvent"("projectId", "eventKey", "extractionVersion");
CREATE UNIQUE INDEX "DevelopmentEvent_supersedesEventId_key"
ON "DevelopmentEvent"("supersedesEventId");
CREATE INDEX "DevelopmentEvent_projectId_occurredAt_idx"
ON "DevelopmentEvent"("projectId", "occurredAt");
CREATE INDEX "DevelopmentEvent_projectId_status_idx"
ON "DevelopmentEvent"("projectId", "status");
CREATE INDEX "DevelopmentEvent_projectId_inputFingerprint_idx"
ON "DevelopmentEvent"("projectId", "inputFingerprint");

CREATE UNIQUE INDEX "DevelopmentEventCommitEvidence_developmentEventId_commitSha_key"
ON "DevelopmentEventCommitEvidence"("developmentEventId", "commitSha");
CREATE UNIQUE INDEX "DevelopmentEventCommitEvidence_developmentEventId_gitHubCommitId_key"
ON "DevelopmentEventCommitEvidence"("developmentEventId", "gitHubCommitId");
CREATE INDEX "DevelopmentEventCommitEvidence_gitHubCommitId_idx"
ON "DevelopmentEventCommitEvidence"("gitHubCommitId");

CREATE UNIQUE INDEX "DevelopmentEventPullRequestEvidence_developmentEventId_providerPullRequestId_key"
ON "DevelopmentEventPullRequestEvidence"("developmentEventId", "providerPullRequestId");
CREATE UNIQUE INDEX "DevelopmentEventPullRequestEvidence_developmentEventId_gitHubPullRequestId_key"
ON "DevelopmentEventPullRequestEvidence"("developmentEventId", "gitHubPullRequestId");
CREATE INDEX "DevelopmentEventPullRequestEvidence_gitHubPullRequestId_idx"
ON "DevelopmentEventPullRequestEvidence"("gitHubPullRequestId");

CREATE UNIQUE INDEX "ProjectState_projectId_key" ON "ProjectState"("projectId");
CREATE UNIQUE INDEX "ProjectState_projectId_sourceFingerprint_projectionVersion_key"
ON "ProjectState"("projectId", "sourceFingerprint", "projectionVersion");
CREATE UNIQUE INDEX "ProjectStateVersion_projectStateId_version_key"
ON "ProjectStateVersion"("projectStateId", "version");
CREATE UNIQUE INDEX "ProjectStateVersion_projectStateId_sourceFingerprint_projectionVersion_key"
ON "ProjectStateVersion"("projectStateId", "sourceFingerprint", "projectionVersion");
CREATE INDEX "ProjectStateVersion_projectStateId_createdAt_idx"
ON "ProjectStateVersion"("projectStateId", "createdAt");
CREATE UNIQUE INDEX "ProjectStateVersionEvent_projectStateVersionId_developmentEventId_key"
ON "ProjectStateVersionEvent"("projectStateVersionId", "developmentEventId");
CREATE INDEX "ProjectStateVersionEvent_developmentEventId_idx"
ON "ProjectStateVersionEvent"("developmentEventId");

ALTER TABLE "DevelopmentEvent"
ADD CONSTRAINT "DevelopmentEvent_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DevelopmentEvent"
ADD CONSTRAINT "DevelopmentEvent_supersedesEventId_fkey"
FOREIGN KEY ("supersedesEventId") REFERENCES "DevelopmentEvent"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DevelopmentEventCommitEvidence"
ADD CONSTRAINT "DevelopmentEventCommitEvidence_developmentEventId_fkey"
FOREIGN KEY ("developmentEventId") REFERENCES "DevelopmentEvent"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DevelopmentEventCommitEvidence"
ADD CONSTRAINT "DevelopmentEventCommitEvidence_gitHubCommitId_fkey"
FOREIGN KEY ("gitHubCommitId") REFERENCES "GitHubCommit"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DevelopmentEventPullRequestEvidence"
ADD CONSTRAINT "DevelopmentEventPullRequestEvidence_developmentEventId_fkey"
FOREIGN KEY ("developmentEventId") REFERENCES "DevelopmentEvent"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DevelopmentEventPullRequestEvidence"
ADD CONSTRAINT "DevelopmentEventPullRequestEvidence_gitHubPullRequestId_fkey"
FOREIGN KEY ("gitHubPullRequestId") REFERENCES "GitHubPullRequest"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectState"
ADD CONSTRAINT "ProjectState_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectStateVersion"
ADD CONSTRAINT "ProjectStateVersion_projectStateId_fkey"
FOREIGN KEY ("projectStateId") REFERENCES "ProjectState"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectStateVersionEvent"
ADD CONSTRAINT "ProjectStateVersionEvent_projectStateVersionId_fkey"
FOREIGN KEY ("projectStateVersionId") REFERENCES "ProjectStateVersion"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectStateVersionEvent"
ADD CONSTRAINT "ProjectStateVersionEvent_developmentEventId_fkey"
FOREIGN KEY ("developmentEventId") REFERENCES "DevelopmentEvent"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION public.validate_development_event_supersession()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW."supersedesEventId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public."DevelopmentEvent" previous
    WHERE previous."id" = NEW."supersedesEventId"
      AND previous."projectId" = NEW."projectId"
  ) THEN
    RAISE EXCEPTION 'development event supersession must remain within one project'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DevelopmentEvent_validate_supersession"
BEFORE INSERT OR UPDATE OF "projectId", "supersedesEventId"
ON public."DevelopmentEvent"
FOR EACH ROW EXECUTE FUNCTION public.validate_development_event_supersession();

CREATE FUNCTION public.validate_commit_event_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW."gitHubCommitId" IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD."gitHubCommitId" IS NOT NULL THEN
      NEW."detachedAt" = COALESCE(NEW."detachedAt", CURRENT_TIMESTAMP);
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'detached commit evidence can only result from raw evidence deletion'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."detachedAt" IS NOT NULL OR NOT EXISTS (
    SELECT 1
    FROM public."DevelopmentEvent" event
    INNER JOIN public."GitHubCommit" commit
      ON commit."id" = NEW."gitHubCommitId"
    INNER JOIN public."ConnectedRepository" repository
      ON repository."id" = commit."connectedRepositoryId"
    WHERE event."id" = NEW."developmentEventId"
      AND event."projectId" = repository."projectId"
      AND commit."sha" = NEW."commitSha"
  ) THEN
    RAISE EXCEPTION 'commit evidence must match the event project and stable SHA'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DevelopmentEventCommitEvidence_validate"
BEFORE INSERT OR UPDATE
ON public."DevelopmentEventCommitEvidence"
FOR EACH ROW EXECUTE FUNCTION public.validate_commit_event_evidence();

CREATE FUNCTION public.validate_pull_request_event_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW."gitHubPullRequestId" IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD."gitHubPullRequestId" IS NOT NULL THEN
      NEW."detachedAt" = COALESCE(NEW."detachedAt", CURRENT_TIMESTAMP);
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'detached pull request evidence can only result from raw evidence deletion'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."detachedAt" IS NOT NULL OR NOT EXISTS (
    SELECT 1
    FROM public."DevelopmentEvent" event
    INNER JOIN public."GitHubPullRequest" pull_request
      ON pull_request."id" = NEW."gitHubPullRequestId"
    INNER JOIN public."ConnectedRepository" repository
      ON repository."id" = pull_request."connectedRepositoryId"
    WHERE event."id" = NEW."developmentEventId"
      AND event."projectId" = repository."projectId"
      AND pull_request."providerPullRequestId" = NEW."providerPullRequestId"
  ) THEN
    RAISE EXCEPTION 'pull request evidence must match the event project and provider identity'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DevelopmentEventPullRequestEvidence_validate"
BEFORE INSERT OR UPDATE
ON public."DevelopmentEventPullRequestEvidence"
FOR EACH ROW EXECUTE FUNCTION public.validate_pull_request_event_evidence();

CREATE FUNCTION public.validate_project_state_version_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."ProjectStateVersion" state_version
    INNER JOIN public."ProjectState" state
      ON state."id" = state_version."projectStateId"
    INNER JOIN public."DevelopmentEvent" event
      ON event."id" = NEW."developmentEventId"
    WHERE state_version."id" = NEW."projectStateVersionId"
      AND state."projectId" = event."projectId"
  ) THEN
    RAISE EXCEPTION 'project state versions may only reference events from the same project'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectStateVersionEvent_validate"
BEFORE INSERT OR UPDATE
ON public."ProjectStateVersionEvent"
FOR EACH ROW EXECUTE FUNCTION public.validate_project_state_version_event();

CREATE FUNCTION public.prevent_project_state_version_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'project state version history is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "ProjectStateVersion_append_only"
BEFORE UPDATE ON public."ProjectStateVersion"
FOR EACH ROW EXECUTE FUNCTION public.prevent_project_state_version_update();

CREATE TRIGGER "ProjectStateVersionEvent_append_only"
BEFORE UPDATE ON public."ProjectStateVersionEvent"
FOR EACH ROW EXECUTE FUNCTION public.prevent_project_state_version_update();

REVOKE ALL ON TABLE public."DevelopmentEvent" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."DevelopmentEventCommitEvidence" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."DevelopmentEventPullRequestEvidence" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."ProjectState" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."ProjectStateVersion" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."ProjectStateVersionEvent" FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public."DevelopmentEvent" TO authenticated;
GRANT SELECT ON TABLE public."DevelopmentEventCommitEvidence" TO authenticated;
GRANT SELECT ON TABLE public."DevelopmentEventPullRequestEvidence" TO authenticated;
GRANT SELECT ON TABLE public."ProjectState" TO authenticated;
GRANT SELECT ON TABLE public."ProjectStateVersion" TO authenticated;
GRANT SELECT ON TABLE public."ProjectStateVersionEvent" TO authenticated;

ALTER TABLE public."DevelopmentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DevelopmentEventCommitEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DevelopmentEventPullRequestEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProjectState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProjectStateVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProjectStateVersionEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "development_events_select_own"
ON public."DevelopmentEvent"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."Project"
    WHERE "Project"."id" = "DevelopmentEvent"."projectId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "development_event_commit_evidence_select_own"
ON public."DevelopmentEventCommitEvidence"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."DevelopmentEvent"
    INNER JOIN public."Project"
      ON "Project"."id" = "DevelopmentEvent"."projectId"
    WHERE "DevelopmentEvent"."id" = "DevelopmentEventCommitEvidence"."developmentEventId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "development_event_pull_request_evidence_select_own"
ON public."DevelopmentEventPullRequestEvidence"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."DevelopmentEvent"
    INNER JOIN public."Project"
      ON "Project"."id" = "DevelopmentEvent"."projectId"
    WHERE "DevelopmentEvent"."id" = "DevelopmentEventPullRequestEvidence"."developmentEventId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "project_states_select_own"
ON public."ProjectState"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public."Project"
    WHERE "Project"."id" = "ProjectState"."projectId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "project_state_versions_select_own"
ON public."ProjectStateVersion"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."ProjectState"
    INNER JOIN public."Project"
      ON "Project"."id" = "ProjectState"."projectId"
    WHERE "ProjectState"."id" = "ProjectStateVersion"."projectStateId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "project_state_version_events_select_own"
ON public."ProjectStateVersionEvent"
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."ProjectStateVersion"
    INNER JOIN public."ProjectState"
      ON "ProjectState"."id" = "ProjectStateVersion"."projectStateId"
    INNER JOIN public."Project"
      ON "Project"."id" = "ProjectState"."projectId"
    WHERE "ProjectStateVersion"."id" = "ProjectStateVersionEvent"."projectStateVersionId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
);
