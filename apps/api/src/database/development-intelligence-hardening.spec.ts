import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260923120000_harden_development_event_lifecycle/migration.sql"
  ),
  "utf8"
);

function modelBlock(modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  if (!match?.[1]) throw new Error(`Missing Prisma model: ${modelName}`);
  return match[1];
}

describe("development intelligence cross-layer hardening migration", () => {
  it("adds the smallest candidate/supporting role without duplicating evidence rows", () => {
    expect(migration).toContain(
      "CREATE TYPE \"DevelopmentEventEvidenceRole\" AS ENUM ('candidate', 'supporting')"
    );
    for (const model of [
      "DevelopmentEventCommitEvidence",
      "DevelopmentEventPullRequestEvidence",
    ]) {
      expect(modelBlock(model)).toMatch(
        /role\s+DevelopmentEventEvidenceRole\s+@default\(supporting\)/
      );
    }
  });

  it("preserves all historical provenance as supporting evidence", () => {
    expect(migration.match(/NOT NULL DEFAULT 'supporting'/g)).toHaveLength(2);
    expect(migration).not.toMatch(/DELETE FROM|DROP TABLE|TRUNCATE/i);
  });

  it("keeps existing event/evidence ownership and duplicate constraints authoritative", () => {
    expect(modelBlock("DevelopmentEventCommitEvidence")).toContain(
      "@@unique([developmentEventId, commitSha])"
    );
    expect(modelBlock("DevelopmentEventPullRequestEvidence")).toContain(
      "@@unique([developmentEventId, providerPullRequestId])"
    );
    expect(migration).not.toMatch(/DISABLE ROW LEVEL SECURITY|DROP POLICY/i);
  });
});
