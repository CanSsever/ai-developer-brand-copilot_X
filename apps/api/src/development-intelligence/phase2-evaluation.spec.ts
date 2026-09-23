import { describe, expect, it } from "vitest";
import {
  phase2EvaluationCorpusVersion,
  phase2EvaluationScenarioCount,
  phase2EvaluationScenarios,
  scorePhase2Evaluation,
  type Phase2EvaluationObservation,
} from "@developer-brand-copilot/ai";

function goldenObservations(): readonly Phase2EvaluationObservation[] {
  return phase2EvaluationScenarios.map((scenario) => {
    if (scenario.expected.decision === "insufficient_evidence") {
      return {
        interpretation: {
          decision: "insufficient_evidence" as const,
          event: null,
          reason: scenario.expected.reason,
        },
        scenarioId: scenario.id,
        validationErrors: [],
      };
    }
    return {
      interpretation: {
        decision: "event" as const,
        event: {
          confidence: scenario.expected.confidencePolicy === "active" ? 0.8 : 0.59,
          contentPotentialScore: 0.5,
          evidenceRefs: { commitIds: [scenario.input.commits[0]!.id], pullRequestIds: [] },
          importanceScore: 0.5,
          summary: "Synthetic evidence-grounded outcome.",
          technologies: scenario.expected.technologies,
          title: "Synthetic outcome",
          type: scenario.expected.type,
        },
        reason: null,
      },
      scenarioId: scenario.id,
      validationErrors: [],
    };
  });
}

describe("Phase 2 synthetic evaluation harness", () => {
  it("keeps an exact, versioned, non-private corpus of 60 scenarios", () => {
    expect(phase2EvaluationCorpusVersion).toBe("phase2-synthetic-v1");
    expect(phase2EvaluationScenarios).toHaveLength(phase2EvaluationScenarioCount);
    expect(phase2EvaluationScenarioCount).toBe(60);
    expect(phase2EvaluationScenarios.filter((scenario) => scenario.synthetic)).toHaveLength(60);
    expect(phase2EvaluationScenarios.filter((scenario) => scenario.kind === "event")).toHaveLength(50);
    expect(phase2EvaluationScenarios.filter((scenario) => scenario.kind === "abstention")).toHaveLength(10);
    expect(new Set(phase2EvaluationScenarios.map((scenario) => scenario.id)).size).toBe(60);
  });

  it("scores deterministic golden results against the Phase 2 offline thresholds", () => {
    const report = scorePhase2Evaluation(goldenObservations());
    expect(report.thresholdsSatisfied).toBe(true);
    expect(report.thresholdFailures).toEqual([]);
    expect(report.metric).toMatchObject({
      eventPrecision: 1,
      eventRecall: 1,
      eventTypeAccuracy: 1,
      structuredOutputValidity: 1,
      evidenceGroundedness: 1,
      technologyPrecision: 1,
      unsupportedClaimRate: 0,
    });
  });

  it("fails the offline thresholds when deterministic results do not identify events", () => {
    const observations = goldenObservations().map((observation) => ({
      ...observation,
      interpretation: null,
      validationErrors: ["invalid_json"],
    }));
    const report = scorePhase2Evaluation(observations);
    expect(report.thresholdsSatisfied).toBe(false);
    expect(report.thresholdFailures).toContain("event_recall_below_0.70");
  });
});
