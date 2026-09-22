import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260922210000_add_intelligence_run_orchestration/migration.sql"
  ),
  "utf8"
);

describe("durable intelligence-run orchestration", () => {
  it("persists a bounded durable lifecycle", () => {
    expect(schema).toContain("model IntelligenceRun {");
    expect(migration).toMatch(/CREATE TYPE "IntelligenceRunStatus"/);
    for (const status of [
      "queued",
      "running",
      "succeeded",
      "failed_retryable",
      "failed_terminal",
    ]) {
      expect(migration).toContain(`'${status}'`);
    }
  });

  it("binds every run to one Project and one succeeded SyncRun", () => {
    expect(migration).toContain("validate_intelligence_run_source");
    expect(migration).toMatch(/sync_run\."status" = 'succeeded'/);
    expect(migration).toMatch(/repository\."projectId" = NEW\."projectId"/);
  });

  it("stores processing versions without evidence payloads", () => {
    for (const field of [
      "processingVersion",
      "groupingVersion",
      "interpretationVersion",
      "projectionVersion",
    ]) {
      expect(schema).toContain(field);
    }
    expect(schema.match(/model IntelligenceRun \{([\s\S]*?)\n\}/)?.[1]).not.toMatch(
      /commitMessage|pullRequestTitle|pullRequestBody|filePath|prompt|rawResponse|providerPayload|sourceCode|apiKey|credential/i
    );
  });

  it("deduplicates one source and processing-version boundary", () => {
    expect(schema).toContain("@@unique([sourceSyncRunId, processingVersion])");
    expect(migration).toContain(
      "IntelligenceRun_sourceSyncRunId_processingVersion_key"
    );
  });

  it("allows only one active run per Project", () => {
    expect(migration).toContain("IntelligenceRun_one_active_project_idx");
    expect(migration).toMatch(
      /WHERE "status" IN \('queued', 'running', 'failed_retryable'\)/
    );
  });

  it("constrains attempts, counters, leases, and completion timestamps", () => {
    expect(migration).toContain("IntelligenceRun_attempt_count_check");
    expect(migration).toContain("IntelligenceRun_counters_check");
    expect(migration).toContain("IntelligenceRun_lease_state_check");
    expect(migration).toContain("IntelligenceRun_completion_state_check");
  });

  it("supports atomic skip-locked worker claims", () => {
    expect(migration).toContain("IntelligenceRun_worker_claim_idx");
    expect(migration).toContain("leaseExpiresAt");
  });

  it("enforces owned read-only RLS and backend-controlled writes", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\."IntelligenceRun" FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toMatch(
      /GRANT SELECT ON TABLE public\."IntelligenceRun" TO authenticated/
    );
    expect(migration).toContain("intelligence_runs_select_own");
    expect(migration).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
  });
});
