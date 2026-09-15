import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260913024500_enable_core_tenant_rls/migration.sql"
);
const migration = readFileSync(migrationPath, "utf8");

describe("core tenant RLS migration", () => {
  it("enables RLS and removes anonymous access from both ownership tables", () => {
    expect(migration).toContain(
      'ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;'
    );
    expect(migration).toContain(
      'ALTER TABLE public."Project" ENABLE ROW LEVEL SECURITY;'
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public."User" FROM PUBLIC, anon, authenticated;'
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public."Project" FROM PUBLIC, anon, authenticated;'
    );
    expect(migration).not.toMatch(/\bTO\s+anon\b/i);
    expect(migration).not.toMatch(/(?:USING|WITH CHECK)\s*\(\s*true\s*\)/i);
  });

  it("allows authenticated users to read only their own User row", () => {
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public."User" TO authenticated;'
    );
    expect(migration).toMatch(
      /CREATE POLICY "users_select_own"[\s\S]*?FOR SELECT[\s\S]*?TO authenticated[\s\S]*?USING \(\(SELECT auth\.uid\(\)\) = id\);/
    );
    expect(migration).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE)[\s\S]*?public\."User"/i
    );
  });

  it("scopes every Project operation to the authenticated owner", () => {
    expect(migration).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Project" TO authenticated;'
    );
    expect(migration).toMatch(
      /CREATE POLICY "projects_select_own"[\s\S]*?USING \(\(SELECT auth\.uid\(\)\) = "userId"\);/
    );
    expect(migration).toMatch(
      /CREATE POLICY "projects_insert_own"[\s\S]*?WITH CHECK \(\(SELECT auth\.uid\(\)\) = "userId"\);/
    );
    expect(migration).toMatch(
      /CREATE POLICY "projects_update_own"[\s\S]*?USING \(\(SELECT auth\.uid\(\)\) = "userId"\)[\s\S]*?WITH CHECK \(\(SELECT auth\.uid\(\)\) = "userId"\);/
    );
    expect(migration).toMatch(
      /CREATE POLICY "projects_delete_own"[\s\S]*?USING \(\(SELECT auth\.uid\(\)\) = "userId"\);/
    );
  });
});
