import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { phase2EvaluationScenarios, type DevelopmentEventModelClient } from "@developer-brand-copilot/ai";
import { Phase2EvaluationArtifactWriter } from "./phase2-evaluation-artifact";
import { runPhase2Evaluation } from "./phase2-evaluation.cli";

describe("runPhase2Evaluation", () => {
  it("checkpoints and recovers a completed fake-model artifact without network", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phase2-evaluation-")); const output = join(dir, "result.json"); let calls = 0;
    const model: DevelopmentEventModelClient = { interpret: async () => ({ inputTokens: null, outputTokens: null, outputText: ++calls === 1 ? "not-json" : JSON.stringify({ decision: "insufficient_evidence", event: null, reason: "noise" }) }) };
    const writer = new Phase2EvaluationArtifactWriter(output, { corpusVersion: "phase2-synthetic-v1", extractionVersion: "test", initialCalls: 0, model: "fake", promptVersion: "test", providerFailureCounts: {}, repairCalls: 0, responsesApiCalls: 0, scenarioCount: 2, scenariosRequiringRepair: 0, scoringVersion: "test", schemaVersion: "test", startedAt: new Date().toISOString() });
    await runPhase2Evaluation({ model, scenarios: phase2EvaluationScenarios.slice(0, 2), writer });
    const artifact = JSON.parse(await readFile(output, "utf8"));
    expect(artifact).toMatchObject({ status: "succeeded", completedScenarioIds: [phase2EvaluationScenarios[0]?.id, phase2EvaluationScenarios[1]?.id], repairCalls: 1, responsesApiCalls: 3 });
    expect(JSON.stringify(artifact)).not.toContain("not-json"); await rm(dir, { recursive: true });
  });
});
