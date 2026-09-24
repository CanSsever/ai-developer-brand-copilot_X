import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  contentOpportunityReasonCodes,
  contentOpportunityRecommendedFormats,
  contentOpportunityStatuses,
  contentOpportunityTypes,
  negativeContentOpportunityReasonCodes,
  positiveContentOpportunityReasonCodes,
} from "@developer-brand-copilot/contracts";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260924120000_add_content_opportunity_foundation/migration.sql"
  ),
  "utf8"
);

function modelBlock(modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  if (!match?.[1]) throw new Error(`Missing Prisma model: ${modelName}`);
  return match[1];
}

function enumValues(enumName: string): readonly string[] {
  const match = schema.match(new RegExp(`enum ${enumName} \\{([\\s\\S]*?)\\n\\}`));
  if (!match?.[1]) throw new Error(`Missing Prisma enum: ${enumName}`);
  return match[1].trim().split(/\s+/);
}

describe("content opportunity persistence foundation", () => {
  it("uses the approved opportunity and recommended-format taxonomies exactly", () => {
    expect(enumValues("ContentOpportunityType")).toEqual(contentOpportunityTypes);
    expect(enumValues("ContentOpportunityRecommendedFormat")).toEqual(
      contentOpportunityRecommendedFormats
    );
    expect(enumValues("ContentOpportunityStatus")).toEqual(contentOpportunityStatuses);
  });

  it("uses the approved controlled reason-signal codes and effects", () => {
    expect(enumValues("ContentOpportunityReasonCode")).toEqual(
      contentOpportunityReasonCodes
    );
    expect(enumValues("ContentOpportunityReasonEffect")).toEqual([
      "positive",
      "negative",
    ]);
    expect(migration).toContain("ContentOpportunityReasonSignal_effect_check");
    for (const code of positiveContentOpportunityReasonCodes) {
      expect(migration).toContain(`'${code}'`);
    }
    for (const code of negativeContentOpportunityReasonCodes) {
      expect(migration).toContain(`'${code}'`);
    }
  });

  it("persists scores, decisions, versions, fingerprints, and immutable history", () => {
    const opportunity = modelBlock("ContentOpportunity");
    for (const field of [
      "priorityScore",
      "noveltyScore",
      "confidence",
      "shouldPost",
      "scoringVersion",
      "inputFingerprint",
      "isCurrent",
      "expiredAt",
    ]) {
      expect(opportunity).toContain(field);
    }
    expect(migration).toContain("ContentOpportunity_scores_range_check");
    expect(migration).toContain("ContentOpportunity_semantic_append_only");
    expect(migration).toContain("prevent_content_opportunity_semantic_update");
  });

  it("enforces coherent recommended, suppressed, and expired decisions", () => {
    expect(migration).toContain("ContentOpportunity_lifecycle_check");
    expect(migration).toMatch(
      /"status" = 'recommended'[\s\S]*?"shouldPost" = true[\s\S]*?"isCurrent" = true[\s\S]*?"expiredAt" IS NULL/
    );
    expect(migration).toMatch(
      /"status" = 'suppressed'[\s\S]*?"shouldPost" = false[\s\S]*?"isCurrent" = true[\s\S]*?"expiredAt" IS NULL/
    );
    expect(migration).toMatch(
      /"status" = 'expired'[\s\S]*?"isCurrent" = false[\s\S]*?"expiredAt" IS NOT NULL/
    );
    expect(migration).not.toMatch(
      /"status" = 'recommended'[\s\S]{0,100}?"shouldPost" = false/
    );
  });

  it("uses stable candidate and complete-input identities without title identity", () => {
    const opportunity = modelBlock("ContentOpportunity");
    expect(opportunity).toContain(
      "@@unique([projectId, candidateKey, inputFingerprint, scoringVersion])"
    );
    expect(migration).toContain("ContentOpportunity_identity_key");
    expect(migration).toContain("ContentOpportunity_one_current_candidate_key");
    expect(migration).toContain("ContentOpportunity_candidate_key_format_check");
    expect(migration).toContain("ContentOpportunity_input_fingerprint_format_check");
    expect(migration).not.toMatch(/UNIQUE INDEX[^;]+"title"/s);
  });

  it("keeps normalized topic identity separately queryable from candidate identity", () => {
    const opportunity = modelBlock("ContentOpportunity");
    expect(opportunity).toMatch(/topicKey\s+String\s+@db\.VarChar\(160\)/);
    expect(opportunity).toContain("@@index([projectId, topicKey, createdAt])");
    expect(opportunity).toContain(
      "@@unique([projectId, candidateKey, inputFingerprint, scoringVersion])"
    );
    expect(migration).toContain('"topicKey" VARCHAR(160) NOT NULL');
    expect(migration).toContain('length(btrim("topicKey")) > 0');
    expect(migration).toContain(
      'CREATE INDEX "ContentOpportunity_project_topic_created_idx"\nON "ContentOpportunity"("projectId", "topicKey", "createdAt")'
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ContentOpportunity_identity_key"\nON "ContentOpportunity"("projectId", "candidateKey", "inputFingerprint", "scoringVersion")'
    );
    expect(migration).not.toMatch(
      /CREATE UNIQUE INDEX[^;]+"ContentOpportunity"\("projectId", "topicKey"/s
    );
    expect(migration).not.toMatch(
      /CREATE UNIQUE INDEX[^;]+"ContentOpportunity"\("topicKey"/s
    );
  });

  it("requires non-empty semantic and version identifiers", () => {
    expect(migration).toContain("ContentOpportunity_text_check");
    expect(migration).toContain('length(btrim("scoringVersion")) > 0');
    expect(migration).toContain('length(btrim("topicKey")) > 0');
    expect(migration).toContain("^[0-9a-f]{64}$");
  });

  it("links each opportunity to project-scoped DevelopmentEvents without duplicates", () => {
    const link = modelBlock("ContentOpportunityDevelopmentEvent");
    expect(link).toContain("@@unique([contentOpportunityId, developmentEventId])");
    expect(link).toMatch(/developmentEvent\s+DevelopmentEvent[\s\S]*onDelete: Restrict/);
    expect(migration).toContain("validate_content_opportunity_event");
    expect(migration).toContain('opportunity."projectId" = event."projectId"');
  });

  it("stores bounded normalized reason signals linked only to opportunity provenance", () => {
    const signal = modelBlock("ContentOpportunityReasonSignal");
    expect(signal).not.toContain("Json");
    expect(signal).toContain("@@unique([contentOpportunityId, code])");
    expect(signal).toContain("@@unique([contentOpportunityId, position])");
    expect(migration).toContain("ContentOpportunityReasonSignal_value_check");
    expect(migration).toContain("ContentOpportunityReasonSignal_position_check");
    expect(migration).toContain("validate_content_opportunity_reason_signal_event");
    expect(migration).toContain(
      'opportunity_event."developmentEventId" = NEW."developmentEventId"'
    );
  });

  it("cascades Project deletion while preventing detached event provenance", () => {
    expect(migration).toMatch(
      /ContentOpportunity_projectId_fkey[\s\S]*?ON DELETE CASCADE/
    );
    expect(migration).toMatch(
      /ContentOpportunityDevelopmentEvent_eventId_fkey[\s\S]*?ON DELETE RESTRICT/
    );
    expect(migration).toMatch(
      /ContentOpportunityReasonSignalEvent_eventId_fkey[\s\S]*?ON DELETE RESTRICT/
    );
  });

  it("enables owner-only RLS and denies authenticated direct writes", () => {
    for (const table of [
      "ContentOpportunity",
      "ContentOpportunityDevelopmentEvent",
      "ContentOpportunityReasonSignal",
      "ContentOpportunityReasonSignalEvent",
    ]) {
      expect(migration).toContain(
        `REVOKE ALL ON TABLE public."${table}" FROM PUBLIC, anon, authenticated`
      );
      expect(migration).toContain(`GRANT SELECT ON TABLE public."${table}" TO authenticated`);
      expect(migration).toContain(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration.match(/"Project"\."userId" = \(SELECT auth\.uid\(\)\)/g)).toHaveLength(4);
    expect(migration).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL) TO authenticated/);
    expect(migration).not.toContain("FORCE ROW LEVEL SECURITY");
  });

  it("contains no raw provider content, model payload, or destructive migration operation", () => {
    const persistedShape = [
      modelBlock("ContentOpportunity"),
      modelBlock("ContentOpportunityReasonSignal"),
      modelBlock("ContentOpportunityReasonSignalEvent"),
    ].join("\n");
    expect(persistedShape).not.toMatch(
      /commitMessage|pullRequestTitle|pullRequestBody|filePath|sourceCode|rawPayload|providerPayload|prompt|response|patch|diff|token|credential/i
    );
    expect(migration).not.toMatch(/DELETE FROM|DROP TABLE|TRUNCATE/i);
  });
});
