import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260923200000_add_ai_execution_extraction_version/migration.sql"
  ),
  "utf8"
);

describe("AIExecution extraction version migration", () => {
  it("adds a nullable interpretation boundary without backfilling historical executions", () => {
    expect(schema).toMatch(/extractionVersion\s+String\?\s+@db\.VarChar\(64\)/);
    expect(migration).toContain('ADD COLUMN "extractionVersion" VARCHAR(64)');
    expect(migration).not.toMatch(/DEFAULT|UPDATE\s+"AIExecution"/);
  });

  it("indexes the exact reusable insufficient-evidence boundary", () => {
    expect(schema).toContain(
      "@@index([projectId, stage, inputFingerprint, extractionVersion])"
    );
    expect(migration).toContain(
      '"AIExecution"("projectId", "stage", "inputFingerprint", "extractionVersion")'
    );
  });
});
