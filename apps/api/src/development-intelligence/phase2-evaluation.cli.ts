import "dotenv/config";

import { createHash } from "node:crypto";
import { access } from "node:fs/promises";

import { parseApiEnv } from "@developer-brand-copilot/config";
import {
  developmentEventPromptVersion,
  developmentEventSchemaVersion,
  parseDevelopmentEventInterpretation,
  phase2EvaluationCorpusVersion,
  phase2EvaluationScenarioCount,
  phase2EvaluationScenarios,
  scorePhase2Evaluation,
  type DevelopmentEventModelClient,
  type Phase2EvaluationObservation,
  type Phase2EvaluationScenario,
} from "@developer-brand-copilot/ai";

import { Phase2EvaluationArtifactWriter, type SafeEvaluationScenarioResult } from "./phase2-evaluation-artifact";
import {
  developmentEventInterpretationVersion,
  developmentEventLifecyclePolicyVersion,
  developmentEventScoringPolicy,
} from "./development-event-interpreter.service";
import {
  AIProviderError,
  OpenAIDevelopmentEventModelService,
  openAiInterpretationModelConfiguration,
} from "./openai-development-event-model.service";

interface EvaluationOptions {
  readonly model: DevelopmentEventModelClient;
  readonly scenarios: readonly Phase2EvaluationScenario[];
  readonly writer: Phase2EvaluationArtifactWriter;
  readonly responsesApiCallCount?: () => number;
}

function safeFailure(error: unknown): string {
  return error instanceof AIProviderError ? error.failureCode : "AI_PROVIDER_TRANSIENT_FAILURE";
}

function summarize(
  scenarios: readonly Phase2EvaluationScenario[],
  observations: readonly Phase2EvaluationObservation[]
) {
  const byId = new Map(observations.map((item) => [item.scenarioId, item]));
  const taxonomy: Record<string, { expected: number; correct: number; wrongType: number; missed: number }> = {};
  const failures: { scenarioId: string; category: string; expected: string; observed: string }[] = [];
  let expectedEvents = 0;
  let predictedEvents = 0;
  let truePositives = 0;
  let structuredOutputValid = 0;
  for (const scenario of scenarios) {
    const observation = byId.get(scenario.id);
    const value = observation?.interpretation;
    if (value && observation?.validationErrors.length === 0) structuredOutputValid += 1;
    if (value?.decision === "event") predictedEvents += 1;
    if (scenario.expected.decision === "event") {
      expectedEvents += 1;
      const row = taxonomy[scenario.expected.type] ?? { expected: 0, correct: 0, wrongType: 0, missed: 0 };
      row.expected += 1;
      if (value?.decision !== "event") {
        row.missed += 1;
        failures.push({ scenarioId: scenario.id, category: "false_negative", expected: scenario.expected.type, observed: value?.decision ?? "none" });
      } else {
        truePositives += 1;
        if (value.event.type === scenario.expected.type) row.correct += 1;
        else {
          row.wrongType += 1;
          failures.push({ scenarioId: scenario.id, category: "wrong_event_type", expected: scenario.expected.type, observed: value.event.type });
        }
        const policy = value.event.confidence >= developmentEventScoringPolicy.confidenceAcceptanceThreshold ? "active" : "rejected";
        if (policy !== scenario.expected.confidencePolicy) {
          failures.push({ scenarioId: scenario.id, category: "confidence_policy_mismatch", expected: scenario.expected.confidencePolicy, observed: policy });
        }
        if ((value.event.title + " " + value.event.summary).toLowerCase().includes(scenario.unsupportedClaimTrap)) {
          failures.push({ scenarioId: scenario.id, category: "unsupported_claim", expected: "absent", observed: "present" });
        }
      }
      taxonomy[scenario.expected.type] = row;
    } else if (value?.decision === "event") {
      failures.push({ scenarioId: scenario.id, category: "false_positive", expected: "insufficient_evidence", observed: value.event.type });
    }
    for (const code of observation?.validationErrors ?? []) {
      failures.push({ scenarioId: scenario.id, category: code, expected: scenario.expected.decision, observed: "invalid" });
    }
  }
  return {
    expectedEvents,
    expectedAbstentions: scenarios.length - expectedEvents,
    truePositives,
    falsePositives: predictedEvents - truePositives,
    falseNegatives: expectedEvents - truePositives,
    structuredOutputValid,
    structuredOutputInvalid: scenarios.length - structuredOutputValid,
    taxonomy,
    failures,
    terminalScenarioFailures: observations.filter((item) => item.interpretation === null).length,
  };
}

export async function runPhase2Evaluation(options: EvaluationOptions) {
  const observations: Phase2EvaluationObservation[] = [];
  let attemptedCalls = 0;
  let initialCalls = 0;
  let repairCalls = 0;
  let scenariosRequiringRepair = 0;
  await options.writer.start();
  try {
    for (const scenario of options.scenarios) {
      let repairErrors: readonly string[] = [];
      let observation: Phase2EvaluationObservation | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        attemptedCalls += 1;
        if (attempt === 0) initialCalls += 1;
        else {
          repairCalls += 1;
          scenariosRequiringRepair += 1;
        }
        try {
          const response = await options.model.interpret(scenario.input, repairErrors);
          const parsed = parseDevelopmentEventInterpretation(
            response.outputText,
            new Set(scenario.input.commits.map((item) => item.id)),
            new Set(scenario.input.pullRequests.map((item) => item.id)),
            new Set(scenario.input.activeFeatures.map((item) => item.id))
          );
          repairErrors = parsed.errors;
          if (parsed.value) {
            observation = { interpretation: parsed.value, scenarioId: scenario.id, validationErrors: [] };
            break;
          }
        } catch (error) {
          observation = { interpretation: null, scenarioId: scenario.id, validationErrors: [safeFailure(error)] };
          break;
        }
      }
      observation ??= { interpretation: null, scenarioId: scenario.id, validationErrors: repairErrors };
      observations.push(observation);
      const result: SafeEvaluationScenarioResult = {
        id: scenario.id,
        outcome: observation.interpretation?.decision ?? (
          observation.validationErrors.some((code) => code.startsWith("AI_")) ? "provider_failure" : "invalid"
        ),
        validationErrors: observation.validationErrors,
        ...(observation.interpretation?.decision === "event"
          ? {
              eventType: observation.interpretation.event.type,
              confidencePolicy: observation.interpretation.event.confidence >= developmentEventScoringPolicy.confidenceAcceptanceThreshold ? "active" as const : "rejected" as const,
            }
          : {}),
      };
      await options.writer.checkpoint(result, {
        responsesApiCalls: options.responsesApiCallCount?.() ?? attemptedCalls,
        initialCalls,
        repairCalls,
        scenariosRequiringRepair,
      });
    }
    const score = scorePhase2Evaluation(observations, options.scenarios);
    await options.writer.finish({ ...score, ...summarize(options.scenarios, observations) });
    return score;
  } catch (error) {
    await options.writer.fail("failed");
    throw error;
  }
}

function value(name: string): string {
  const index = process.argv.indexOf(name);
  const result = index >= 0 ? process.argv[index + 1] : undefined;
  if (!result) throw new Error("Missing " + name);
  return result;
}

async function main(): Promise<void> {
  if (value("--corpus") !== phase2EvaluationCorpusVersion) throw new Error("Unsupported corpus");
  const output = value("--output");
  try {
    await access(output);
    throw new Error("Evaluation artifact already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (
    phase2EvaluationScenarios.length !== phase2EvaluationScenarioCount ||
    phase2EvaluationScenarioCount !== 60 ||
    !phase2EvaluationScenarios.every((scenario) => scenario.synthetic) ||
    new Set(phase2EvaluationScenarios.map((scenario) => scenario.id)).size !== 60
  ) {
    throw new Error("Evaluation corpus preflight failed");
  }
  const config = parseApiEnv(process.env);
  const modelConfigurationFingerprint = createHash("sha256")
    .update(JSON.stringify({ model: config.OPENAI_INTERPRETATION_MODEL, ...openAiInterpretationModelConfiguration }))
    .digest("hex");
  const extractionVersion = developmentEventInterpretationVersion({
    lifecyclePolicyVersion: developmentEventLifecyclePolicyVersion,
    modelConfigurationFingerprint,
    promptVersion: developmentEventPromptVersion,
    scoringPolicyVersion: developmentEventScoringPolicy.version,
    schemaVersion: developmentEventSchemaVersion,
  });
  const writer = new Phase2EvaluationArtifactWriter(output, {
    corpusVersion: phase2EvaluationCorpusVersion,
    extractionVersion,
    initialCalls: 0,
    model: config.OPENAI_INTERPRETATION_MODEL,
    promptVersion: developmentEventPromptVersion,
    providerFailureCounts: {},
    repairCalls: 0,
    responsesApiCalls: 0,
    scenarioCount: phase2EvaluationScenarios.length,
    scenariosRequiringRepair: 0,
    scoringVersion: developmentEventScoringPolicy.version,
    schemaVersion: developmentEventSchemaVersion,
    startedAt: new Date().toISOString(),
  });
  let responsesApiCalls = 0;
  const countedFetch: typeof fetch = (input, init) => {
    if (new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url).pathname === "/v1/responses") {
      responsesApiCalls += 1;
    }
    return fetch(input, init);
  };
  await runPhase2Evaluation({
    model: new OpenAIDevelopmentEventModelService(
      {
        apiKey: config.OPENAI_API_KEY,
        dailyAttemptLimit: config.OPENAI_DAILY_ATTEMPT_LIMIT,
        model: config.OPENAI_INTERPRETATION_MODEL,
      },
      countedFetch
    ),
    responsesApiCallCount: () => responsesApiCalls,
    scenarios: phase2EvaluationScenarios,
    writer,
  });
}

if (require.main === module) void main();
