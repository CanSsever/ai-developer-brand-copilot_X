import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { SyncRunStatus } from "@developer-brand-copilot/contracts";
import { describe, expect, it } from "vitest";

const schema = readFileSync(
  resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8"
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260918211500_add_github_ingestion_foundation/migration.sql"
  ),
  "utf8"
);
const contract = readFileSync(
  resolve(process.cwd(), "../../packages/contracts/src/github-ingestion.ts"),
  "utf8"
);

const syncRunStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed_retryable",
  "failed_terminal",
  "cancelled",
] as const satisfies readonly SyncRunStatus[];

function modelBlock(modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`)
  );

  if (!match?.[1]) {
    throw new Error(`Missing Prisma model: ${modelName}`);
  }

  return match[1];
}

describe("GitHub ingestion persistence foundation", () => {
  it("relates raw commits and SyncRuns to ConnectedRepository", () => {
    const connectedRepository = modelBlock("ConnectedRepository");
    const commit = modelBlock("GitHubCommit");
    const syncRun = modelBlock("SyncRun");

    expect(connectedRepository).toMatch(/commits\s+GitHubCommit\[\]/);
    expect(connectedRepository).toMatch(/syncRuns\s+SyncRun\[\]/);
    expect(commit).toMatch(
      /connectedRepository\s+ConnectedRepository\s+@relation\(fields: \[connectedRepositoryId\], references: \[id\], onDelete: Cascade, onUpdate: Cascade\)/
    );
    expect(syncRun).toMatch(
      /connectedRepository\s+ConnectedRepository\s+@relation\(fields: \[connectedRepositoryId\], references: \[id\], onDelete: Cascade, onUpdate: Cascade\)/
    );
  });

  it("prevents duplicate SHAs per repository while allowing the same SHA elsewhere", () => {
    const commit = modelBlock("GitHubCommit");

    expect(commit).toMatch(/@@unique\(\[connectedRepositoryId, sha\]\)/);
    expect(commit).not.toMatch(/sha\s+String[^\n]*@unique/);
    expect(migration).toContain(
      '"GitHubCommit_connectedRepositoryId_sha_key"'
    );
    expect(migration).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*ON "GitHubCommit"\("sha"\)/s
    );
  });

  it("stores normalized evidence and file statistics without source or payload blobs", () => {
    const commit = modelBlock("GitHubCommit");
    const file = modelBlock("GitHubCommitFile");

    expect(commit).toMatch(/message\s+String/);
    expect(commit).toMatch(/authorName\s+String\?/);
    expect(commit).toMatch(/authorLogin\s+String\?/);
    expect(commit).toMatch(/authoredAt\s+DateTime/);
    expect(commit).toMatch(/committedAt\s+DateTime/);
    expect(commit).toMatch(/parentShas\s+String\[\]\s+@default\(\[\]\)/);
    expect(commit).toMatch(/additions\s+Int\?/);
    expect(commit).toMatch(/deletions\s+Int\?/);
    expect(commit).toMatch(/changedFiles\s+Int\?/);
    expect(file).toMatch(/path\s+String/);
    expect(file).toMatch(/status\s+String/);
    expect(file).toMatch(/additions\s+Int/);
    expect(file).not.toMatch(/content|patch|diff|payload|sourceCode/i);
  });

  it("defines the durable incremental boundary without inventing a provider cursor", () => {
    const connectedRepository = modelBlock("ConnectedRepository");

    expect(connectedRepository).toMatch(
      /lastSuccessfulSyncAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/
    );
    expect(connectedRepository).not.toMatch(/cursor|pageToken|endCursor/i);
    expect(migration).toContain(
      'ADD COLUMN "lastSuccessfulSyncAt" TIMESTAMPTZ(3);'
    );
  });

  it("keeps the shared and database SyncRun lifecycle aligned", () => {
    expect(syncRunStatuses).toEqual([
      "queued",
      "running",
      "succeeded",
      "failed_retryable",
      "failed_terminal",
      "cancelled",
    ]);

    for (const status of syncRunStatuses) {
      expect(contract).toContain(`"${status}"`);
      expect(migration).toContain(`'${status}'`);
    }

    expect(migration).toContain('CONSTRAINT "SyncRun_status_state_check"');
    expect(migration).toContain('CONSTRAINT "SyncRun_timestamp_order_check"');
    expect(migration).toContain('CONSTRAINT "SyncRun_counts_check"');
  });

  it("prevents duplicate and concurrent synchronization attempts", () => {
    const syncRun = modelBlock("SyncRun");

    expect(syncRun).toMatch(/cursorVersion\s+Int\s+@default\(1\)/);
    expect(syncRun).toMatch(
      /@@unique\(\[connectedRepositoryId, idempotencyKey\]\)/
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "SyncRun_one_active_per_repository_key"[\s\S]*?WHERE "status" IN \('queued', 'running'\);/
    );
    expect(migration).toContain(
      'CONSTRAINT "SyncRun_idempotency_key_format_check"'
    );
    expect(migration).toContain('CONSTRAINT "SyncRun_cursor_version_check"');
  });

  it("cascades repository deletion through commits, files, and SyncRuns", () => {
    expect(migration).toMatch(
      /"GitHubCommit_connectedRepositoryId_fkey"[\s\S]*?REFERENCES "ConnectedRepository"\("id"\)[\s\S]*?ON DELETE CASCADE/
    );
    expect(migration).toMatch(
      /"GitHubCommitFile_gitHubCommitId_fkey"[\s\S]*?REFERENCES "GitHubCommit"\("id"\)[\s\S]*?ON DELETE CASCADE/
    );
    expect(migration).toMatch(
      /"SyncRun_connectedRepositoryId_fkey"[\s\S]*?REFERENCES "ConnectedRepository"\("id"\)[\s\S]*?ON DELETE CASCADE/
    );
  });

  it("enables RLS and permits authenticated clients only tenant-scoped reads", () => {
    for (const table of ["GitHubCommit", "GitHubCommitFile", "SyncRun"]) {
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
      /github_commits_select_own[\s\S]*?"Project"\."userId" = \(SELECT auth\.uid\(\)\)[\s\S]*?"GitHubConnection"\."userId" = \(SELECT auth\.uid\(\)\)/
    );
    expect(migration).toMatch(
      /github_commit_files_select_own[\s\S]*?"Project"\."userId" = \(SELECT auth\.uid\(\)\)[\s\S]*?"GitHubConnection"\."userId" = \(SELECT auth\.uid\(\)\)/
    );
    expect(migration).toMatch(
      /sync_runs_select_own[\s\S]*?"Project"\."userId" = \(SELECT auth\.uid\(\)\)[\s\S]*?"GitHubConnection"\."userId" = \(SELECT auth\.uid\(\)\)/
    );
    expect(migration).not.toMatch(/(?:USING|WITH CHECK)\s*\(\s*true\s*\)/i);
    expect(migration).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE)[^;]*?public\."(?:GitHubCommit|GitHubCommitFile|SyncRun)"/i
    );
  });

  it("contains no client-write RLS policy for ingestion tables", () => {
    expect(migration).not.toMatch(
      /CREATE POLICY[^;]*?ON public\."(?:GitHubCommit|GitHubCommitFile|SyncRun)"[^;]*?FOR (?:INSERT|UPDATE|DELETE|ALL)/is
    );
  });

  it("does not introduce provider secrets or arbitrary raw payload fields", () => {
    const persistenceSurface = [
      modelBlock("GitHubCommit"),
      modelBlock("GitHubCommitFile"),
      modelBlock("SyncRun"),
      contract,
    ].join("\n");

    expect(persistenceSurface).not.toMatch(
      /accessToken|refreshToken|installationToken|oauthCode|authorizationHeader|privateKey|clientSecret|rawPayload|providerPayload/i
    );
  });
});
