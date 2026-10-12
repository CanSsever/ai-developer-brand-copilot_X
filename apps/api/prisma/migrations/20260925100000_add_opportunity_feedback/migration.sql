CREATE TYPE "OpportunityFeedbackAction" AS ENUM (
  'accepted',
  'dismissed'
);

CREATE TYPE "OpportunityFeedbackReason" AS ENUM (
  'not_relevant',
  'repetitive',
  'too_minor',
  'sensitive',
  'other'
);

CREATE TABLE public."OpportunityFeedback" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "opportunityId" UUID NOT NULL,
  "action" "OpportunityFeedbackAction" NOT NULL,
  "reason" "OpportunityFeedbackReason",
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "supersededAt" TIMESTAMPTZ(3),
  "idempotencyKeyHash" VARCHAR(64) NOT NULL,
  "requestFingerprint" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpportunityFeedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpportunityFeedback_action_reason_check"
    CHECK (("action" = 'accepted' AND "reason" IS NULL) OR "action" = 'dismissed'),
  CONSTRAINT "OpportunityFeedback_current_state_check"
    CHECK (("isCurrent" = true AND "supersededAt" IS NULL) OR ("isCurrent" = false AND "supersededAt" IS NOT NULL)),
  CONSTRAINT "OpportunityFeedback_idempotency_hash_check"
    CHECK ("idempotencyKeyHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "OpportunityFeedback_request_fingerprint_check"
    CHECK ("requestFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "OpportunityFeedback_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OpportunityFeedback_opportunityId_fkey"
    FOREIGN KEY ("opportunityId") REFERENCES public."ContentOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OpportunityFeedback_user_idempotency_key"
ON public."OpportunityFeedback" ("userId", "idempotencyKeyHash");

CREATE UNIQUE INDEX "OpportunityFeedback_one_current_decision"
ON public."OpportunityFeedback" ("userId", "opportunityId")
WHERE "isCurrent" = true;

CREATE INDEX "OpportunityFeedback_opportunity_user_current_idx"
ON public."OpportunityFeedback" ("opportunityId", "userId", "isCurrent");

CREATE FUNCTION public.validate_opportunity_feedback_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."ContentOpportunity" opportunity
    INNER JOIN public."Project" project ON project."id" = opportunity."projectId"
    WHERE opportunity."id" = NEW."opportunityId"
      AND project."userId" = NEW."userId"
  ) THEN
    RAISE EXCEPTION 'opportunity feedback must belong to the opportunity owner'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND (NEW."isCurrent" = false OR NEW."supersededAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'new opportunity feedback must begin as current'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OpportunityFeedback_validate_owner_and_initial_state"
BEFORE INSERT OR UPDATE OF "userId", "opportunityId", "isCurrent", "supersededAt"
ON public."OpportunityFeedback"
FOR EACH ROW EXECUTE FUNCTION public.validate_opportunity_feedback_owner();

CREATE FUNCTION public.validate_opportunity_feedback_project_owner_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW."userId" IS DISTINCT FROM OLD."userId" AND EXISTS (
    SELECT 1
    FROM public."ContentOpportunity" opportunity
    INNER JOIN public."OpportunityFeedback" feedback ON feedback."opportunityId" = opportunity."id"
    WHERE opportunity."projectId" = NEW."id"
      AND feedback."userId" IS DISTINCT FROM NEW."userId"
  ) THEN
    RAISE EXCEPTION 'project ownership cannot invalidate opportunity feedback ownership'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Project_validate_opportunity_feedback_owner"
BEFORE UPDATE OF "userId" ON public."Project"
FOR EACH ROW EXECUTE FUNCTION public.validate_opportunity_feedback_project_owner_change();

CREATE FUNCTION public.prevent_opportunity_feedback_semantic_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF ROW(
    NEW."id",
    NEW."userId",
    NEW."opportunityId",
    NEW."action",
    NEW."reason",
    NEW."idempotencyKeyHash",
    NEW."requestFingerprint",
    NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."userId",
    OLD."opportunityId",
    OLD."action",
    OLD."reason",
    OLD."idempotencyKeyHash",
    OLD."requestFingerprint",
    OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'opportunity feedback semantic history is append-only'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(NEW."isCurrent", NEW."supersededAt") IS NOT DISTINCT FROM ROW(OLD."isCurrent", OLD."supersededAt") THEN
    RETURN NEW;
  END IF;

  IF OLD."isCurrent" = true
    AND OLD."supersededAt" IS NULL
    AND NEW."isCurrent" = false
    AND NEW."supersededAt" IS NOT NULL
    AND NEW."supersededAt" >= OLD."createdAt" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'opportunity feedback may only be superseded once'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "OpportunityFeedback_semantic_append_only"
BEFORE UPDATE ON public."OpportunityFeedback"
FOR EACH ROW EXECUTE FUNCTION public.prevent_opportunity_feedback_semantic_update();

CREATE FUNCTION public.prevent_opportunity_feedback_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'opportunity feedback history is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "OpportunityFeedback_append_only_delete"
BEFORE DELETE ON public."OpportunityFeedback"
FOR EACH ROW EXECUTE FUNCTION public.prevent_opportunity_feedback_delete();

REVOKE ALL ON TABLE public."OpportunityFeedback" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public."OpportunityFeedback" TO authenticated;

ALTER TABLE public."OpportunityFeedback" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opportunity_feedback_select_own"
ON public."OpportunityFeedback"
FOR SELECT TO authenticated
USING ("userId" = (SELECT auth.uid()));
