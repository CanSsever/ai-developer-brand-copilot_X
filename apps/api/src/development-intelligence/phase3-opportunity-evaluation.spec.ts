import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getPhase3DevelopmentScenarios,
  phase3OpportunityPinnedFingerprints,
  type Phase3EvaluationObservation,
} from "@developer-brand-copilot/ai";
import { describe, expect, it } from "vitest";
import { parsePhase3EvaluationCliArguments } from "./phase3-opportunity-evaluation.cli";
import {
  adaptPhase3ScenarioToCanonicalInput,
  adaptPhase3ScenarioToOracleCandidate,
  blankPhase3HeldOutReviewManifest,
  evaluatePhase3DevelopmentScenario,
  phase3HeldOutReviewManifestVersion,
  phase3OpportunityEvaluationReportVersion,
  phase3ScorerOnlyLimitation,
  runPhase3DevelopmentScorerEvaluation,
  validatePhase3HeldOutReviewManifest,
  validatePhase3ObservationCompleteness,
  type Phase3HeldOutReviewEntry,
  type Phase3HeldOutReviewManifest,
  type Phase3ProducedObservation,
} from "./phase3-opportunity-evaluation";
import { fingerprintPhase3OpportunityInput } from "./phase3-opportunity-input";
import { phase3OpportunityScoringVersion, scorePhase3OpportunityCandidates } from "./phase3-opportunity-scoring";

const heldOutIds = Array.from({ length: 20 }, (_, index) =>
  `phase3-scenario-${String(index + 81).padStart(3, "0")}`);

async function report() {
  const rubricText = await readFile(resolve(process.cwd(), "../../docs/product/PHASE_3_EVALUATION_CORPUS.md"), "utf8");
  return runPhase3DevelopmentScorerEvaluation({ rubricText, gitSha: "test-sha" });
}

function noOpportunity(scenarioId: string): Phase3EvaluationObservation {
  return {
    scenarioId,
    duplicateSuppressed: null,
    linkedDevelopmentEventIds: [],
    noveltyScore: null,
    opportunityType: null,
    reasonSignalCodes: [],
    recommendedFormat: null,
    releaseMilestoneExceptionApplied: null,
    shouldPost: null,
    status: null,
    topicKey: null,
  };
}

function agreed(scenarioId: string): Phase3HeldOutReviewEntry {
  return { scenarioId, secondReviewStatus: "agreed", disagreement: false, adjudicatedExpected: null };
}

describe("Task 3.9A Phase 3 development evaluation framework", () => {
  it("preserves all five frozen pins and evaluates exactly development IDs 001-080", async () => {
    const result = await report();
    expect(result.reportVersion).toBe(phase3OpportunityEvaluationReportVersion);
    expect(result.pins.passed).toBe(true);
    expect(result.pins.actual).toEqual(phase3OpportunityPinnedFingerprints);
    expect(result.scenarioCount).toBe(80);
    expect(result.scenarioIds).toEqual(Array.from({ length: 80 }, (_, index) =>
      `phase3-scenario-${String(index + 1).padStart(3, "0")}`));
    expect(result.scenarioIds.some((id) => heldOutIds.includes(id))).toBe(false);
  });

  it("has no executable held-out CLI mode and rejects held-out development helper access", () => {
    expect(parsePhase3EvaluationCliArguments([])).toEqual({ outputPath: null });
    expect(() => parsePhase3EvaluationCliArguments(["--split", "held-out", "--release"])).toThrow(/Unsupported/);
    expect(() => evaluatePhase3DevelopmentScenario("phase3-scenario-081")).toThrow(/development scenario/);
  });

  it("rejects missing, duplicate, extra, unknown, mismatched, and wrong-split observations", () => {
    const scenarios = getPhase3DevelopmentScenarios().slice(0, 2);
    const valid: Phase3ProducedObservation[] = scenarios.map((scenario) => ({
      scenarioId: scenario.id,
      split: "development",
      observation: noOpportunity(scenario.id),
    }));
    expect(() => validatePhase3ObservationCompleteness(scenarios, valid, "development")).not.toThrow();
    expect(() => validatePhase3ObservationCompleteness(scenarios, valid.slice(0, 1), "development")).toThrow(/missing/);
    expect(() => validatePhase3ObservationCompleteness(scenarios, [valid[0]!, valid[0]!], "development")).toThrow(/duplicate/);
    expect(() => validatePhase3ObservationCompleteness(scenarios, [...valid, {
      scenarioId: "phase3-scenario-999", split: "development", observation: noOpportunity("phase3-scenario-999"),
    }], "development")).toThrow(/unknown_or_extra/);
    expect(() => validatePhase3ObservationCompleteness(scenarios, [{
      ...valid[0]!, observation: noOpportunity(scenarios[1]!.id),
    }, valid[1]!], "development")).toThrow(/observation_id_mismatch/);
    expect(() => validatePhase3ObservationCompleteness(scenarios, [{ ...valid[0]!, split: "held_out" }, valid[1]!], "development")).toThrow(/wrong_split/);
  });

  it("preserves no-opportunity, suppressed, and visible outcome semantics", async () => {
    const result = await report();
    expect(new Set(result.outcomes.map((row) => row.outcome))).toEqual(new Set(["no_opportunity", "suppressed", "visible"]));
    expect(result.outcomes.filter((row) => row.outcome === "no_opportunity").every((row) => row.shouldPost === null && row.status === null)).toBe(true);
    expect(result.outcomes.filter((row) => row.outcome === "suppressed").every((row) => row.shouldPost === false && row.status === "suppressed")).toBe(true);
    expect(result.outcomes.filter((row) => row.outcome === "visible").every((row) => row.shouldPost === true && row.status === "recommended")).toBe(true);
  });

  it("uses the production scorer twice and produces stable nonempty provenance-bound visible reasons", async () => {
    const result = await report();
    expect(result.scoringVersion).toBe(phase3OpportunityScoringVersion);
    expect(result.reasonDigests.length).toBe(result.outcomes.filter((row) => row.outcome === "visible").length);
    expect(result.reasonDigests.every((row) => row.reasonCount > 0 && /^sha256:[0-9a-f]{64}$/.test(row.digest))).toBe(true);
    expect(result.gates.visibleReasonReproducibility).toBe(true);
    expect(result.gates.visibleReasonsNonEmptyAndProvenanceValid).toBe(true);
  });

  it("passes duplicate and shouldPost=false behavior gates", async () => {
    const result = await report();
    expect(result.gates.duplicateSuppressionBehavior).toBe(true);
    expect(result.gates.shouldPostFalseBehavior).toBe(true);
    expect(result.metrics.duplicateSuppressionAccuracy).not.toBeNull();
    expect(result.metrics.shouldPostAccuracy).not.toBeNull();
  });

  it("covers confidence, novelty, and release-exception boundaries through the real scorer", () => {
    const at059 = evaluatePhase3DevelopmentScenario("phase3-scenario-062").decision!;
    const at060 = evaluatePhase3DevelopmentScenario("phase3-scenario-063").decision!;
    const novelty035 = evaluatePhase3DevelopmentScenario("phase3-scenario-070").decision!;
    const repeatedRelease = evaluatePhase3DevelopmentScenario("phase3-scenario-051").decision!;
    expect(at059.confidence).toBe(0.59);
    expect(at059.shouldPost).toBe(false);
    expect(at060.confidence).toBe(0.6);
    expect(at060.reasons.map((reason) => reason.code)).not.toContain("low_confidence");
    expect(novelty035.noveltyScore).toBeGreaterThanOrEqual(0.35);
    expect(repeatedRelease.releaseMilestoneExceptionApplied).toBe(true);
    expect(repeatedRelease.noveltyScore).toBeLessThan(0.35);
    expect(repeatedRelease.duplicateSuppressed).toBe(true);
    expect(repeatedRelease.shouldPost).toBe(false);

    const releaseScenario = getPhase3DevelopmentScenarios().find((scenario) => scenario.id === "phase3-scenario-051")!;
    const baseInput = adaptPhase3ScenarioToCanonicalInput(releaseScenario);
    const lowConfidenceInput = {
      ...baseInput,
      developmentEvents: baseInput.developmentEvents.map((event) => ({ ...event, confidence: 0.59 })),
      opportunityHistory: baseInput.opportunityHistory.map((history) => ({ ...history, status: "suppressed" as const })),
    };
    const lowConfidenceCandidate = adaptPhase3ScenarioToOracleCandidate(releaseScenario)
      .map((candidate) => ({ ...candidate, confidence: 0.59 }));
    const lowConfidenceRelease = scorePhase3OpportunityCandidates(
      lowConfidenceInput,
      lowConfidenceCandidate,
      { resultId: "confidence-exception", extractionVersion: "test", detectorVersion: "test", modelConfigurationFingerprint: "a".repeat(64) },
      fingerprintPhase3OpportunityInput(lowConfidenceInput),
    )[0]!;
    expect(lowConfidenceRelease.releaseMilestoneExceptionApplied).toBe(true);
    expect(lowConfidenceRelease.duplicateSuppressed).toBe(false);
    expect(lowConfidenceRelease.confidence).toBe(0.59);
    expect(lowConfidenceRelease.shouldPost).toBe(false);
  });

  it("projects a deterministic what/format/why/provenance answer without Phase 4 content", async () => {
    const answer = (await report()).offlineAnswer;
    expect(answer.what).toMatch(/Synthetic validated opportunity/);
    expect(answer.opportunityType).toBeTruthy();
    expect(answer.recommendedFormat).toBeTruthy();
    expect(answer.reasons.length).toBeGreaterThan(0);
    expect(answer.supportingDevelopmentEvents.length).toBeGreaterThan(0);
    expect(Object.keys(answer)).not.toContain("draft");
    expect(JSON.stringify(answer)).not.toMatch(/generatedPost|postCopy|publication/i);
  });

  it("keeps scorer-only precision conditional and final detector-inclusive precision false", async () => {
    const result = await report();
    expect(result.evaluationScope).toBe("scorer_only");
    expect(result.precisionClassification).toBe(phase3ScorerOnlyLimitation);
    expect(result.metrics.precisionGateSatisfied).toBe(true);
    expect(result.gates.scorerOnlyPrecisionReported).toBe(true);
    expect(result.gates.finalDetectorInclusivePrecisionSatisfied).toBe(false);
    expect(result.gates.finalPhase3ExitSatisfied).toBe(false);
  });

  it("validates future held-out review coverage without fabricating completion", () => {
    const failures = heldOutIds.slice(0, 2);
    const passing = heldOutIds.slice(2);
    const blank = validatePhase3HeldOutReviewManifest(blankPhase3HeldOutReviewManifest, failures, passing);
    expect(blank.valid).toBe(false);
    expect(blank.finalExitEligible).toBe(false);
    expect(blank.errors).toContain(`failure_not_reviewed:${failures[0]}`);
    expect(blank.requiredPassingReviews).toBe(Math.ceil(passing.length * 0.2));

    const reviews = [...failures.map(agreed), ...passing.slice(0, blank.requiredPassingReviews).map(agreed)];
    const manifest: Phase3HeldOutReviewManifest = {
      manifestVersion: phase3HeldOutReviewManifestVersion,
      corpusVersion: blankPhase3HeldOutReviewManifest.corpusVersion,
      heldOutFingerprint: blankPhase3HeldOutReviewManifest.heldOutFingerprint,
      reviews,
    };
    expect(validatePhase3HeldOutReviewManifest(manifest, failures, passing)).toMatchObject({ valid: true, finalExitEligible: true });

    const expected = getPhase3DevelopmentScenarios()[0]!.expected;
    const disagreement: Phase3HeldOutReviewManifest = {
      ...manifest,
      reviews: [{ scenarioId: failures[0]!, secondReviewStatus: "disagreed", disagreement: true, adjudicatedExpected: null }, ...reviews.slice(1)],
    };
    expect(validatePhase3HeldOutReviewManifest(disagreement, failures, passing).errors)
      .toContain(`unadjudicated_disagreement:${failures[0]}`);
    const adjudicated: Phase3HeldOutReviewManifest = {
      ...manifest,
      reviews: [{ scenarioId: failures[0]!, secondReviewStatus: "adjudicated", disagreement: true, adjudicatedExpected: expected }, ...reviews.slice(1)],
    };
    expect(validatePhase3HeldOutReviewManifest(adjudicated, failures, passing).valid).toBe(true);
  });

  it("emits a safe deterministic report without secret, provider-payload, or raw-source fields", async () => {
    const result = await report();
    const keys: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (typeof value !== "object" || value === null) return;
      for (const [key, child] of Object.entries(value)) { keys.push(key); visit(child); }
    };
    visit(result);
    expect(keys).not.toEqual(expect.arrayContaining([
      "DATABASE_URL", "DIRECT_URL", "apiKey", "password", "prompt", "providerResponse", "rawSource", "rawEvidence",
    ]));
    expect(result.feedbackPersistenceEvidence).toMatchObject({
      commit: "7518d396b94c8b80cf0363c795d0840986e3edee",
      migration: "20260925100000_add_opportunity_feedback",
      hostedCi: "#30 exact SHA success",
      taskStatus: "DELIVERY COMPLETE",
    });
  });
});
