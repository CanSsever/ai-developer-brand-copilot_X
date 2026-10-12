import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  opportunityFeedbackActions,
  opportunityFeedbackDismissReasons,
} from "@developer-brand-copilot/contracts";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const migrationDirectory = resolve(process.cwd(), "prisma/migrations");
const migration = readFileSync(resolve(migrationDirectory, "20260925100000_add_opportunity_feedback/migration.sql"), "utf8");
const migrationCount = readdirSync(migrationDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => {
    try { return readdirSync(resolve(migrationDirectory, entry.name)).includes("migration.sql"); }
    catch { return false; }
  }).length;

function block(kind: "model" | "enum", name: string): string {
  const marker = `${kind} ${name} {`;
  const start = schema.indexOf(marker);
  if (start < 0) throw new Error(`Missing Prisma ${kind}: ${name}`);
  const end = schema.indexOf(String.fromCharCode(10) + "}", start);
  if (end < 0) throw new Error(`Unclosed Prisma ${kind}: ${name}`);
  return schema.slice(start + marker.length, end);
}

function enumValues(name: string): string[] {
  return block("enum", name).split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean);
}

describe("Task 3.8 OpportunityFeedback migration contract", () => {
  it("matches exact shared/database-backed feedback taxonomies", () => {
    expect(enumValues("OpportunityFeedbackAction")).toEqual(opportunityFeedbackActions);
    expect(enumValues("OpportunityFeedbackReason")).toEqual(opportunityFeedbackDismissReasons);
    expect(migration.includes('CREATE TYPE "OpportunityFeedbackAction"')).toBe(true);
    expect(migration.includes('CREATE TYPE "OpportunityFeedbackReason"')).toBe(true);
  });

  it("adds a separate feedback entity without changing system opportunity lifecycle", () => {
    const feedback = block("model", "OpportunityFeedback");
    for (const field of ["userId", "opportunityId", "action", "reason", "isCurrent", "supersededAt", "idempotencyKeyHash", "requestFingerprint", "createdAt"]) {
      expect(feedback.includes(field)).toBe(true);
    }
    expect(enumValues("ContentOpportunityStatus")).toEqual(["recommended", "suppressed", "expired"]);
    expect(migration.includes('ALTER TYPE "ContentOpportunityStatus"')).toBe(false);
    expect(migration.includes("ContentDraft")).toBe(false);
    expect(migration.includes("Publication")).toBe(false);
  });

  it("enforces reason/currentness/hash constraints", () => {
    expect(migration.includes("OpportunityFeedback_action_reason_check")).toBe(true);
    expect(migration.includes('"action" = \'accepted\' AND "reason" IS NULL')).toBe(true);
    expect(migration.includes("OpportunityFeedback_current_state_check")).toBe(true);
    expect(migration.includes('"isCurrent" = true AND "supersededAt" IS NULL')).toBe(true);
    expect(migration.includes('"isCurrent" = false AND "supersededAt" IS NOT NULL')).toBe(true);
    expect(migration.split("~ '^[0-9a-f]{64}$'").length - 1).toBe(2);
  });

  it("enforces one user-wide idempotency key and one current decision per opportunity", () => {
    expect(migration.includes('CREATE UNIQUE INDEX "OpportunityFeedback_user_idempotency_key"')).toBe(true);
    expect(migration.includes('ON public."OpportunityFeedback" ("userId", "idempotencyKeyHash")')).toBe(true);
    expect(migration.includes('CREATE UNIQUE INDEX "OpportunityFeedback_one_current_decision"')).toBe(true);
    expect(migration.includes('ON public."OpportunityFeedback" ("userId", "opportunityId")\nWHERE "isCurrent" = true')).toBe(true);
    expect(block("model", "OpportunityFeedback").includes("@@unique([userId, idempotencyKeyHash]")).toBe(true);
  });

  it("enforces same-owner, append-only, and cascade invariants", () => {
    expect(migration.includes("validate_opportunity_feedback_owner")).toBe(true);
    expect(migration.includes('project."userId" = NEW."userId"')).toBe(true);
    expect(migration.includes("validate_opportunity_feedback_project_owner_change")).toBe(true);
    expect(migration.includes("OpportunityFeedback_semantic_append_only")).toBe(true);
    expect(migration.includes("opportunity feedback may only be superseded once")).toBe(true);
    expect(migration.includes("OpportunityFeedback_append_only_delete")).toBe(true);
    expect(migration.includes("pg_trigger_depth() > 1")).toBe(true);
    expect(migration.includes('CONSTRAINT "OpportunityFeedback_userId_fkey"')).toBe(true);
    expect(migration.includes('CONSTRAINT "OpportunityFeedback_opportunityId_fkey"')).toBe(true);
    expect(migration.split("ON DELETE CASCADE").length - 1).toBe(2);
  });

  it("enables owner SELECT RLS and denies authenticated direct writes", () => {
    expect(migration.includes('REVOKE ALL ON TABLE public."OpportunityFeedback" FROM PUBLIC, anon, authenticated')).toBe(true);
    expect(migration.includes('GRANT SELECT ON TABLE public."OpportunityFeedback" TO authenticated')).toBe(true);
    expect(migration.includes('ALTER TABLE public."OpportunityFeedback" ENABLE ROW LEVEL SECURITY')).toBe(true);
    expect(migration.includes('CREATE POLICY "opportunity_feedback_select_own"')).toBe(true);
    expect(migration.includes('FOR SELECT TO authenticated')).toBe(true);
    expect(migration.includes('USING ("userId" = (SELECT auth.uid()))')).toBe(true);
    expect(migration.includes('GRANT INSERT, UPDATE, DELETE ON TABLE public."OpportunityFeedback"')).toBe(false);
  });

  it("adds exactly one forward-only migration and no destructive operations", () => {
    expect(migrationCount).toBe(20);
    expect(migration.includes("DROP TABLE")).toBe(false);
    expect(migration.includes("TRUNCATE")).toBe(false);
    expect(migration.includes('ALTER TYPE "ContentOpportunityStatus"')).toBe(false);
  });
});
