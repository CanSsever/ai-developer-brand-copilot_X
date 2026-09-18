CREATE TYPE "SyncRunStatus" AS ENUM (
  'queued',
  'running',
  'succeeded',
  'failed_retryable',
  'failed_terminal',
  'cancelled'
);

ALTER TABLE "ConnectedRepository"
ADD COLUMN "lastSuccessfulSyncAt" TIMESTAMPTZ(3);

CREATE TABLE "GitHubCommit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "connectedRepositoryId" UUID NOT NULL,
  "sha" VARCHAR(64) NOT NULL,
  "message" TEXT NOT NULL,
  "authorName" VARCHAR(255),
  "authorLogin" VARCHAR(255),
  "authoredAt" TIMESTAMPTZ(3) NOT NULL,
  "committedAt" TIMESTAMPTZ(3) NOT NULL,
  "parentShas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "additions" INTEGER,
  "deletions" INTEGER,
  "changedFiles" INTEGER,
  "orphanedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GitHubCommit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GitHubCommit_sha_format_check"
    CHECK ("sha" ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  CONSTRAINT "GitHubCommit_stats_nonnegative_check"
    CHECK (
      ("additions" IS NULL OR "additions" >= 0)
      AND ("deletions" IS NULL OR "deletions" >= 0)
      AND ("changedFiles" IS NULL OR "changedFiles" >= 0)
    )
);

CREATE TABLE "GitHubCommitFile" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "gitHubCommitId" UUID NOT NULL,
  "path" TEXT NOT NULL,
  "previousPath" TEXT,
  "status" VARCHAR(32) NOT NULL,
  "additions" INTEGER NOT NULL,
  "deletions" INTEGER NOT NULL,
  "changes" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GitHubCommitFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GitHubCommitFile_path_nonempty_check" CHECK (length("path") > 0),
  CONSTRAINT "GitHubCommitFile_status_nonempty_check" CHECK (length("status") > 0),
  CONSTRAINT "GitHubCommitFile_stats_nonnegative_check"
    CHECK ("additions" >= 0 AND "deletions" >= 0 AND "changes" >= 0)
);

CREATE TABLE "SyncRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "connectedRepositoryId" UUID NOT NULL,
  "status" "SyncRunStatus" NOT NULL DEFAULT 'queued',
  "idempotencyKey" VARCHAR(64) NOT NULL,
  "cursorVersion" INTEGER NOT NULL DEFAULT 1,
  "windowStart" TIMESTAMPTZ(3) NOT NULL,
  "windowEnd" TIMESTAMPTZ(3) NOT NULL,
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "commitsDiscovered" INTEGER NOT NULL DEFAULT 0,
  "commitsInserted" INTEGER NOT NULL DEFAULT 0,
  "failureCode" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SyncRun_idempotency_key_format_check"
    CHECK ("idempotencyKey" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "SyncRun_cursor_version_check" CHECK ("cursorVersion" >= 1),
  CONSTRAINT "SyncRun_window_order_check" CHECK ("windowEnd" >= "windowStart"),
  CONSTRAINT "SyncRun_counts_check"
    CHECK (
      "commitsDiscovered" >= 0
      AND "commitsInserted" >= 0
      AND "commitsInserted" <= "commitsDiscovered"
    ),
  CONSTRAINT "SyncRun_timestamp_order_check"
    CHECK (
      "finishedAt" IS NULL
      OR "startedAt" IS NULL
      OR "finishedAt" >= "startedAt"
    ),
  CONSTRAINT "SyncRun_status_state_check"
    CHECK (
      ("status" = 'queued' AND "startedAt" IS NULL AND "finishedAt" IS NULL AND "failureCode" IS NULL)
      OR ("status" = 'running' AND "startedAt" IS NOT NULL AND "finishedAt" IS NULL AND "failureCode" IS NULL)
      OR ("status" = 'succeeded' AND "startedAt" IS NOT NULL AND "finishedAt" IS NOT NULL AND "failureCode" IS NULL)
      OR ("status" IN ('failed_retryable', 'failed_terminal') AND "startedAt" IS NOT NULL AND "finishedAt" IS NOT NULL AND "failureCode" IS NOT NULL)
      OR ("status" = 'cancelled' AND "finishedAt" IS NOT NULL AND "failureCode" IS NULL)
    )
);

CREATE UNIQUE INDEX "GitHubCommit_connectedRepositoryId_sha_key"
ON "GitHubCommit"("connectedRepositoryId", "sha");
CREATE INDEX "GitHubCommit_connectedRepositoryId_committedAt_idx"
ON "GitHubCommit"("connectedRepositoryId", "committedAt");

CREATE UNIQUE INDEX "GitHubCommitFile_gitHubCommitId_path_key"
ON "GitHubCommitFile"("gitHubCommitId", "path");
CREATE INDEX "GitHubCommitFile_gitHubCommitId_idx"
ON "GitHubCommitFile"("gitHubCommitId");

CREATE UNIQUE INDEX "SyncRun_connectedRepositoryId_idempotencyKey_key"
ON "SyncRun"("connectedRepositoryId", "idempotencyKey");
CREATE INDEX "SyncRun_connectedRepositoryId_createdAt_idx"
ON "SyncRun"("connectedRepositoryId", "createdAt");
CREATE INDEX "SyncRun_connectedRepositoryId_status_idx"
ON "SyncRun"("connectedRepositoryId", "status");
CREATE UNIQUE INDEX "SyncRun_one_active_per_repository_key"
ON "SyncRun"("connectedRepositoryId")
WHERE "status" IN ('queued', 'running');

ALTER TABLE "GitHubCommit"
ADD CONSTRAINT "GitHubCommit_connectedRepositoryId_fkey"
FOREIGN KEY ("connectedRepositoryId") REFERENCES "ConnectedRepository"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GitHubCommitFile"
ADD CONSTRAINT "GitHubCommitFile_gitHubCommitId_fkey"
FOREIGN KEY ("gitHubCommitId") REFERENCES "GitHubCommit"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SyncRun"
ADD CONSTRAINT "SyncRun_connectedRepositoryId_fkey"
FOREIGN KEY ("connectedRepositoryId") REFERENCES "ConnectedRepository"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE ALL ON TABLE public."GitHubCommit" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."GitHubCommitFile" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."SyncRun" FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public."GitHubCommit" TO authenticated;
GRANT SELECT ON TABLE public."GitHubCommitFile" TO authenticated;
GRANT SELECT ON TABLE public."SyncRun" TO authenticated;

ALTER TABLE public."GitHubCommit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."GitHubCommitFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SyncRun" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "github_commits_select_own"
ON public."GitHubCommit"
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
    WHERE "ConnectedRepository"."id" = "GitHubCommit"."connectedRepositoryId"
      AND "Project"."userId" = (SELECT auth.uid())
      AND "GitHubConnection"."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "github_commit_files_select_own"
ON public."GitHubCommitFile"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."GitHubCommit"
    INNER JOIN public."ConnectedRepository"
      ON "ConnectedRepository"."id" = "GitHubCommit"."connectedRepositoryId"
    INNER JOIN public."Project"
      ON "Project"."id" = "ConnectedRepository"."projectId"
    INNER JOIN public."GitHubConnection"
      ON "GitHubConnection"."id" = "ConnectedRepository"."gitHubConnectionId"
    WHERE "GitHubCommit"."id" = "GitHubCommitFile"."gitHubCommitId"
      AND "Project"."userId" = (SELECT auth.uid())
      AND "GitHubConnection"."userId" = (SELECT auth.uid())
  )
);

CREATE POLICY "sync_runs_select_own"
ON public."SyncRun"
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
    WHERE "ConnectedRepository"."id" = "SyncRun"."connectedRepositoryId"
      AND "Project"."userId" = (SELECT auth.uid())
      AND "GitHubConnection"."userId" = (SELECT auth.uid())
  )
);
