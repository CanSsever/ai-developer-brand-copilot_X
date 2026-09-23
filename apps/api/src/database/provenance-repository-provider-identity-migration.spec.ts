import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260923210000_add_provenance_repository_provider_identity/migration.sql"
  ),
  "utf8"
);

describe("repository-scoped provenance identity migration", () => {
  it("adds nullable durable repository identities for commit and pull-request lineage", () => {
    expect(schema).toMatch(/commitSha\s+String\s+@db\.VarChar\(64\)\s+repositoryProviderId\s+BigInt\?/s);
    expect(schema).toMatch(
      /providerPullRequestId\s+BigInt\s+@db\.BigInt\s+repositoryProviderId\s+BigInt\?/s
    );
    expect(migration).toContain(
      'ADD COLUMN "repositoryProviderId" BIGINT'
    );
  });

  it("backfills only attached raw evidence through its owning repository", () => {
    expect(migration).toContain('FROM "GitHubCommit" commit');
    expect(migration).toContain('FROM "GitHubPullRequest" pull_request');
    expect(migration).toContain(
      'WHERE evidence."gitHubCommitId" = commit."id"'
    );
    expect(migration).toContain(
      'WHERE evidence."gitHubPullRequestId" = pull_request."id"'
    );
    expect(migration).not.toMatch(/UPDATE "DevelopmentEvent(?:Commit|PullRequest)Evidence" evidence[\s\S]*WHERE evidence\."gitHub(?:Commit|PullRequest)Id" IS NULL/);
  });

  it("indexes canonical repository-scoped identities and enforces them for attached evidence", () => {
    expect(migration).toContain(
      '"DevelopmentEventCommitEvidence"("repositoryProviderId", "commitSha")'
    );
    expect(schema).toContain("@@index([repositoryProviderId, commitSha])");
    expect(migration).toContain(
      '"DevelopmentEventPullRequestEvidence"("repositoryProviderId", "providerPullRequestId")'
    );
    expect(schema).toContain(
      "@@index([repositoryProviderId, providerPullRequestId])"
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.validate_commit_event_evidence()'
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.validate_pull_request_event_evidence()'
    );
    expect(migration).toContain(
      'repository."providerRepositoryId" = NEW."repositoryProviderId"'
    );
    expect(migration).toContain('NEW."detachedAt" = COALESCE');
  });
});
