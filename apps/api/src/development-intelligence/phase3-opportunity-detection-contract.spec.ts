import { describe, expect, it } from "vitest";

import {
  opportunityDetectionBounds,
  opportunityDetectionSchema,
  parseOpportunityDetectionResult,
} from "@developer-brand-copilot/ai";
import {
  contentOpportunityRecommendedFormats,
  contentOpportunityTypes,
} from "@developer-brand-copilot/contracts";

const eventIds = new Set(["event-a", "event-b", "event-unused"]);

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    eventIds: ["event-a"],
    opportunityType: "progress_update",
    title: "Synthetic delivery",
    recommendedFormat: "short_update",
    topicDescriptor: "synthetic deployment pipeline",
    confidence: 0.73456789,
    ...overrides,
  };
}

function parse(candidates: readonly unknown[], supplied = eventIds) {
  return parseOpportunityDetectionResult(JSON.stringify({ candidates }), supplied);
}

describe("Phase 3 opportunity detection contract", () => {
  it("accepts zero candidates as a valid result", () => {
    expect(parse([])).toEqual({ errors: [], value: [] });
  });

  it("accepts one candidate and preserves its exact valid confidence", () => {
    const result = parse([candidate()]);
    expect(result.errors).toEqual([]);
    expect(result.value?.[0]?.confidence).toBe(0.73456789);
  });

  it("accepts multiple independent candidates without forcing unused events into provenance", () => {
    const result = parse([
      candidate({ eventIds: ["event-b"], opportunityType: "technical_insight", topicDescriptor: "build caching" }),
      candidate({ eventIds: ["event-a"], opportunityType: "feature_showcase", topicDescriptor: "new deployment panel" }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.value).toHaveLength(2);
    expect(result.value?.flatMap((item) => item.eventIds)).not.toContain("event-unused");
  });

  it.each(contentOpportunityTypes)("accepts approved opportunity type %s", (opportunityType) => {
    expect(parse([candidate({ opportunityType })]).value?.[0]?.opportunityType).toBe(opportunityType);
  });

  it.each(contentOpportunityRecommendedFormats)("accepts approved recommended format %s", (recommendedFormat) => {
    expect(parse([candidate({ recommendedFormat })]).value?.[0]?.recommendedFormat).toBe(recommendedFormat);
  });

  it.each([0, 1])("accepts detector confidence boundary %s", (confidence) => {
    expect(parse([candidate({ confidence })]).value?.[0]?.confidence).toBe(confidence);
  });

  it.each([-0.0001, 1.0001, Number.NaN, Number.POSITIVE_INFINITY, "0.5"])("rejects invalid detector confidence %s", (confidence) => {
    expect(parse([candidate({ confidence })]).value).toBeNull();
    expect(parse([candidate({ confidence })]).errors).toContain("invalid_confidence");
  });

  it("rejects empty or oversized event sets", () => {
    expect(parse([candidate({ eventIds: [] })]).errors).toContain("invalid_event_ids");
    expect(parse([candidate({ eventIds: Array.from({ length: opportunityDetectionBounds.eventIdsPerCandidate + 1 }, (_, index) => `event-${index}`) })]).errors).toContain("invalid_event_ids");
  });

  it("rejects duplicate and invented event references rather than dropping them", () => {
    expect(parse([candidate({ eventIds: ["event-a", "event-a"] })]).errors).toContain("duplicate_event_id");
    expect(parse([candidate({ eventIds: ["event-a", "invented"] })]).errors).toContain("unsupported_event_id");
    expect(parse([candidate({ eventIds: ["invented"] })]).value).toBeNull();
  });

  it("cannot use ProjectState feature IDs or OpportunityHistory IDs as candidate provenance", () => {
    expect(parse([candidate({ eventIds: ["state-feature-id"] })]).errors).toContain("unsupported_event_id");
    expect(parse([candidate({ eventIds: ["prior-opportunity-id"] })]).errors).toContain("unsupported_event_id");
    expect(parse([candidate({ eventIds: ["feature-safe-id"] })]).errors).toContain("unsupported_event_id");
  });

  it("rejects malformed semantic text and unsupported taxonomy values", () => {
    expect(parse([candidate({ title: "   " })]).errors).toContain("invalid_title");
    expect(parse([candidate({ topicDescriptor: "" })]).errors).toContain("invalid_topic_descriptor");
    expect(parse([candidate({ title: "t".repeat(opportunityDetectionBounds.titleCharacters + 1) })]).errors).toContain("invalid_title");
    expect(parse([candidate({ topicDescriptor: "t".repeat(opportunityDetectionBounds.topicDescriptorCharacters + 1) })]).errors).toContain("invalid_topic_descriptor");
    expect(parse([candidate({ opportunityType: "blog_post" })]).errors).toContain("invalid_opportunity_type");
    expect(parse([candidate({ recommendedFormat: "thread" })]).errors).toContain("invalid_recommended_format");
  });

  it("enforces the candidate count bound in application validation", () => {
    const atBound = Array.from({ length: opportunityDetectionBounds.candidates }, (_, index) => candidate({ title: `Candidate ${index}` }));
    expect(parse(atBound).value).toHaveLength(opportunityDetectionBounds.candidates);
    const distinct = Array.from({ length: opportunityDetectionBounds.candidates + 1 }, (_, index) => candidate({ eventIds: ["event-a"], title: `Candidate ${index}` }));
    expect(parse(distinct).errors).toContain("invalid_candidate_count");
  });

  it("rejects exact duplicate structured candidate rows", () => {
    expect(parse([candidate(), candidate()])).toEqual({ errors: ["duplicate_candidate"], value: null });
  });

  it("rejects extra root and candidate fields and never exposes topicKey identity", () => {
    expect(parse([candidate({ shouldPost: true })]).errors).toContain("unknown_candidate_field");
    expect(parse([{ ...candidate(), topicKey: "final-key" }]).value).toBeNull();
    expect(parse([{ candidates: [] } as unknown as unknown]).value).toBeNull();
  });

  it("canonicalizes candidate order and event reference order deterministically", () => {
    const first = parse([
      candidate({ eventIds: ["event-b", "event-a"], topicDescriptor: "z-topic" }),
      candidate({ eventIds: ["event-b"], topicDescriptor: "a-topic" }),
    ]);
    const second = parse([
      candidate({ eventIds: ["event-b"], topicDescriptor: "a-topic" }),
      candidate({ eventIds: ["event-a", "event-b"], topicDescriptor: "z-topic" }),
    ]);
    expect(first.value).toEqual(second.value);
    expect(first.value?.[0]?.eventIds).toEqual(["event-a", "event-b"]);
  });

  it("uses only the strict Structured Outputs schema subset", () => {
    const serialized = JSON.stringify(opportunityDetectionSchema);
    expect(opportunityDetectionSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["candidates"],
    });
    expect(serialized).not.toMatch(/"uniqueItems"|"allOf"|"not"|"dependentRequired"|"dependentSchemas"|"if"|"then"|"else"|"nullable"|"patternProperties"/);
  });
});
