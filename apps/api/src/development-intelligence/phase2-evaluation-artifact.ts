import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type EvaluationArtifactStatus = "running" | "succeeded" | "failed" | "incomplete";
export type SafeEvaluationOutcome = "event" | "insufficient_evidence" | "invalid" | "provider_failure";

export interface SafeEvaluationScenarioResult {
  readonly id: string;
  readonly outcome: SafeEvaluationOutcome;
  readonly validationErrors: readonly string[];
  readonly eventType?: string;
  readonly confidencePolicy?: "active" | "rejected";
  readonly evidenceGrounded?: boolean;
  readonly unsupportedClaim?: boolean;
  readonly technologyCorrect?: number;
  readonly technologyPredicted?: number;
}

export interface Phase2EvaluationArtifact {
  readonly artifactVersion: "phase2-evaluation-artifact-v1";
  readonly corpusVersion: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly status: EvaluationArtifactStatus;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly scoringVersion: string;
  readonly extractionVersion: string;
  readonly model: string;
  readonly scenarioCount: number;
  readonly completedScenarioIds: readonly string[];
  readonly responsesApiCalls: number;
  readonly initialCalls: number;
  readonly repairCalls: number;
  readonly scenariosRequiringRepair: number;
  readonly providerFailureCounts: Readonly<Record<string, number>>;
  readonly scenarios: readonly SafeEvaluationScenarioResult[];
  readonly report: Record<string, unknown> | null;
}

export class Phase2EvaluationArtifactWriter {
  private artifact: Phase2EvaluationArtifact;

  constructor(
    private readonly outputPath: string,
    initial: Omit<Phase2EvaluationArtifact, "artifactVersion" | "completedScenarioIds" | "finishedAt" | "report" | "runId" | "scenarios" | "status"> & { readonly runId?: string }
  ) {
    this.artifact = {
      ...initial,
      artifactVersion: "phase2-evaluation-artifact-v1",
      completedScenarioIds: [],
      finishedAt: null,
      report: null,
      runId: initial.runId ?? randomUUID(),
      scenarios: [],
      status: "running",
    };
  }

  snapshot(): Phase2EvaluationArtifact {
    return this.artifact;
  }

  async start(): Promise<void> {
    await this.persist();
  }

  async checkpoint(
    result: SafeEvaluationScenarioResult,
    counters: Pick<Phase2EvaluationArtifact, "responsesApiCalls" | "initialCalls" | "repairCalls" | "scenariosRequiringRepair">
  ): Promise<void> {
    if (this.artifact.status !== "running" || this.artifact.completedScenarioIds.includes(result.id)) {
      throw new Error("Evaluation artifact checkpoint is invalid");
    }
    const providerFailureCounts = { ...this.artifact.providerFailureCounts };
    for (const error of result.validationErrors.filter((value) => value.startsWith("AI_"))) {
      providerFailureCounts[error] = (providerFailureCounts[error] ?? 0) + 1;
    }
    this.artifact = {
      ...this.artifact,
      ...counters,
      completedScenarioIds: [...this.artifact.completedScenarioIds, result.id],
      providerFailureCounts,
      scenarios: [...this.artifact.scenarios, result],
    };
    await this.persist();
  }

  async finish(report: Record<string, unknown>): Promise<void> {
    if (this.artifact.completedScenarioIds.length !== this.artifact.scenarioCount) {
      throw new Error("Incomplete evaluation cannot be marked succeeded");
    }
    this.artifact = { ...this.artifact, finishedAt: new Date().toISOString(), report, status: "succeeded" };
    await this.persist();
  }

  async fail(status: "failed" | "incomplete" = "failed"): Promise<void> {
    this.artifact = { ...this.artifact, finishedAt: new Date().toISOString(), status };
    await this.persist();
  }

  private async persist(): Promise<void> {
    const target = resolve(this.outputPath);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${this.artifact.runId}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.artifact)}\n`, "utf8");
    await rename(temporary, target);
  }
}
