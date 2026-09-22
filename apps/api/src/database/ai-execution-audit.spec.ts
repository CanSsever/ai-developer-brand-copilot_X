import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260922150000_add_ai_execution_audit/migration.sql"
  ),
  "utf8"
);

function modelBlock(modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`)
  );
  if (!match?.[1]) throw new Error(`Missing Prisma model: ${modelName}`);
  return match[1];
}

describe("AIExecution audit persistence", () => {
  it("records the PDR-required stage, model, prompt, schema, timing, usage, and validation metadata", () => {
    const execution = modelBlock("AIExecution");
    for (const field of [
      "stage",
      "inputFingerprint",
      "model",
      "modelConfiguration",
      "promptVersion",
      "schemaVersion",
      "startedAt",
      "completedAt",
      "latencyMs",
      "inputTokens",
      "outputTokens",
      "validationStatus",
      "attemptNumber",
      "failureCode",
    ]) {
      expect(execution).toContain(field);
    }
  });

  it("has a database-backed execution identity and bounded attempt number", () => {
    expect(modelBlock("AIExecution")).toContain(
      "@@unique([projectId, stage, inputFingerprint, promptVersion, modelConfigurationFingerprint, attemptNumber])"
    );
    expect(migration).toContain('CONSTRAINT "AIExecution_attempt_number_check"');
  });

  it("constrains fingerprints, completion state, and nonnegative metrics", () => {
    expect(migration).toContain("AIExecution_input_fingerprint_format_check");
    expect(migration).toContain(
      "AIExecution_model_configuration_fingerprint_format_check"
    );
    expect(migration).toContain("AIExecution_completion_check");
    expect(migration).toContain("AIExecution_metrics_nonnegative_check");
  });

  it("owns executions through Project and cascades Project deletion", () => {
    expect(modelBlock("AIExecution")).toMatch(
      /project\s+Project\s+@relation\(fields: \[projectId\], references: \[id\], onDelete: Cascade/
    );
    expect(migration).toMatch(
      /AIExecution_projectId_fkey[\s\S]*?ON DELETE CASCADE/
    );
  });

  it("links a validated execution to its DevelopmentEvent without crossing Projects", () => {
    expect(modelBlock("AIExecution")).toMatch(
      /developmentEvent\s+DevelopmentEvent\?/
    );
    expect(migration).toContain("validate_ai_execution_event");
    expect(migration).toContain('event."projectId" = NEW."projectId"');
  });

  it("allows authenticated reads only through the owned Project", () => {
    expect(migration).toContain('CREATE POLICY "ai_executions_select_own"');
    expect(migration).toContain(
      '"Project"."userId" = (SELECT auth.uid())'
    );
  });

  it("denies authenticated writes while retaining backend service access", () => {
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public."AIExecution" FROM PUBLIC, anon, authenticated'
    );
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public."AIExecution" TO authenticated'
    );
    expect(migration).toContain(
      'ALTER TABLE public."AIExecution" ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).not.toContain("FORCE ROW LEVEL SECURITY");
  });

  it("contains no prompt, raw response, evidence text, or secret payload fields", () => {
    expect(modelBlock("AIExecution")).not.toMatch(
      /promptText|rawResponse|responseBody|commitMessage|pullRequestTitle|filePath|apiKey|accessToken|credential/i
    );
  });
});
