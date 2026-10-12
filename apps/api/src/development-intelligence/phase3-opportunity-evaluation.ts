import { createHash } from "node:crypto";
import {
  contentOpportunityReasonCodes,
  negativeContentOpportunityReasonCodes,
  positiveContentOpportunityReasonCodes,
  type ContentOpportunityReasonCode,
  type DetectedOpportunityCandidate,
} from "@developer-brand-copilot/contracts";
import {
  getPhase3DevelopmentScenarios,
  phase3OpportunityCorpusVersion,
  phase3OpportunityExpectedContractVersion,
  phase3OpportunityFingerprints,
  phase3OpportunityHeldOutScenarioCount,
  phase3OpportunityPinnedFingerprints,
  phase3OpportunityRubricVersion,
  scorePhase3DevelopmentEvaluation,
  type Phase3EvaluationExpected,
  type Phase3EvaluationMetrics,
  type Phase3EvaluationObservation,
  type Phase3OpportunityScenario,
  type Phase3ScenarioSplit,
} from "@developer-brand-copilot/ai";
import {
  canonicalizePhase3OpportunityInput,
  fingerprintPhase3OpportunityInput,
  phase3OpportunityInputSelectionVersion,
  type CanonicalPhase3OpportunityInput,
} from "./phase3-opportunity-input";
import {
  phase3OpportunityScoringVersion,
  phase3OpportunityThresholds,
  scorePhase3OpportunityCandidates,
  type OpportunityDecision,
} from "./phase3-opportunity-scoring";

export const phase3OpportunityEvaluationReportVersion = "phase3-opportunity-evaluation-report-v1";
export const phase3HeldOutReviewManifestVersion = "phase3-held-out-review-manifest-v1";
export const phase3ScorerOnlyLimitation =
  "SCORER-ONLY / CONDITIONAL — Task 3.4 semantic detection is not evaluated; this is not the Phase 3 final precision gate.";

const stableIdentity = {
  resultId: "phase3-development-oracle-result-v1",
  extractionVersion: "phase3-development-oracle-extraction-v1",
  detectorVersion: "phase3-development-oracle-detector-v1",
  modelConfigurationFingerprint: createHash("sha256").update("phase3-development-oracle-no-provider", "utf8").digest("hex"),
};
const reasonOrder = new Map(contentOpportunityReasonCodes.map((code, index) => [code, index]));
const positiveReasons = new Set<ContentOpportunityReasonCode>(positiveContentOpportunityReasonCodes);
const negativeReasons = new Set<ContentOpportunityReasonCode>(negativeContentOpportunityReasonCodes);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)!;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite Phase 3 evaluation value");
    return JSON.stringify(value)!;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(",")}}`;
  }
  throw new Error("Unsupported Phase 3 evaluation value");
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function developerDayAge(createdDay: string, currentDay: string): number {
  return Math.floor((Date.parse(`${currentDay}T00:00:00.000Z`) - Date.parse(`${createdDay}T00:00:00.000Z`)) / 86_400_000);
}

export interface Phase3ProducedObservation {
  readonly scenarioId: string;
  readonly split: Phase3ScenarioSplit;
  readonly observation: Phase3EvaluationObservation;
}

/** Future release producers must return the same observation contract without changing metric semantics. */
export interface Phase3DetectorInclusiveObservationProducer {
  readonly scope: "detector_inclusive";
  produce(scenario: Phase3OpportunityScenario): Promise<Phase3ProducedObservation>;
}

export interface Phase3ReasonDigest {
  readonly scenarioId: string;
  readonly digest: string;
  readonly reasonCount: number;
}

export interface Phase3DevelopmentScenarioExecution extends Phase3ProducedObservation {
  readonly decision: OpportunityDecision | null;
  readonly deterministic: boolean;
  readonly reasonValid: boolean;
  readonly reasonDigest: Phase3ReasonDigest | null;
}

export interface Phase3OfflineAnswer {
  readonly scenarioId: string;
  readonly what: string;
  readonly opportunityType: string;
  readonly recommendedFormat: string;
  readonly reasons: readonly {
    readonly code: string;
    readonly effect: string;
    readonly value: number | null;
    readonly developmentEventIds: readonly string[];
  }[];
  readonly supportingDevelopmentEvents: readonly {
    readonly developmentEventId: string;
    readonly title: string;
    readonly type: string;
  }[];
}

export interface Phase3FrozenPinsVerification {
  readonly passed: boolean;
  readonly actual: Readonly<Record<"complete" | "development" | "heldOut" | "contract" | "rubric", string>>;
  readonly expected: typeof phase3OpportunityPinnedFingerprints;
  readonly errors: readonly string[];
}

export interface Phase3DevelopmentEvaluationReport {
  readonly reportVersion: typeof phase3OpportunityEvaluationReportVersion;
  readonly evaluationScope: "scorer_only";
  readonly precisionClassification: typeof phase3ScorerOnlyLimitation;
  readonly corpusVersion: string;
  readonly rubricVersion: string;
  readonly expectedContractVersion: string;
  readonly pins: Phase3FrozenPinsVerification;
  readonly gitSha: string | null;
  readonly scoringVersion: string;
  readonly selectedSplit: "development";
  readonly scenarioCount: number;
  readonly scenarioIds: readonly string[];
  readonly outcomes: readonly {
    readonly scenarioId: string;
    readonly outcome: "no_opportunity" | "suppressed" | "visible";
    readonly shouldPost: boolean | null;
    readonly status: "recommended" | "suppressed" | "expired" | null;
  }[];
  readonly metrics: Phase3EvaluationMetrics;
  readonly gates: {
    readonly duplicateSuppressionBehavior: boolean;
    readonly shouldPostFalseBehavior: boolean;
    readonly visibleReasonReproducibility: boolean;
    readonly visibleReasonsNonEmptyAndProvenanceValid: boolean;
    readonly scorerOnlyPrecisionReported: boolean;
    readonly finalDetectorInclusivePrecisionSatisfied: false;
    readonly feedbackPersistenceEvidenceSatisfied: true;
    readonly finalPhase3ExitSatisfied: false;
  };
  readonly failingScenarioIds: readonly string[];
  readonly reasonDigests: readonly Phase3ReasonDigest[];
  readonly humanReview: {
    readonly status: "not_started";
    readonly finalExitEligible: false;
  };
  readonly feedbackPersistenceEvidence: {
    readonly commit: "7518d396b94c8b80cf0363c795d0840986e3edee";
    readonly migration: "20260925100000_add_opportunity_feedback";
    readonly hostedCi: "#30 exact SHA success";
    readonly taskStatus: "DELIVERY COMPLETE";
  };
  readonly offlineAnswer: Phase3OfflineAnswer;
  readonly limitation: typeof phase3ScorerOnlyLimitation;
}

export function adaptPhase3ScenarioToCanonicalInput(scenario: Phase3OpportunityScenario): CanonicalPhase3OpportunityInput {
  const fingerprint = stableHash(`${phase3OpportunityCorpusVersion}:${scenario.id}`);
  const eligibleEvents = scenario.input.events.filter((event) =>
    event.authoritative && event.status === "active" && !event.orphanedEvidence);
  const eventById = new Map(eligibleEvents.map((event) => [event.id, event]));
  return canonicalizePhase3OpportunityInput({
    selectionVersion: phase3OpportunityInputSelectionVersion,
    projectId: scenario.input.projectId,
    timezone: scenario.input.timezone,
    evaluationBoundary: `${scenario.input.developerDay}T12:00:00.000Z`,
    developerDay: scenario.input.developerDay,
    projectState: {
      id: `${scenario.id}-project-state`,
      version: 1,
      sourceFingerprint: fingerprint,
      projectionVersion: "phase3-evaluation-project-state-v1",
      lastUpdatedAt: `${scenario.input.developerDay}T11:00:00.000Z`,
      purpose: null,
      targetAudience: null,
      currentPhase: scenario.input.projectState.currentPhase,
      technologies: scenario.input.projectState.technologies,
      activeFeatures: [],
      completedFeatures: [],
      recentMilestones: [],
    },
    developmentEvents: eligibleEvents.map((event) => ({
      developmentEventId: event.id,
      eventKey: event.id,
      inputFingerprint: fingerprint,
      extractionVersion: "phase3-evaluation-event-v1",
      type: event.type,
      status: "active" as const,
      title: event.title,
      summary: event.summary,
      importanceScore: event.importanceScore,
      contentPotentialScore: event.contentPotentialScore,
      confidence: event.confidence,
      occurredAt: event.occurredAt,
      technologies: [],
      relatedFeatureIds: event.relatedFeatureIds,
      supportingEvidenceKinds: [],
      truncated: { title: false, summary: false, technologies: false, relatedFeatureIds: false },
    })),
    opportunityHistory: scenario.input.recentContentOpportunities.map((history) => ({
      opportunityId: history.id,
      candidateKey: stableHash(`${scenario.id}:${history.id}:candidate`),
      inputFingerprint: stableHash(`${scenario.id}:${history.id}:input`),
      scoringVersion: phase3OpportunityScoringVersion,
      topicKey: history.topicKey,
      opportunityType: history.type,
      status: history.status,
      shouldPost: history.shouldPost,
      isCurrent: history.status !== "expired",
      createdAt: `${history.createdDeveloperDay}T12:00:00.000Z`,
      createdDeveloperDay: history.createdDeveloperDay,
      expiredAt: history.status === "expired" ? `${history.createdDeveloperDay}T12:00:00.000Z` : null,
      linkedDevelopmentEvents: [...eventById.values()]
        .filter((event) => history.relatedFeatureIds.some((featureId) => event.relatedFeatureIds.includes(featureId)))
        .map((event) => ({ developmentEventId: event.id, type: event.type })),
      linkedFeatureIds: history.relatedFeatureIds,
      truncatedLinkedEvents: false,
      truncatedLinkedFeatureIds: false,
    })),
    truncation: {
      developmentEvents: false,
      opportunityHistory: false,
      activeFeatures: false,
      completedFeatures: false,
      recentMilestones: false,
      projectTechnologies: false,
      stateTextFields: 0,
    },
  });
}

export function adaptPhase3ScenarioToOracleCandidate(
  scenario: Phase3OpportunityScenario,
): readonly DetectedOpportunityCandidate[] {
  const expected = scenario.expected;
  if (!expected.opportunityExpected) return [];
  if (!expected.opportunityType || !expected.recommendedFormat || !expected.topicKey || expected.linkedDevelopmentEventIds.length === 0) {
    throw new Error(`Incomplete oracle candidate expectation: ${scenario.id}`);
  }
  const confidence = Math.min(...expected.linkedDevelopmentEventIds.map((id) => {
    const event = scenario.input.events.find((candidate) => candidate.id === id);
    if (!event) throw new Error(`Oracle candidate references an unknown event: ${scenario.id}`);
    return event.confidence;
  }));
  return [{
    eventIds: expected.linkedDevelopmentEventIds,
    opportunityType: expected.opportunityType,
    title: `Synthetic validated opportunity: ${expected.topicKey}`,
    recommendedFormat: expected.recommendedFormat,
    topicDescriptor: expected.topicKey,
    confidence,
  }];
}

function toObservation(scenarioId: string, decision: OpportunityDecision | null): Phase3EvaluationObservation {
  if (!decision) return {
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
  return {
    scenarioId,
    duplicateSuppressed: decision.duplicateSuppressed,
    linkedDevelopmentEventIds: decision.developmentEventIds,
    noveltyScore: decision.noveltyScore,
    opportunityType: decision.opportunityType,
    reasonSignalCodes: decision.reasons.map((reason) => reason.code),
    recommendedFormat: decision.recommendedFormat,
    releaseMilestoneExceptionApplied: decision.releaseMilestoneExceptionApplied,
    shouldPost: decision.shouldPost,
    status: decision.status,
    topicKey: decision.topicKey,
  };
}

function visible(decision: OpportunityDecision | null): decision is OpportunityDecision {
  return decision?.shouldPost === true && decision.status === "recommended";
}

function validateReasons(decision: OpportunityDecision): boolean {
  if (decision.reasons.length === 0) return false;
  const provenance = new Set(decision.developmentEventIds);
  let previousOrder = -1;
  for (const reason of decision.reasons) {
    const order = reasonOrder.get(reason.code);
    if (order === undefined || order <= previousOrder) return false;
    previousOrder = order;
    const expectedEffect = positiveReasons.has(reason.code) ? "positive" : negativeReasons.has(reason.code) ? "negative" : null;
    if (reason.effect !== expectedEffect) return false;
    if (reason.value !== null && (!Number.isFinite(reason.value) || reason.value < 0 || reason.value > 1 || Math.round(reason.value * 1_000) / 1_000 !== reason.value)) return false;
    if (new Set(reason.developmentEventIds).size !== reason.developmentEventIds.length) return false;
    if (reason.developmentEventIds.some((id) => !provenance.has(id))) return false;
    if (reason.developmentEventIds.join("|") !== [...reason.developmentEventIds].sort().join("|")) return false;
  }
  return true;
}

function reasonDigest(scenarioId: string, decision: OpportunityDecision): Phase3ReasonDigest {
  const semanticOpportunityIdentity = {
    candidateKey: decision.candidateKey,
    opportunityType: decision.opportunityType,
    topicKey: decision.topicKey,
    developmentEventIds: decision.developmentEventIds,
  };
  const reasons = decision.reasons.map((reason) => ({
    code: reason.code,
    effect: reason.effect,
    value: reason.value,
    developmentEventIds: reason.developmentEventIds,
  }));
  return {
    scenarioId,
    digest: sha256({ scoringVersion: decision.scoringVersion, semanticOpportunityIdentity, reasons }),
    reasonCount: reasons.length,
  };
}

function executeScenario(scenario: Phase3OpportunityScenario): Phase3DevelopmentScenarioExecution {
  const input = adaptPhase3ScenarioToCanonicalInput(scenario);
  const candidates = adaptPhase3ScenarioToOracleCandidate(scenario);
  const inputFingerprint = fingerprintPhase3OpportunityInput(input);
  const first = scorePhase3OpportunityCandidates(input, candidates, stableIdentity, inputFingerprint);
  const second = scorePhase3OpportunityCandidates(input, candidates, stableIdentity, inputFingerprint);
  if (first.length > 1 || second.length > 1) throw new Error(`Evaluation scenario produced multiple decisions: ${scenario.id}`);
  const deterministic = canonicalJson(first) === canonicalJson(second);
  const firstDecision = first[0] ?? null;
  const secondDecision = second[0] ?? null;
  const firstDigest = visible(firstDecision) ? reasonDigest(scenario.id, firstDecision) : null;
  const secondDigest = visible(secondDecision) ? reasonDigest(scenario.id, secondDecision) : null;
  return {
    scenarioId: scenario.id,
    split: scenario.split,
    observation: toObservation(scenario.id, firstDecision),
    decision: firstDecision,
    deterministic: deterministic && canonicalJson(firstDigest) === canonicalJson(secondDigest),
    reasonValid: !visible(firstDecision) || validateReasons(firstDecision),
    reasonDigest: firstDigest,
  };
}

export function evaluatePhase3DevelopmentScenario(scenarioId: string): Phase3DevelopmentScenarioExecution {
  const scenario = getPhase3DevelopmentScenarios().find((candidate) => candidate.id === scenarioId);
  if (!scenario) throw new Error(`Unknown Phase 3 development scenario: ${scenarioId}`);
  return executeScenario(scenario);
}

export function validatePhase3ObservationCompleteness(
  scenarios: readonly Pick<Phase3OpportunityScenario, "id" | "split">[],
  produced: readonly Phase3ProducedObservation[],
  split: Phase3ScenarioSplit,
): void {
  const expectedIds = new Set(scenarios.map((scenario) => scenario.id));
  const seen = new Set<string>();
  const errors: string[] = [];
  if (scenarios.some((scenario) => scenario.split !== split)) errors.push("scenario_wrong_split");
  for (const row of produced) {
    if (seen.has(row.scenarioId)) errors.push(`duplicate:${row.scenarioId}`);
    seen.add(row.scenarioId);
    if (row.split !== split) errors.push(`wrong_split:${row.scenarioId}`);
    if (!expectedIds.has(row.scenarioId)) errors.push(`unknown_or_extra:${row.scenarioId}`);
    if (row.observation.scenarioId !== row.scenarioId) errors.push(`observation_id_mismatch:${row.scenarioId}`);
  }
  for (const id of expectedIds) if (!seen.has(id)) errors.push(`missing:${id}`);
  if (produced.length !== scenarios.length) errors.push("count_mismatch");
  if (errors.length > 0) throw new Error(`Invalid Phase 3 observation set: ${errors.join(",")}`);
}

export function verifyPhase3FrozenPins(rubricText: string): Phase3FrozenPinsVerification {
  const normalizedRubric = rubricText.replace(/\r\n?/g, "\n");
  const actual = {
    complete: phase3OpportunityFingerprints.complete,
    development: phase3OpportunityFingerprints.development,
    heldOut: phase3OpportunityFingerprints.heldOut,
    contract: phase3OpportunityFingerprints.contract,
    rubric: `sha256:${createHash("sha256").update(normalizedRubric, "utf8").digest("hex")}`,
  };
  const errors = (Object.keys(actual) as (keyof typeof actual)[])
    .filter((key) => actual[key] !== phase3OpportunityPinnedFingerprints[key])
    .map((key) => `pin_mismatch:${key}`);
  return { passed: errors.length === 0, actual, expected: phase3OpportunityPinnedFingerprints, errors };
}

function scenarioFails(scenario: Phase3OpportunityScenario, observation: Phase3EvaluationObservation): boolean {
  const expected = scenario.expected;
  const predictedVisible = observation.shouldPost === true && observation.status === "recommended";
  const expectedReasons = new Set([...expected.positiveReasonSignalCodes, ...expected.negativeReasonSignalCodes]);
  const actualReasons = new Set(observation.reasonSignalCodes);
  const noveltyBand = observation.noveltyScore === null ? "not_applicable" :
    observation.noveltyScore < phase3OpportunityThresholds.novelty ? "below_0_35" : "at_or_above_0_35";
  if (predictedVisible !== expected.visible) return true;
  if (!expected.opportunityExpected) return observation.status !== null;
  return observation.shouldPost !== expected.shouldPost || observation.status !== expected.status ||
    observation.opportunityType !== expected.opportunityType || observation.recommendedFormat !== expected.recommendedFormat ||
    observation.topicKey !== expected.topicKey || noveltyBand !== expected.noveltyExpectation ||
    observation.releaseMilestoneExceptionApplied !== expected.releaseMilestoneExceptionApplies ||
    [...observation.linkedDevelopmentEventIds].sort().join("|") !== [...expected.linkedDevelopmentEventIds].sort().join("|") ||
    actualReasons.size !== expectedReasons.size || [...actualReasons].some((code) => !expectedReasons.has(code));
}

function duplicateGate(scenarios: readonly Phase3OpportunityScenario[], executions: readonly Phase3DevelopmentScenarioExecution[]): boolean {
  let exercised = false;
  for (const [index, scenario] of scenarios.entries()) {
    const decision = executions[index]?.decision;
    if (!decision) continue;
    const exactCurrentRecommendation = scenario.input.recentContentOpportunities.some((history) => {
      const age = developerDayAge(history.createdDeveloperDay, scenario.input.developerDay);
      return age >= 0 && age < 30 && history.status === "recommended" &&
        history.topicKey === decision.topicKey && history.type === decision.opportunityType;
    });
    if (exactCurrentRecommendation) {
      exercised = true;
      if (!decision.duplicateSuppressed || decision.shouldPost || decision.status !== "suppressed") return false;
    }
    if (decision.duplicateSuppressed && (decision.shouldPost || decision.status !== "suppressed")) return false;
  }
  return exercised;
}

function shouldPostFalseGate(executions: readonly Phase3DevelopmentScenarioExecution[]): boolean {
  const decisions = executions.flatMap((execution) => execution.decision ? [execution.decision] : []);
  const withheld = decisions.filter((decision) => !decision.shouldPost);
  if (withheld.length === 0) return false;
  return decisions.every((decision) => decision.shouldPost === (decision.status === "recommended")) &&
    withheld.every((decision) => decision.status === "suppressed") &&
    decisions.filter((decision) => decision.confidence < phase3OpportunityThresholds.confidence)
      .every((decision) => !decision.shouldPost) &&
    decisions.filter((decision) => decision.duplicateSuppressed).every((decision) => !decision.shouldPost) &&
    decisions.filter((decision) => decision.noveltyScore < phase3OpportunityThresholds.novelty && !decision.releaseMilestoneExceptionApplied)
      .every((decision) => !decision.shouldPost);
}

function offlineAnswer(scenarios: readonly Phase3OpportunityScenario[], executions: readonly Phase3DevelopmentScenarioExecution[]): Phase3OfflineAnswer {
  const execution = executions.find((row) => visible(row.decision));
  if (!execution?.decision) throw new Error("Development evaluation produced no visible offline answer");
  const scenario = scenarios.find((row) => row.id === execution.scenarioId)!;
  const byId = new Map(scenario.input.events.map((event) => [event.id, event]));
  return {
    scenarioId: scenario.id,
    what: execution.decision.title,
    opportunityType: execution.decision.opportunityType,
    recommendedFormat: execution.decision.recommendedFormat,
    reasons: execution.decision.reasons.map((reason) => ({
      code: reason.code,
      effect: reason.effect,
      value: reason.value,
      developmentEventIds: reason.developmentEventIds,
    })),
    supportingDevelopmentEvents: execution.decision.developmentEventIds.map((developmentEventId) => {
      const event = byId.get(developmentEventId);
      if (!event) throw new Error(`Offline answer provenance is missing: ${developmentEventId}`);
      return { developmentEventId, title: event.title, type: event.type };
    }),
  };
}

export function runPhase3DevelopmentScorerEvaluation(options: {
  readonly rubricText: string;
  readonly gitSha?: string | null;
}): Phase3DevelopmentEvaluationReport {
  const scenarios = getPhase3DevelopmentScenarios();
  const pins = verifyPhase3FrozenPins(options.rubricText);
  if (!pins.passed) throw new Error(`Frozen Phase 3 evaluation identity changed: ${pins.errors.join(",")}`);
  const executions = scenarios.map(executeScenario);
  validatePhase3ObservationCompleteness(scenarios, executions, "development");
  const observations = executions.map((row) => row.observation);
  const metrics = scorePhase3DevelopmentEvaluation(observations);
  const reasonDigests = executions.flatMap((row) => row.reasonDigest ? [row.reasonDigest] : []);
  const visibleExecutions = executions.filter((row) => visible(row.decision));
  const reasonReproducibility = visibleExecutions.length > 0 && visibleExecutions.every((row) => row.deterministic && row.reasonDigest !== null);
  const reasonValidity = visibleExecutions.length > 0 && visibleExecutions.every((row) => row.reasonValid && (row.decision?.reasons.length ?? 0) > 0);
  return {
    reportVersion: phase3OpportunityEvaluationReportVersion,
    evaluationScope: "scorer_only",
    precisionClassification: phase3ScorerOnlyLimitation,
    corpusVersion: phase3OpportunityCorpusVersion,
    rubricVersion: phase3OpportunityRubricVersion,
    expectedContractVersion: phase3OpportunityExpectedContractVersion,
    pins,
    gitSha: options.gitSha ?? null,
    scoringVersion: phase3OpportunityScoringVersion,
    selectedSplit: "development",
    scenarioCount: scenarios.length,
    scenarioIds: scenarios.map((scenario) => scenario.id),
    outcomes: executions.map((execution) => ({
      scenarioId: execution.scenarioId,
      outcome: execution.decision === null ? "no_opportunity" : visible(execution.decision) ? "visible" : "suppressed",
      shouldPost: execution.observation.shouldPost,
      status: execution.observation.status,
    })),
    metrics,
    gates: {
      duplicateSuppressionBehavior: duplicateGate(scenarios, executions),
      shouldPostFalseBehavior: shouldPostFalseGate(executions),
      visibleReasonReproducibility: reasonReproducibility,
      visibleReasonsNonEmptyAndProvenanceValid: reasonValidity,
      scorerOnlyPrecisionReported: metrics.precisionGateSatisfied === true,
      finalDetectorInclusivePrecisionSatisfied: false,
      feedbackPersistenceEvidenceSatisfied: true,
      finalPhase3ExitSatisfied: false,
    },
    failingScenarioIds: scenarios.filter((scenario, index) => scenarioFails(scenario, observations[index]!)).map((scenario) => scenario.id),
    reasonDigests,
    humanReview: { status: "not_started", finalExitEligible: false },
    feedbackPersistenceEvidence: {
      commit: "7518d396b94c8b80cf0363c795d0840986e3edee",
      migration: "20260925100000_add_opportunity_feedback",
      hostedCi: "#30 exact SHA success",
      taskStatus: "DELIVERY COMPLETE",
    },
    offlineAnswer: offlineAnswer(scenarios, executions),
    limitation: phase3ScorerOnlyLimitation,
  };
}

export type Phase3SecondReviewStatus = "not_started" | "agreed" | "disagreed" | "adjudicated";
export interface Phase3HeldOutReviewEntry {
  readonly scenarioId: string;
  readonly secondReviewStatus: Phase3SecondReviewStatus;
  readonly disagreement: boolean | null;
  readonly adjudicatedExpected: Phase3EvaluationExpected | null;
}
export interface Phase3HeldOutReviewManifest {
  readonly manifestVersion: typeof phase3HeldOutReviewManifestVersion;
  readonly corpusVersion: string;
  readonly heldOutFingerprint: string;
  readonly reviews: readonly Phase3HeldOutReviewEntry[];
}
export interface Phase3HeldOutReviewValidation {
  readonly valid: boolean;
  readonly finalExitEligible: boolean;
  readonly requiredPassingReviews: number;
  readonly reviewedPassingSamples: number;
  readonly errors: readonly string[];
}

export const blankPhase3HeldOutReviewManifest: Phase3HeldOutReviewManifest = Object.freeze({
  manifestVersion: phase3HeldOutReviewManifestVersion,
  corpusVersion: phase3OpportunityCorpusVersion,
  heldOutFingerprint: phase3OpportunityPinnedFingerprints.heldOut,
  reviews: Object.freeze([]),
});

function reviewComplete(review: Phase3HeldOutReviewEntry | undefined): boolean {
  if (!review || review.secondReviewStatus === "not_started") return false;
  if (review.disagreement === true) return review.secondReviewStatus === "adjudicated" && review.adjudicatedExpected !== null;
  return review.disagreement === false && review.secondReviewStatus === "agreed" && review.adjudicatedExpected === null;
}

export function validatePhase3HeldOutReviewManifest(
  manifest: Phase3HeldOutReviewManifest,
  failingScenarioIds: readonly string[],
  passingScenarioIds: readonly string[],
): Phase3HeldOutReviewValidation {
  const errors: string[] = [];
  const heldOutIds = new Set(Array.from({ length: phase3OpportunityHeldOutScenarioCount }, (_, index) =>
    `phase3-scenario-${String(index + 81).padStart(3, "0")}`));
  if (manifest.manifestVersion !== phase3HeldOutReviewManifestVersion) errors.push("manifest_version_mismatch");
  if (manifest.corpusVersion !== phase3OpportunityCorpusVersion) errors.push("corpus_version_mismatch");
  if (manifest.heldOutFingerprint !== phase3OpportunityPinnedFingerprints.heldOut) errors.push("held_out_fingerprint_mismatch");
  const classified = [...failingScenarioIds, ...passingScenarioIds];
  if (new Set(classified).size !== classified.length) errors.push("duplicate_or_overlapping_classification");
  if (classified.length !== phase3OpportunityHeldOutScenarioCount || classified.some((id) => !heldOutIds.has(id))) errors.push("incomplete_or_invalid_held_out_classification");
  const byId = new Map<string, Phase3HeldOutReviewEntry>();
  for (const review of manifest.reviews) {
    if (!heldOutIds.has(review.scenarioId)) errors.push(`invalid_review_id:${review.scenarioId}`);
    if (byId.has(review.scenarioId)) errors.push(`duplicate_review:${review.scenarioId}`);
    byId.set(review.scenarioId, review);
    if (review.disagreement === true && (review.secondReviewStatus !== "adjudicated" || review.adjudicatedExpected === null)) errors.push(`unadjudicated_disagreement:${review.scenarioId}`);
    if (review.disagreement === false && review.secondReviewStatus !== "agreed") errors.push(`invalid_agreement_status:${review.scenarioId}`);
    if (review.disagreement === null && review.secondReviewStatus !== "not_started") errors.push(`missing_disagreement_status:${review.scenarioId}`);
  }
  for (const id of failingScenarioIds) if (!reviewComplete(byId.get(id))) errors.push(`failure_not_reviewed:${id}`);
  const requiredPassingReviews = Math.ceil(passingScenarioIds.length * 0.2);
  const reviewedPassingSamples = passingScenarioIds.filter((id) => reviewComplete(byId.get(id))).length;
  if (reviewedPassingSamples < requiredPassingReviews) errors.push("insufficient_passing_reviews");
  return {
    valid: errors.length === 0,
    finalExitEligible: errors.length === 0,
    requiredPassingReviews,
    reviewedPassingSamples,
    errors,
  };
}
