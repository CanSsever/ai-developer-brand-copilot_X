import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contentOpportunityReasonCodes, contentOpportunityRecommendedFormats, contentOpportunityTypes, developmentEventTypes,
} from "@developer-brand-copilot/contracts";
import {
  getPhase3DevelopmentScenarios, getPhase3HeldOutScenarios, getPhase3ScenarioDistribution,
  fingerprintPhase3Scenarios, getPhase3FullCorpusForAudit,
  phase3OpportunityCorpusVersion, phase3OpportunityExpectedContractVersion, phase3OpportunityRubricVersion,
  phase3OpportunityFingerprints, phase3OpportunityPinnedFingerprints,
  scorePhase3DevelopmentEvaluation, scorePhase3HeldOutEvaluation, validatePhase3OpportunityCorpus,
  type Phase3EvaluationObservation, type Phase3OpportunityScenario,
} from "@developer-brand-copilot/ai";

function observation(scenario: Phase3OpportunityScenario): Phase3EvaluationObservation {
  const expected = scenario.expected;
  return {
    duplicateSuppressed: expected.duplicateExpectation === "duplicate" && !expected.releaseMilestoneExceptionApplies,
    linkedDevelopmentEventIds: expected.linkedDevelopmentEventIds,
    noveltyScore: expected.noveltyExpectation === "below_0_35" ? 0.34 : expected.noveltyExpectation === "at_or_above_0_35" ? 0.35 : null,
    opportunityType: expected.opportunityType, reasonSignalCodes: [...expected.positiveReasonSignalCodes, ...expected.negativeReasonSignalCodes], recommendedFormat: expected.recommendedFormat,
    releaseMilestoneExceptionApplied: expected.releaseMilestoneExceptionApplies, scenarioId: scenario.id, shouldPost: expected.shouldPost,
    status: expected.status, topicKey: expected.topicKey,
  };
}

describe("Phase 3 synthetic evaluation corpus", () => {
  const fullCorpus = getPhase3FullCorpusForAudit();

  it("freezes identity, exactly 100 unique ordered IDs, and the 80/20 split", () => {
    expect(phase3OpportunityCorpusVersion).toBe("phase3-opportunity-v1");
    expect(phase3OpportunityRubricVersion).toBe("phase3-review-rubric-v1");
    expect(phase3OpportunityExpectedContractVersion).toBe("content-opportunity-v1");
    expect(fullCorpus).toHaveLength(100);
    expect(new Set(fullCorpus.map((s) => s.id)).size).toBe(100);
    expect(fullCorpus.map((s) => s.id)).toEqual(Array.from({ length: 100 }, (_, i) => `phase3-scenario-${String(i + 1).padStart(3, "0")}`));
    expect(getPhase3DevelopmentScenarios()).toHaveLength(80);
    expect(getPhase3HeldOutScenarios()).toHaveLength(20);
    expect(getPhase3DevelopmentScenarios().every((s) => s.split === "development")).toBe(true);
    expect(getPhase3HeldOutScenarios().every((s) => s.split === "held_out")).toBe(true);
    expect(validatePhase3OpportunityCorpus()).toEqual([]);
  });

  it("pins complete, development, held-out, contract, and rubric content fingerprints", async () => {
    expect(phase3OpportunityFingerprints.complete).toBe(phase3OpportunityPinnedFingerprints.complete);
    expect(phase3OpportunityFingerprints.development).toBe(phase3OpportunityPinnedFingerprints.development);
    expect(phase3OpportunityFingerprints.heldOut).toBe(phase3OpportunityPinnedFingerprints.heldOut);
    expect(phase3OpportunityFingerprints.contract).toBe(phase3OpportunityPinnedFingerprints.contract);
    expect(fingerprintPhase3Scenarios(fullCorpus)).toBe(phase3OpportunityFingerprints.complete);
    expect(fingerprintPhase3Scenarios(getPhase3DevelopmentScenarios())).toBe(phase3OpportunityFingerprints.development);
    expect(fingerprintPhase3Scenarios(getPhase3HeldOutScenarios())).toBe(phase3OpportunityFingerprints.heldOut);
    const rubricText = await readFile(resolve(process.cwd(), "../../docs/product/PHASE_3_EVALUATION_CORPUS.md"), "utf8");
    const normalizedRubric = rubricText.replace(/\r\n?/g, "\n");
    const rubricDigest = "sha256:" + createHash("sha256").update(normalizedRubric, "utf8").digest("hex");
    expect(rubricDigest).toBe(phase3OpportunityPinnedFingerprints.rubric);
  });

  it("detects semantic fixture edits, preserves canonical object ordering, and pins scenario ordering", () => {
    const sample = fullCorpus[0]!;
    const expectedEdit = { ...sample, expected: { ...sample.expected, visible: !sample.expected.visible } };
    const inputEdit = {
      ...sample,
      input: { ...sample.input, events: sample.input.events.map((event, index) => index === 0 ? { ...event, summary: event.summary + " edited" } : event) },
    };
    expect(fingerprintPhase3Scenarios([expectedEdit])).not.toBe(fingerprintPhase3Scenarios([sample]));
    expect(fingerprintPhase3Scenarios([inputEdit])).not.toBe(fingerprintPhase3Scenarios([sample]));
    const reordered = {
      ...Object.fromEntries(Object.entries(sample).reverse()),
      expected: Object.fromEntries(Object.entries(sample.expected).reverse()),
      input: Object.fromEntries(Object.entries(sample.input).reverse()),
    } as unknown as Phase3OpportunityScenario;
    expect(fingerprintPhase3Scenarios([reordered])).toBe(fingerprintPhase3Scenarios([sample]));
    expect(fingerprintPhase3Scenarios([...fullCorpus].reverse())).not.toBe(phase3OpportunityFingerprints.complete);
    expect(Object.isFrozen(fullCorpus)).toBe(true);
    expect(Object.isFrozen(sample.expected)).toBe(true);
    const heldOut = getPhase3HeldOutScenarios();
    const alteredHeldOut = [...heldOut];
    const last = alteredHeldOut[0]!;
    alteredHeldOut[0] = { ...last, expected: { ...last.expected, topicKey: (last.expected.topicKey ?? "no-topic") + "-edited" } };
    expect(fingerprintPhase3Scenarios(alteredHeldOut)).not.toBe(phase3OpportunityFingerprints.heldOut);
  });

  it("keeps categories below 30% and deliberately covers approved taxonomies and outcomes", () => {
    expect(getPhase3ScenarioDistribution()).toEqual({
      adversarial_format: 10, automation: 10, confidence: 10, duplicate_repetition: 10, eligibility_noise: 10,
      exceptions: 10, multi_event: 10, normal: 10, novelty_window: 10, strong: 10,
    });
    expect(Object.values(getPhase3ScenarioDistribution()).every((count) => count <= 30)).toBe(true);
    const opportunities = fullCorpus.filter((s) => s.expected.opportunityExpected);
    expect(new Set(opportunities.map((s) => s.expected.opportunityType))).toEqual(new Set(contentOpportunityTypes));
    expect(new Set(opportunities.map((s) => s.expected.recommendedFormat))).toEqual(new Set(contentOpportunityRecommendedFormats));
    expect(new Set(opportunities.flatMap((s) => [...s.expected.positiveReasonSignalCodes, ...s.expected.negativeReasonSignalCodes]))).toEqual(new Set(contentOpportunityReasonCodes));
    expect(fullCorpus.some((s) => s.expected.visible)).toBe(true);
    expect(fullCorpus.some((s) => s.expected.status === "suppressed")).toBe(true);
    expect(fullCorpus.some((s) => !s.expected.opportunityExpected)).toBe(true);
    expect(new Set(fullCorpus.flatMap((s) => s.input.events.map((e) => e.type)))).toEqual(new Set(developmentEventTypes));
  });

  it("covers confidence, novelty, duplicate, exception, coherence, and review boundaries", () => {
    const at059 = fullCorpus.find((s) => s.id === "phase3-scenario-062")!;
    const at060 = fullCorpus.find((s) => s.id === "phase3-scenario-063")!;
    expect(at059.input.events[0]?.confidence).toBe(0.59);
    expect(at059.expected.visible).toBe(false);
    expect(at060.input.events[0]?.confidence).toBe(0.6);
    expect(at060.expected.visible).toBe(true);
    expect(fullCorpus.some((s) => s.input.events[0]?.confidence === 0.599)).toBe(true);
    expect(fullCorpus.some((s) => s.id === "phase3-scenario-070")).toBe(true);
    expect(fullCorpus.some((s) => s.input.recentContentOpportunities.some((h) => h.createdDeveloperDay === "2025-12-31"))).toBe(true);
    expect(fullCorpus.some((s) => s.expected.duplicateExpectation === "duplicate")).toBe(true);
    expect(fullCorpus.some((s) => s.expected.releaseMilestoneExceptionApplies && s.expected.noveltyExpectation === "below_0_35")).toBe(true);
    expect(fullCorpus.every((s) => s.review.initialExpected === s.expected && s.review.secondReviewStatus === "not_started" && s.review.disagreement === null && s.review.adjudicatedExpected === null)).toBe(true);
  });

  it("judges automated work by its semantic value rather than rejecting it by origin", () => {
    const automated = fullCorpus.filter((s) => s.input.events.some((event) => event.automationInvolved));
    expect(automated.length).toBeGreaterThan(0);
    expect(automated.some((s) => s.expected.visible)).toBe(true);
    expect(automated.some((s) => s.expected.status === "suppressed" || !s.expected.opportunityExpected)).toBe(true);
  });

  it("computes visible TP/FP/FN and separates persisted suppression from visibility", () => {
    const development = getPhase3DevelopmentScenarios();
    const expectedVisible = development.find((s) => s.expected.visible)!;
    const expectedNoCandidate = development.find((s) => !s.expected.opportunityExpected)!;
    const changed = development.map(observation).map((o) => o.scenarioId === expectedVisible.id
      ? { ...o, status: "suppressed" as const }
      : o.scenarioId === expectedNoCandidate.id ? { ...o, shouldPost: true, status: "recommended" as const } : o);
    const report = scorePhase3DevelopmentEvaluation(changed);
    expect(report.scenarioCount).toBe(80);
    expect(report.heldOut).toBe(false);
    expect(report.visibleFalseNegatives).toBe(1);
    expect(report.visibleFalsePositives).toBe(1);
    expect(report.visibleTruePositives).toBe(report.visibleOpportunitiesExpected - 1);
    expect(report.visiblePrecision).toBe(report.visibleTruePositives / (report.visibleTruePositives + 1));
    expect(report.falsePositives).toBe(1);
    expect(report.expectedSuppressedScenarios).toBeGreaterThan(0);
    expect(report.expectedNoOpportunityScenarios).toBeGreaterThan(0);
    expect(report.predictedSuppressedScenarios).toBeGreaterThan(0);
    expect(report.predictedNoOpportunityScenarios).toBeGreaterThan(0);
  });

  it("compares type, format, reasons, provenance, duplicates, novelty, confidence and exceptions", () => {
    const report = scorePhase3DevelopmentEvaluation(getPhase3DevelopmentScenarios().map(observation));
    expect(report.opportunityTypeAccuracy).toBe(1);
    expect(report.opportunityFormatAccuracy).toBe(1);
    expect(report.reasonSignalPrecision).toBe(1);
    expect(report.reasonSignalRecall).toBe(1);
    expect(report.provenanceAccuracy).toBe(1);
    expect(report.duplicateSuppressionAccuracy).toBe(1);
    expect(report.lowConfidenceWithholdingAccuracy).toBe(1);
    expect(report.noveltyThresholdAccuracy).toBe(1);
    expect(report.releaseMilestoneExceptionAccuracy).toBe(1);
    expect(report.suppressionAccuracy).toBe(1);
    expect(report.shouldPostAccuracy).toBe(1);
    const boundary = observation(fullCorpus.find((s) => s.id === "phase3-scenario-070")!);
    expect(boundary.noveltyScore).toBe(0.35);
  });

  it("penalizes wrong taxonomy, format, reason signals, and event provenance", () => {
    const scenarios = getPhase3DevelopmentScenarios();
    const target = scenarios.find((s) => s.expected.visible)!;
    const changed = scenarios.map(observation).map((o) => o.scenarioId === target.id
      ? { ...o, opportunityType: "release" as const, recommendedFormat: "short_update" as const, reasonSignalCodes: [], linkedDevelopmentEventIds: ["synthetic-unlinked-event"] }
      : o);
    const report = scorePhase3DevelopmentEvaluation(changed);
    expect(report.opportunityTypeAccuracy).toBeLessThan(1);
    expect(report.opportunityFormatAccuracy).toBeLessThan(1);
    expect(report.reasonSignalRecall).toBeLessThan(1);
    expect(report.provenanceAccuracy).toBeLessThan(1);
  });

  it("returns null for zero denominators and applies no hard gate beyond visible precision", () => {
    const emptyVisible = getPhase3DevelopmentScenarios().map((s) => ({ ...observation(s), reasonSignalCodes: [], shouldPost: false, status: s.expected.opportunityExpected ? "suppressed" as const : null }));
    const report = scorePhase3DevelopmentEvaluation(emptyVisible);
    expect(report.visiblePrecision).toBeNull();
    expect(report.precisionGateSatisfied).toBeNull();
    expect(report.reasonSignalPrecision).toBeNull();
    expect(report.precisionGate).toBe(0.75);
  });

  it("requires a separately named held-out scoring call", () => {
    const report = scorePhase3HeldOutEvaluation(getPhase3HeldOutScenarios().map(observation));
    expect(report.scenarioCount).toBe(20);
    expect(report.heldOut).toBe(true);
    expect(report.visiblePrecision).toBe(1);
    expect(scorePhase3DevelopmentEvaluation([]).scenarioCount).toBe(80);
  });
});
