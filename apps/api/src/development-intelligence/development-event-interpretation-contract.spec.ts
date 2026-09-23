import { describe, expect, it } from "vitest";
import {
  developmentEventInterpretationSchema,
  parseDevelopmentEventInterpretation,
} from "@developer-brand-copilot/ai";
import {
  developmentEventTypes,
  type DevelopmentEventType,
} from "@developer-brand-copilot/contracts";

const commitIds = new Set(["commit-1"]);
const pullRequestIds = new Set(["pr-1"]);

function output(
  type: DevelopmentEventType,
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    decision: "event",
    event: {
      type,
      title: "Synthetic interpreted outcome",
      summary: "Synthetic evidence-grounded interpretation.",
      importanceScore: 0.5,
      contentPotentialScore: 0.4,
      confidence: 0.8,
      relatedFeatureIds: [],
      technologies: [],
      evidenceRefs: {
        commitIds: ["commit-1"],
        pullRequestIds: ["pr-1"],
      },
      ...overrides,
    },
    reason: null,
  });
}

describe("development event interpretation contract", () => {
  it.each(developmentEventTypes)("accepts the exact PDR taxonomy value %s", (type) => {
    const parsed = parseDevelopmentEventInterpretation(
      output(type),
      commitIds,
      pullRequestIds
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.value).toMatchObject({ decision: "event", event: { type } });
  });

  it("rejects unknown fields even when JSON is otherwise valid", () => {
    const parsed = parseDevelopmentEventInterpretation(
      output("feature_completed", { shouldPost: true }),
      commitIds,
      pullRequestIds
    );
    expect(parsed.value).toBeNull();
    expect(parsed.errors).toContain("unknown_event_field");
  });

  it("rejects out-of-range scores", () => {
    const parsed = parseDevelopmentEventInterpretation(
      output("feature_completed", { confidence: 1.1 }),
      commitIds,
      pullRequestIds
    );
    expect(parsed.errors).toContain("invalid_confidence");
  });

  it("normalizes and deterministically orders technology labels", () => {
    const parsed = parseDevelopmentEventInterpretation(
      output("feature_completed", {
        technologies: ["TypeScript", "NestJS", "TypeScript"],
      }),
      commitIds,
      pullRequestIds
    );
    expect(parsed.value).toMatchObject({
      event: { technologies: ["NestJS", "TypeScript"] },
    });
  });

  it("rejects duplicate evidence references after provider-side uniqueItems removal", () => {
    const parsed = parseDevelopmentEventInterpretation(
      output("feature_completed", {
        evidenceRefs: { commitIds: ["commit-1", "commit-1"], pullRequestIds: [] },
      }),
      commitIds,
      pullRequestIds
    );
    expect(parsed.errors).toContain("duplicate_evidence_ref");
  });

  it("accepts only allowlisted feature-completion relations", () => {
    const allowed = new Set(["feature-1"]);
    expect(
      parseDevelopmentEventInterpretation(
        output("feature_completed", { relatedFeatureIds: ["feature-1"] }),
        commitIds,
        pullRequestIds,
        allowed
      ).value
    ).toMatchObject({ event: { relatedFeatureIds: ["feature-1"] } });
    expect(
      parseDevelopmentEventInterpretation(
        output("feature_completed", { relatedFeatureIds: ["invented-feature"] }),
        commitIds,
        pullRequestIds,
        allowed
      ).errors
    ).toContain("unsupported_related_feature_id");
  });

  it("keeps title, summary, and technology limits in deterministic application validation", () => {
    const parsed = parseDevelopmentEventInterpretation(
      output("feature_completed", {
        title: "t".repeat(161),
        summary: "s".repeat(1_201),
        technologies: ["x".repeat(501)],
      }),
      commitIds,
      pullRequestIds
    );
    expect(parsed.value).toBeNull();
    expect(parsed.errors).toEqual(expect.arrayContaining([
      "invalid_title",
      "invalid_summary",
      "invalid_technologies",
    ]));
  });

  it("uses only the intended strict Structured Outputs subset", () => {
    const serialized = JSON.stringify(developmentEventInterpretationSchema);
    expect(developmentEventInterpretationSchema).toMatchObject({
      additionalProperties: false,
      required: ["decision", "event", "reason"],
      type: "object",
    });
    expect(serialized).toMatch(/"anyOf"/);
    expect(serialized).toMatch(/"additionalProperties":false/);
    expect(serialized).not.toMatch(
      /"uniqueItems"|"allOf"|"not"|"dependentRequired"|"dependentSchemas"|"if"|"then"|"else"|"nullable"|"patternProperties"/
    );
  });
});
