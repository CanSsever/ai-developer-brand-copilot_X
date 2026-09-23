ALTER TABLE "DevelopmentEventCommitEvidence"
ADD COLUMN "repositoryProviderId" BIGINT;

ALTER TABLE "DevelopmentEventPullRequestEvidence"
ADD COLUMN "repositoryProviderId" BIGINT;

UPDATE "DevelopmentEventCommitEvidence" evidence
SET "repositoryProviderId" = repository."providerRepositoryId"
FROM "GitHubCommit" commit
INNER JOIN "ConnectedRepository" repository
  ON repository."id" = commit."connectedRepositoryId"
WHERE evidence."gitHubCommitId" = commit."id";

UPDATE "DevelopmentEventPullRequestEvidence" evidence
SET "repositoryProviderId" = repository."providerRepositoryId"
FROM "GitHubPullRequest" pull_request
INNER JOIN "ConnectedRepository" repository
  ON repository."id" = pull_request."connectedRepositoryId"
WHERE evidence."gitHubPullRequestId" = pull_request."id";

CREATE INDEX "DevelopmentEventCommitEvidence_repositoryProviderId_commitSha_idx"
ON "DevelopmentEventCommitEvidence"("repositoryProviderId", "commitSha");

CREATE INDEX "DevelopmentEventPullRequestEvidence_repositoryProviderId_providerPullRequestId_idx"
ON "DevelopmentEventPullRequestEvidence"("repositoryProviderId", "providerPullRequestId");

CREATE OR REPLACE FUNCTION public.validate_commit_event_evidence()
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
      AND repository."providerRepositoryId" = NEW."repositoryProviderId"
  ) THEN
    RAISE EXCEPTION 'commit evidence must match the event project, repository, and stable SHA'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_pull_request_event_evidence()
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
      AND repository."providerRepositoryId" = NEW."repositoryProviderId"
  ) THEN
    RAISE EXCEPTION 'pull request evidence must match the event project, repository, and provider identity'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
