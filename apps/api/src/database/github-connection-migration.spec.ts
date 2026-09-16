import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260915204500_add_github_connection_foundation/migration.sql"
  ),
  "utf8"
);

describe("GitHub connection foundation migration", () => {
  it("creates stable installation and repository identities without token columns", () => {
    expect(migration).toContain('CREATE TABLE "GitHubConnection"');
    expect(migration).toContain('"providerInstallationId" BIGINT NOT NULL');
    expect(migration).toContain('CREATE TABLE "ConnectedRepository"');
    expect(migration).toContain('"providerRepositoryId" BIGINT NOT NULL');
    expect(migration).toContain(
      '"GitHubConnection_userId_providerInstallationId_key"'
    );
    expect(migration).toContain(
      '"ConnectedRepository_gitHubConnectionId_providerRepositoryId_key"'
    );
    expect(migration).not.toMatch(/accessToken|refreshToken|privateKey|clientSecret/i);
  });

  it("enforces one repository per Project and cascading ownership", () => {
    expect(migration).toContain('"ConnectedRepository_projectId_key"');
    expect(migration).toMatch(
      /"ConnectedRepository_projectId_fkey"[\s\S]*?REFERENCES "Project"\("id"\) ON DELETE CASCADE/
    );
    expect(migration).toMatch(
      /"GitHubConnection_userId_fkey"[\s\S]*?REFERENCES "User"\("id"\) ON DELETE CASCADE/
    );
  });

  it("enables RLS and grants authenticated clients read-only tenant views", () => {
    for (const table of [
      "GitHubConnection",
      "ConnectedRepository",
      "GitHubConnectionAttempt",
    ]) {
      expect(migration).toContain(
        `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY;`
      );
      expect(migration).toContain(
        `REVOKE ALL ON TABLE public."${table}" FROM PUBLIC, anon, authenticated;`
      );
    }

    expect(migration).toMatch(
      /github_connections_select_own[\s\S]*?auth\.uid\(\)\) = "userId"/
    );
    expect(migration).toMatch(
      /connected_repositories_select_own[\s\S]*?"Project"\."userId" = \(SELECT auth\.uid\(\)\)[\s\S]*?"GitHubConnection"\."userId" = \(SELECT auth\.uid\(\)\)/
    );
    expect(migration).not.toMatch(/(?:USING|WITH CHECK)\s*\(\s*true\s*\)/i);
    expect(migration).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE)/i);
  });
});
