ALTER TABLE "SyncRun"
ADD COLUMN "pullRequestsDiscovered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pullRequestsInserted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "SyncRun"
ADD CONSTRAINT "SyncRun_pull_request_counts_check"
CHECK (
  "pullRequestsDiscovered" >= 0
  AND "pullRequestsInserted" >= 0
  AND "pullRequestsInserted" <= "pullRequestsDiscovered"
);

CREATE TABLE "GitHubPullRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "connectedRepositoryId" UUID NOT NULL,
  "providerPullRequestId" BIGINT NOT NULL,
  "number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "bodySummary" VARCHAR(2000),
  "state" VARCHAR(16) NOT NULL,
  "authorLogin" VARCHAR(255),
  "baseBranch" VARCHAR(255) NOT NULL,
  "headBranch" VARCHAR(255) NOT NULL,
  "providerCreatedAt" TIMESTAMPTZ(3) NOT NULL,
  "providerUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
  "mergedAt" TIMESTAMPTZ(3) NOT NULL,
  "mergeCommitSha" VARCHAR(64),
  "additions" INTEGER NOT NULL,
  "deletions" INTEGER NOT NULL,
  "changedFiles" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GitHubPullRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GitHubPullRequest_provider_id_check"
    CHECK ("providerPullRequestId" > 0),
  CONSTRAINT "GitHubPullRequest_number_check" CHECK ("number" > 0),
  CONSTRAINT "GitHubPullRequest_title_nonempty_check" CHECK (length("title") > 0),
  CONSTRAINT "GitHubPullRequest_state_merged_check" CHECK ("state" = 'closed'),
  CONSTRAINT "GitHubPullRequest_branch_nonempty_check"
    CHECK (length("baseBranch") > 0 AND length("headBranch") > 0),
  CONSTRAINT "GitHubPullRequest_timestamp_order_check"
    CHECK (
      "providerUpdatedAt" >= "providerCreatedAt"
      AND "mergedAt" >= "providerCreatedAt"
    ),
  CONSTRAINT "GitHubPullRequest_merge_sha_format_check"
    CHECK (
      "mergeCommitSha" IS NULL
      OR "mergeCommitSha" ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
    ),
  CONSTRAINT "GitHubPullRequest_stats_nonnegative_check"
    CHECK (
      "additions" >= 0
      AND "deletions" >= 0
      AND "changedFiles" >= 0
    )
);

CREATE TABLE "GitHubPullRequestFile" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "gitHubPullRequestId" UUID NOT NULL,
  "path" TEXT NOT NULL,
  "previousPath" TEXT,
  "status" VARCHAR(32) NOT NULL,
  "additions" INTEGER NOT NULL,
  "deletions" INTEGER NOT NULL,
  "changes" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GitHubPullRequestFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GitHubPullRequestFile_path_nonempty_check" CHECK (length("path") > 0),
  CONSTRAINT "GitHubPullRequestFile_status_nonempty_check" CHECK (length("status") > 0),
  CONSTRAINT "GitHubPullRequestFile_stats_nonnegative_check"
    CHECK ("additions" >= 0 AND "deletions" >= 0 AND "changes" >= 0)
);

CREATE TABLE "GitHubPullRequestCommit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "gitHubPullRequestId" UUID NOT NULL,
  "sha" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GitHubPullRequestCommit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GitHubPullRequestCommit_sha_format_check"
    CHECK ("sha" ~ '^[0-9a-f]{40}([0-9a-f]{24})?$')
);

CREATE UNIQUE INDEX "GitHubPullRequest_connectedRepositoryId_providerPullRequestId_key"
ON "GitHubPullRequest"("connectedRepositoryId", "providerPullRequestId");
CREATE UNIQUE INDEX "GitHubPullRequest_connectedRepositoryId_number_key"
ON "GitHubPullRequest"("connectedRepositoryId", "number");
CREATE INDEX "GitHubPullRequest_connectedRepositoryId_mergedAt_idx"
ON "GitHubPullRequest"("connectedRepositoryId", "mergedAt");

CREATE UNIQUE INDEX "GitHubPullRequestFile_gitHubPullRequestId_path_key"
ON "GitHubPullRequestFile"("gitHubPullRequestId", "path");
CREATE INDEX "GitHubPullRequestFile_gitHubPullRequestId_idx"
ON "GitHubPullRequestFile"("gitHubPullRequestId");

CREATE UNIQUE INDEX "GitHubPullRequestCommit_gitHubPullRequestId_sha_key"
ON "GitHubPullRequestCommit"("gitHubPullRequestId", "sha");
CREATE INDEX "GitHubPullRequestCommit_gitHubPullRequestId_idx"
ON "GitHubPullRequestCommit"("gitHubPullRequestId");

ALTER TABLE "GitHubPullRequest"
ADD CONSTRAINT "GitHubPullRequest_connectedRepositoryId_fkey"
FOREIGN KEY ("connectedRepositoryId") REFERENCES "ConnectedRepository"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GitHubPullRequestFile"
ADD CONSTRAINT "GitHubPullRequestFile_gitHubPullRequestId_fkey"
FOREIGN KEY ("gitHubPullRequestId") REFERENCES "GitHubPullRequest"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GitHubPullRequestCommit"
ADD CONSTRAINT "GitHubPullRequestCommit_gitHubPullRequestId_fkey"
FOREIGN KEY ("gitHubPullRequestId") REFERENCES "GitHubPullRequest"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE ALL ON TABLE public."GitHubPullRequest" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."GitHubPullRequestFile" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."GitHubPullRequestCommit" FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public."GitHubPullRequest" TO authenticated;
GRANT SELECT ON TABLE public."GitHubPullRequestFile" TO authenticated;
GRANT SELECT ON TABLE public."GitHubPullRequestCommit" TO authenticated;

ALTER TABLE public."GitHubPullRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."GitHubPullRequestFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."GitHubPullRequestCommit" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "github_pull_requests_select_own"
ON public."GitHubPullRequest"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."ConnectedRepository"
    INNER JOIN public."Project"
      ON "Project"."id" = "ConnectedRepository"."projectId"
    INNER JOIN public."GitHubConnection"
      ON "GitHubConnection"."id" = "ConnectedRepository"."gitHubConnectionId"
    WHERE "ConnectedRepository"."id" = "GitHubPullRequest"."connectedRepositoryId"
      AND "Project"."userId" = (SELECT auth.uid())
      AND "GitHubConnection"."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "github_pull_request_files_select_own"
ON public."GitHubPullRequestFile"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."GitHubPullRequest"
    INNER JOIN public."ConnectedRepository"
      ON "ConnectedRepository"."id" = "GitHubPullRequest"."connectedRepositoryId"
    INNER JOIN public."Project"
      ON "Project"."id" = "ConnectedRepository"."projectId"
    INNER JOIN public."GitHubConnection"
      ON "GitHubConnection"."id" = "ConnectedRepository"."gitHubConnectionId"
    WHERE "GitHubPullRequest"."id" = "GitHubPullRequestFile"."gitHubPullRequestId"
      AND "Project"."userId" = (SELECT auth.uid())
      AND "GitHubConnection"."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "github_pull_request_commits_select_own"
ON public."GitHubPullRequestCommit"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."GitHubPullRequest"
    INNER JOIN public."ConnectedRepository"
      ON "ConnectedRepository"."id" = "GitHubPullRequest"."connectedRepositoryId"
    INNER JOIN public."Project"
      ON "Project"."id" = "ConnectedRepository"."projectId"
    INNER JOIN public."GitHubConnection"
      ON "GitHubConnection"."id" = "ConnectedRepository"."gitHubConnectionId"
    WHERE "GitHubPullRequest"."id" = "GitHubPullRequestCommit"."gitHubPullRequestId"
      AND "Project"."userId" = (SELECT auth.uid())
      AND "GitHubConnection"."userId" = (SELECT auth.uid())
  )
);
