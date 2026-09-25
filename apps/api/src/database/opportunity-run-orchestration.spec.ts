import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(process.cwd(), "prisma/migrations/20260925020000_add_opportunity_run_orchestration/migration.sql"),
  "utf8"
);

describe("OpportunityRun orchestration persistence", () => {
  it("defines a separate durable orchestration domain with constrained lifecycle and triggers", () => {
    expect(schema).toContain("model OpportunityRun {");
    expect(migration).toMatch(/CREATE TYPE "OpportunityRunStatus"/);
    expect(migration).toMatch(/CREATE TYPE "OpportunityRunTrigger"/);
    for (const value of ["queued", "running", "succeeded", "failed_retryable", "failed_terminal", "intelligence_completion", "manual_reprocess"]) {
      expect(migration).toContain(`'${value}'`);
    }
  });

  it("binds a run to a succeeded IntelligenceRun in the same project and boundary", () => {
    expect(migration).toContain("validate_opportunity_run_source");
    expect(migration).toContain('source."projectId" = NEW."projectId"');
    expect(migration).toContain('source."status" = \'succeeded\'');
    expect(migration).toContain('source."sourceWindowEnd" = NEW."evaluationBoundary"');
  });

  it("cascades with Project or source deletion and validates source changes", () => {
    expect(migration).toMatch(/OpportunityRun_projectId_fkey[\s\S]*ON DELETE CASCADE/);
    expect(migration).toMatch(/OpportunityRun_sourceIntelligenceRunId_fkey[\s\S]*ON DELETE CASCADE/);
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE OF "projectId", "sourceIntelligenceRunId", "evaluationBoundary"/);
  });

  it("enforces exact identity and one active run per project", () => {
    expect(migration).toContain("OpportunityRun_exact_identity_key");
    expect(migration).toContain("OpportunityRun_projectId_runKey_key");
    expect(migration).toContain("OpportunityRun_one_active_project_idx");
    expect(migration).toMatch(/WHERE "status" IN \('queued', 'running', 'failed_retryable'\)/);
  });

  it("constrains hashes, attempts, counters, leases, and terminal timestamps", () => {
    for (const constraint of ["run_key_format_check", "processing_version_format_check", "input_fingerprint_format_check", "attempt_count_check", "counters_check", "lease_state_check", "completion_state_check", "success_counters_check"]) {
      expect(migration).toContain(`OpportunityRun_${constraint}`);
    }
  });

  it("supports atomic skip-locked claims and owner-only read access", () => {
    expect(migration).toContain("OpportunityRun_worker_claim_idx");
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\."OpportunityRun" FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT SELECT ON TABLE public\."OpportunityRun" TO authenticated/);
    expect(migration).toContain("opportunity_runs_select_own");
    expect(migration).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
  });

  it("contains no prompt, response, evidence, source, or secret payload columns", () => {
    const model = schema.match(/model OpportunityRun \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(model).not.toMatch(/prompt|response|providerBody|evidence|sourceCode|apiKey|credential|canonicalInput/i);
  });

  it("adds no Task 3.7 read-model or Task 3.8 feedback schema", () => {
    expect(migration).not.toMatch(/OpportunityFeedback|acceptedAt|dismissedAt|dashboard|readModel/i);
  });
});
