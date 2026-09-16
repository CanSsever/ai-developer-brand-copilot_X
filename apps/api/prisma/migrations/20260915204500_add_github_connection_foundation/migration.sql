CREATE TYPE "GitHubConnectionStatus" AS ENUM ('active', 'disconnected', 'authorization_error');

CREATE TABLE "GitHubConnection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "providerInstallationId" BIGINT NOT NULL,
    "providerAccountId" BIGINT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "status" "GitHubConnectionStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GitHubConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConnectedRepository" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "gitHubConnectionId" UUID NOT NULL,
    "providerRepositoryId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL,
    "status" "GitHubConnectionStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConnectedRepository_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GitHubConnectionAttempt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "stateDigest" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GitHubConnectionAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GitHubConnection_userId_providerInstallationId_key"
ON "GitHubConnection"("userId", "providerInstallationId");
CREATE INDEX "GitHubConnection_userId_idx" ON "GitHubConnection"("userId");

CREATE UNIQUE INDEX "ConnectedRepository_projectId_key"
ON "ConnectedRepository"("projectId");
CREATE UNIQUE INDEX "ConnectedRepository_gitHubConnectionId_providerRepositoryId_key"
ON "ConnectedRepository"("gitHubConnectionId", "providerRepositoryId");
CREATE INDEX "ConnectedRepository_gitHubConnectionId_idx"
ON "ConnectedRepository"("gitHubConnectionId");

CREATE UNIQUE INDEX "GitHubConnectionAttempt_stateDigest_key"
ON "GitHubConnectionAttempt"("stateDigest");
CREATE INDEX "GitHubConnectionAttempt_userId_idx"
ON "GitHubConnectionAttempt"("userId");
CREATE INDEX "GitHubConnectionAttempt_projectId_idx"
ON "GitHubConnectionAttempt"("projectId");
CREATE INDEX "GitHubConnectionAttempt_expiresAt_idx"
ON "GitHubConnectionAttempt"("expiresAt");

ALTER TABLE "GitHubConnection"
ADD CONSTRAINT "GitHubConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConnectedRepository"
ADD CONSTRAINT "ConnectedRepository_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConnectedRepository"
ADD CONSTRAINT "ConnectedRepository_gitHubConnectionId_fkey"
FOREIGN KEY ("gitHubConnectionId") REFERENCES "GitHubConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GitHubConnectionAttempt"
ADD CONSTRAINT "GitHubConnectionAttempt_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GitHubConnectionAttempt"
ADD CONSTRAINT "GitHubConnectionAttempt_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE ALL ON TABLE public."GitHubConnection" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."ConnectedRepository" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."GitHubConnectionAttempt" FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public."GitHubConnection" TO authenticated;
GRANT SELECT ON TABLE public."ConnectedRepository" TO authenticated;

ALTER TABLE public."GitHubConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ConnectedRepository" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."GitHubConnectionAttempt" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "github_connections_select_own"
ON public."GitHubConnection"
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = "userId");

CREATE POLICY "connected_repositories_select_own"
ON public."ConnectedRepository"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public."Project"
    WHERE "Project"."id" = "ConnectedRepository"."projectId"
      AND "Project"."userId" = (SELECT auth.uid())
  )
  AND EXISTS (
    SELECT 1
    FROM public."GitHubConnection"
    WHERE "GitHubConnection"."id" = "ConnectedRepository"."gitHubConnectionId"
      AND "GitHubConnection"."userId" = (SELECT auth.uid())
  )
);
