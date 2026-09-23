import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Phase2EvaluationArtifactWriter } from "./phase2-evaluation-artifact";

async function writer() {
  const directory = await mkdtemp(join(tmpdir(), "phase2-evaluation-"));
  const output = join(directory, "result.json");
  return { output, writer: new Phase2EvaluationArtifactWriter(output, { corpusVersion: "phase2-synthetic-v1", extractionVersion: "extract", initialCalls: 0, model: "safe-model", promptVersion: "prompt", providerFailureCounts: {}, repairCalls: 0, responsesApiCalls: 0, runId: "run-1", scenarioCount: 2, scenariosRequiringRepair: 0, scoringVersion: "score", schemaVersion: "schema", startedAt: "2026-01-01T00:00:00.000Z" }) };
}

describe("Phase2EvaluationArtifactWriter", () => {
  it("creates running artifacts, checkpoints safe counters, and atomically exposes valid JSON", async () => {
    const test = await writer();
    await test.writer.start();
    await test.writer.checkpoint({ id: "synthetic-1", outcome: "event", validationErrors: ["AI_RATE_LIMITED"] }, { initialCalls: 1, repairCalls: 0, responsesApiCalls: 1, scenariosRequiringRepair: 0 });
    const parsed = JSON.parse(await readFile(test.output, "utf8"));
    expect(parsed).toMatchObject({ status: "running", completedScenarioIds: ["synthetic-1"], responsesApiCalls: 1, providerFailureCounts: { AI_RATE_LIMITED: 1 } });
    expect(parsed.scenarios[0]).not.toHaveProperty("rawPrompt");
    expect(parsed.scenarios[0]).not.toHaveProperty("rawResponse");
    expect(parsed.scenarios[0]).not.toHaveProperty("secret");
  });

  it("records repairs and refuses a partial success gate", async () => {
    const test = await writer();
    await test.writer.start();
    await test.writer.checkpoint({ id: "synthetic-1", outcome: "invalid", validationErrors: ["invalid_json"] }, { initialCalls: 1, repairCalls: 1, responsesApiCalls: 2, scenariosRequiringRepair: 1 });
    await expect(test.writer.finish({ thresholdsSatisfied: true })).rejects.toThrow("Incomplete");
    await test.writer.fail("incomplete");
    expect(JSON.parse(await readFile(test.output, "utf8"))).toMatchObject({ status: "incomplete", repairCalls: 1 });
  });

  it("writes a final complete artifact readable by a separate process", async () => {
    const test = await writer();
    await test.writer.start();
    for (const id of ["synthetic-1", "synthetic-2"]) await test.writer.checkpoint({ id, outcome: "insufficient_evidence", validationErrors: [] }, { initialCalls: 2, repairCalls: 0, responsesApiCalls: 2, scenariosRequiringRepair: 0 });
    await test.writer.finish({ eventPrecision: 1, thresholdsSatisfied: true });
    expect(JSON.parse(await readFile(test.output, "utf8"))).toMatchObject({ status: "succeeded", report: { thresholdsSatisfied: true } });
  });
});
