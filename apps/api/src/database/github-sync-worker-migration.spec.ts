import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260920010000_add_sync_run_worker_lease/migration.sql"
  ),
  "utf8"
);

describe("durable GitHub sync worker migration", () => {
  it("adds only bounded worker attempt and lease metadata", () => {
    expect(migration).toContain('"workerAttemptCount" INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain('"leaseToken" UUID');
    expect(migration).toContain('"leaseExpiresAt" TIMESTAMPTZ(3)');
    expect(migration).toContain('"workerAttemptCount" <= 3');
  });

  it("backfills existing running work as immediately recoverable", () => {
    expect(migration).toContain('"leaseToken" = gen_random_uuid()');
    expect(migration).toContain('"leaseExpiresAt" = CURRENT_TIMESTAMP');
    expect(migration).toContain('WHERE "status" = \'running\'');
  });

  it("requires leases only for running rows and adds a bounded claim index", () => {
    expect(migration).toContain('"status" = \'running\'');
    expect(migration).toContain('"leaseToken" IS NOT NULL');
    expect(migration).toContain('"leaseExpiresAt" IS NOT NULL');
    expect(migration).toContain('CREATE INDEX "SyncRun_worker_claim_idx"');
    expect(migration).toContain(
      `WHERE "status" IN ('queued', 'running', 'failed_retryable')`
    );
  });

  it("does not change ownership, RLS policies, or grants", () => {
    expect(migration).not.toMatch(/CREATE POLICY|DROP POLICY/i);
    expect(migration).not.toMatch(/GRANT |REVOKE /i);
    expect(migration).not.toMatch(/Project|userId|GitHubConnection/);
  });
});
