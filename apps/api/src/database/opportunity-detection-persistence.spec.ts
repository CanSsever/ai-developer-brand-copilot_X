import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve(
  process.cwd(),
  "prisma/migrations/20260924230000_add_phase3_opportunity_detection_results/migration.sql"
), "utf8");
const hardeningMigration = readFileSync(resolve(
  process.cwd(),
  "prisma/migrations/20260925010000_harden_phase3_opportunity_detection_results/migration.sql"
), "utf8");

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match?.[1]) throw new Error(`Missing Prisma model: ${name}`);
  return match[1];
}

function enumBlock(name: string): string {
  const match = schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match?.[1]) throw new Error(`Missing Prisma enum: ${name}`);
  return match[1];
}

describe("Task 3.4 opportunity detection persistence", () => {
  it("adds a dedicated AIExecution stage without overloading Phase 2", () => {
    expect(enumBlock("AIExecutionStage").trim().split(/\s+/)).toEqual([
      "development_event_interpretation",
      "opportunity_detection",
    ]);
    expect(migration).toContain("ADD VALUE 'opportunity_detection'");
    expect(migration).not.toContain("development_event_interpretation' ;");
  });

  it("stores a result row for both zero-candidate and populated successes", () => {
    expect(modelBlock("OpportunityDetectionResult")).toContain("candidateCount   Int");
    expect(modelBlock("OpportunityDetectionResult")).toMatch(/aiExecutionId\s+String\s+@unique/);
    expect(migration).toContain('CHECK ("candidateCount" BETWEEN 0 AND 12)');
    expect(migration).toContain('UNIQUE ("aiExecutionId")');
  });

  it("persists only validated candidate semantics and deterministic order", () => {
    const candidate = modelBlock("OpportunityDetectionCandidate");
    for (const field of ["position", "opportunityType", "title", "recommendedFormat", "topicDescriptor", "confidence", "selectedEventCount"]) {
      expect(candidate).toContain(field);
    }
    expect(candidate).not.toMatch(/topicKey|candidateKey|noveltyScore|priorityScore|shouldPost|reasonSignal|lifecycle/i);
    expect(migration).toContain('UNIQUE ("resultId", "position")');
    expect(migration).toContain('OpportunityDetectionCandidate_position_check');
    expect(migration).toContain('OpportunityDetectionCandidate_confidence_check');
  });

  it("preserves selected event provenance with per-candidate positions and restrictive event deletion", () => {
    const links = modelBlock("OpportunityDetectionCandidateDevelopmentEvent");
    expect(links).toContain("developmentEventId String");
    expect(links).toContain("@@id([candidateId, developmentEventId])");
    expect(links).toContain("@@unique([candidateId, position])");
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).toContain("validate_opportunity_detection_candidate_event");
    expect(migration).toContain('event."projectId" = result."projectId"');
  });

  it("requires result/execution project and input identity to match and complete persistence", () => {
    expect(migration).toContain("validate_opportunity_detection_result");
    expect(migration).toContain('execution."stage" = \'opportunity_detection\'');
    expect(migration).toContain('execution."inputFingerprint" = NEW."inputFingerprint"');
    expect(migration).toContain("validate_opportunity_detection_result_complete");
    expect(migration).toContain("candidate count is incomplete");
    expect(migration).toContain("candidate provenance is incomplete");
    expect(migration).toMatch(/execution\."status" = 'succeeded'/);
    expect(migration).toMatch(/execution\."validationStatus" = 'valid'/);
  });

  it("records bounded repair audit metadata without storing prompts or responses", () => {
    expect(modelBlock("AIExecution")).toContain("isRepairAttempt               Boolean");
    expect(migration).toContain('ADD COLUMN "isRepairAttempt" BOOLEAN NOT NULL DEFAULT false');
    expect(schema).not.toMatch(/rawPrompt|rawResponse|providerBody|responseJson/i);
    expect(modelBlock("OpportunityDetectionResult")).not.toMatch(/prompt|response|evidence|credential|token/i);
  });

  it("uses tenant-scoped read policies and denies direct authenticated writes", () => {
    for (const table of ["OpportunityDetectionResult", "OpportunityDetectionCandidate", "OpportunityDetectionCandidateDevelopmentEvent"]) {
      expect(migration).toContain(`REVOKE ALL ON TABLE public."${table}" FROM PUBLIC, anon, authenticated`);
      expect(migration).toContain(`GRANT SELECT ON TABLE public."${table}" TO authenticated`);
      expect(migration).toContain(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain('"Project"."userId" = (SELECT auth.uid())');
    expect(migration).not.toContain('ALTER TABLE public."OpportunityDetectionResult" FORCE ROW LEVEL SECURITY');
  });

  it("uniquely identifies one successful-valid canonical result by the complete execution identity", () => {
    const index = hardeningMigration.match(/CREATE UNIQUE INDEX "AIExecution_opportunity_canonical_result_key"[\s\S]*?;/)?.[0];
    expect(index).toBeDefined();
    for (const field of ["projectId", "stage", "inputFingerprint", "model", "modelConfigurationFingerprint", "promptVersion", "schemaVersion", "extractionVersion"]) {
      expect(index).toContain(`"${field}"`);
    }
    expect(index).toContain("'opportunity_detection'");
    expect(index).toContain("'succeeded'");
    expect(index).toContain("'valid'");
  });

  it("requires every successful-valid opportunity execution to commit exactly one complete result", () => {
    expect(hardeningMigration).toContain('CREATE CONSTRAINT TRIGGER "AIExecution_opportunity_success_requires_result"');
    expect(hardeningMigration).toContain('CREATE CONSTRAINT TRIGGER "OpportunityDetectionResult_execution_requires_result"');
    expect(hardeningMigration).toContain("requires exactly one matching result");
    expect(hardeningMigration).toContain("assert_opportunity_detection_result_complete");
    expect(hardeningMigration).toContain("candidate count is incomplete");
    expect(hardeningMigration).toContain("candidate ordering is incomplete");
    expect(hardeningMigration).toContain("candidate provenance is incomplete");
    expect(migration).toContain('CHECK ("candidateCount" BETWEEN 0 AND 12)');
    expect(hardeningMigration).toContain('actual_candidates <> result_row."candidateCount"');
  });

  it("protects detector semantics from updates while preserving parent-cascade cleanup", () => {
    for (const table of ["OpportunityDetectionResult", "OpportunityDetectionCandidate", "OpportunityDetectionCandidateDevelopmentEvent"]) {
      expect(hardeningMigration).toContain(`CREATE TRIGGER "${table}_append_only"`);
      expect(hardeningMigration).toContain(`BEFORE UPDATE ON public."${table}"`);
    }
    expect(hardeningMigration).toContain("opportunity detection semantic history is append-only");
    expect(hardeningMigration).toContain("opportunity detection execution identity is immutable");
    expect(hardeningMigration).toContain('"OpportunityDetectionResult_execution_requires_result"');
    expect(migration).toContain("ON DELETE CASCADE");
    /*
    expect(hardeningMigration).toContain("AFTER INSERT OR DELETE ON public.\OpportunityDetectionCandidate\");
    expect(hardeningMigration).toContain("AFTER INSERT OR DELETE ON public.\OpportunityDetectionCandidateDevelopmentEvent\");
    */
    expect(hardeningMigration).toContain("OpportunityDetectionCandidate_validate_complete");
    expect(hardeningMigration).toContain("OpportunityDetectionCandidateDevelopmentEvent_validate_complete");
    expect(hardeningMigration).not.toMatch(/BEFORE DELETE ON public\."OpportunityDetection(Result|Candidate|CandidateDevelopmentEvent)"/);
  });
});
