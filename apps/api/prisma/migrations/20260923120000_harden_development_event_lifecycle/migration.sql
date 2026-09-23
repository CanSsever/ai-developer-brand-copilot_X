CREATE TYPE "DevelopmentEventEvidenceRole" AS ENUM ('candidate', 'supporting');

ALTER TABLE "DevelopmentEventCommitEvidence"
ADD COLUMN "role" "DevelopmentEventEvidenceRole" NOT NULL DEFAULT 'supporting';

ALTER TABLE "DevelopmentEventPullRequestEvidence"
ADD COLUMN "role" "DevelopmentEventEvidenceRole" NOT NULL DEFAULT 'supporting';

CREATE INDEX "DevelopmentEventCommitEvidence_developmentEventId_role_idx"
ON "DevelopmentEventCommitEvidence"("developmentEventId", "role");

CREATE INDEX "DevelopmentEventPullRequestEvidence_developmentEventId_role_idx"
ON "DevelopmentEventPullRequestEvidence"("developmentEventId", "role");

COMMENT ON COLUMN "DevelopmentEventCommitEvidence"."role" IS
'supporting evidence is also candidate evidence; candidate marks group membership not selected as semantic support';

COMMENT ON COLUMN "DevelopmentEventPullRequestEvidence"."role" IS
'supporting evidence is also candidate evidence; candidate marks group membership not selected as semantic support';
