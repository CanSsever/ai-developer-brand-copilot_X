import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8"
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260918222000_add_sync_retry_metadata/migration.sql"
  ),
  "utf8"
);

function modelBlock(modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`)
  );

  if (!match?.[1]) {
    throw new Error(`Missing Prisma model: ${modelName}`);
  }

  return match[1];
}

describe("GitHub sync retry metadata migration", () => {
  it("adds only normalized safe retry metadata to SyncRun", () => {
    const syncRun = modelBlock("SyncRun");

    expect(syncRun).toMatch(/attemptCount\s+Int\s+@default\(0\)/);
    expect(syncRun).toMatch(
      /retryAfterAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/
    );
    expect(migration).toContain(
      '"attemptCount" INTEGER NOT NULL DEFAULT 0'
    );
    expect(migration).toContain('"retryAfterAt" TIMESTAMPTZ(3)');
  });

  it("constrains attempts and retry timing to valid retryable runs", () => {
    expect(migration).toContain(
      'CONSTRAINT "SyncRun_attempt_count_check"'
    );
    expect(migration).toContain('CHECK ("attemptCount" >= 0)');
    expect(migration).toContain(
      'CONSTRAINT "SyncRun_retry_after_status_check"'
    );
    expect(migration).toContain(
      'CHECK ("retryAfterAt" IS NULL OR "status" = \'failed_retryable\')'
    );
  });

  it("does not persist headers, payloads, tokens, or provider messages", () => {
    expect(`${modelBlock("SyncRun")}\n${migration}`).not.toMatch(
      /rawHeader|responseHeader|rawPayload|providerPayload|accessToken|installationToken|authorization|failureMessage/i
    );
  });

  it("does not change existing RLS grants, policies, or ownership", () => {
    expect(migration).not.toMatch(
      /GRANT|REVOKE|CREATE POLICY|DROP POLICY|ROW LEVEL SECURITY/i
    );
    expect(migration).not.toMatch(
      /GitHubCommit|GitHubCommitFile|ConnectedRepository/
    );
  });
});
