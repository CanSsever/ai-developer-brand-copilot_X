import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8"
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260920210000_add_merged_pull_request_ingestion/migration.sql"
  ),
  "utf8"
);

function modelBlock(modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`)
  );
  if (!match?.[1]) throw new Error(`Missing Prisma model: ${modelName}`);
  return match[1];
}

describe("merged pull request ingestion migration", () => {
  it("stores only normalized PDR evidence with a bounded body summary", () => {
    const pullRequest = modelBlock("GitHubPullRequest");

    expect(pullRequest).toMatch(/providerPullRequestId\s+BigInt/);
    expect(pullRequest).toMatch(/number\s+Int/);
    expect(pullRequest).toMatch(/title\s+String/);
    expect(pullRequest).toMatch(/bodySummary\s+String\?\s+@db\.VarChar\(2000\)/);
    expect(pullRequest).toMatch(/mergedAt\s+DateTime/);
    expect(pullRequest).toMatch(/mergeCommitSha\s+String\?/);
    expect(pullRequest).not.toMatch(/rawPayload|patch|diff|sourceCode|token/i);
  });

  it("uses repository-scoped stable provider and PR-number uniqueness", () => {
    const pullRequest = modelBlock("GitHubPullRequest");

    expect(pullRequest).toMatch(
      /@@unique\(\[connectedRepositoryId, providerPullRequestId\]\)/
    );
    expect(pullRequest).toMatch(
      /@@unique\(\[connectedRepositoryId, number\]\)/
    );
    expect(pullRequest).not.toMatch(
      /providerPullRequestId\s+BigInt[^\n]*@unique/
    );
    expect(pullRequest).not.toMatch(/number\s+Int[^\n]*@unique/);
  });

  it("deduplicates PR files and linked commit SHAs", () => {
    expect(modelBlock("GitHubPullRequestFile")).toMatch(
      /@@unique\(\[gitHubPullRequestId, path\]\)/
    );
    expect(modelBlock("GitHubPullRequestCommit")).toMatch(
      /@@unique\(\[gitHubPullRequestId, sha\]\)/
    );
    expect(migration).toContain(
      '"GitHubPullRequestCommit_sha_format_check"'
    );
  });

  it("does not invent commit-style orphaning for historical merged PRs", () => {
    const surface = [
      modelBlock("GitHubPullRequest"),
      modelBlock("GitHubPullRequestFile"),
      modelBlock("GitHubPullRequestCommit"),
    ].join("\n");
    expect(surface).not.toMatch(/orphanedAt/);
  });

  it("adds independent constrained SyncRun PR counters", () => {
    const syncRun = modelBlock("SyncRun");
    expect(syncRun).toMatch(/pullRequestsDiscovered\s+Int\s+@default\(0\)/);
    expect(syncRun).toMatch(/pullRequestsInserted\s+Int\s+@default\(0\)/);
    expect(migration).toContain('"SyncRun_pull_request_counts_check"');
    expect(migration).toMatch(
      /"pullRequestsInserted" <= "pullRequestsDiscovered"/
    );
  });

  it("cascades repository, PR file, and linked-commit deletion", () => {
    expect(migration).toMatch(
      /"GitHubPullRequest_connectedRepositoryId_fkey"[\s\S]*?REFERENCES "ConnectedRepository"\("id"\)[\s\S]*?ON DELETE CASCADE/
    );
    expect(migration).toMatch(
      /"GitHubPullRequestFile_gitHubPullRequestId_fkey"[\s\S]*?REFERENCES "GitHubPullRequest"\("id"\)[\s\S]*?ON DELETE CASCADE/
    );
    expect(migration).toMatch(
      /"GitHubPullRequestCommit_gitHubPullRequestId_fkey"[\s\S]*?REFERENCES "GitHubPullRequest"\("id"\)[\s\S]*?ON DELETE CASCADE/
    );
  });

  it("enables tenant-scoped SELECT RLS on every PR evidence table", () => {
    for (const table of [
      "GitHubPullRequest",
      "GitHubPullRequestFile",
      "GitHubPullRequestCommit",
    ]) {
      expect(migration).toContain(
        `REVOKE ALL ON TABLE public."${table}" FROM PUBLIC, anon, authenticated;`
      );
      expect(migration).toContain(
        `GRANT SELECT ON TABLE public."${table}" TO authenticated;`
      );
      expect(migration).toContain(
        `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY;`
      );
    }
    expect(migration).toMatch(
      /github_pull_requests_select_own[\s\S]*?"Project"\."userId" = \(SELECT auth\.uid\(\)\)[\s\S]*?"GitHubConnection"\."userId" = \(SELECT auth\.uid\(\)\)/
    );
    expect(migration).toMatch(
      /github_pull_request_files_select_own[\s\S]*?"Project"\."userId" = \(SELECT auth\.uid\(\)\)/
    );
    expect(migration).toMatch(
      /github_pull_request_commits_select_own[\s\S]*?"Project"\."userId" = \(SELECT auth\.uid\(\)\)/
    );
  });

  it("denies authenticated direct writes and contains no permissive policy", () => {
    expect(migration).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE)[^;]*?public\."GitHubPullRequest/i
    );
    expect(migration).not.toMatch(
      /CREATE POLICY[^;]*?ON public\."GitHubPullRequest(?:File|Commit)?"[^;]*?FOR (?:INSERT|UPDATE|DELETE|ALL)/is
    );
    expect(migration).not.toMatch(
      /(?:USING|WITH CHECK)\s*\(\s*true\s*\)/i
    );
  });
});
