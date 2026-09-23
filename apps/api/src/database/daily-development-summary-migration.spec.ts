import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "prisma/migrations/20260923180000_add_daily_development_summaries/migration.sql"), "utf8");

describe("daily development summary migration", () => {
  it("adds persisted versioned summaries and explicit event references", () => {
    expect(schema).toContain("model DailyDevelopmentSummary {");
    expect(schema).toContain("model DailyDevelopmentSummaryEvent {");
    expect(migration).toContain('CREATE UNIQUE INDEX "DailyDevelopmentSummary_one_current_key"');
    expect(migration).toContain('"inputFingerprint" ~ \'^[0-9a-f]{64}$\'');
  });

  it("keeps semantic history append-only and event links project-scoped", () => {
    expect(migration).toContain("prevent_daily_summary_semantic_update");
    expect(migration).toContain("validate_daily_summary_event");
    expect(migration).not.toMatch(/DELETE FROM|DROP TABLE|TRUNCATE/i);
  });

  it("enables owner-only RLS on both new tables", () => {
    expect(migration.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(2);
    expect(migration).toContain('"Project"."userId" = (SELECT auth.uid())');
    expect(migration.match(/GRANT SELECT ON TABLE/g)).toHaveLength(2);
  });
});
