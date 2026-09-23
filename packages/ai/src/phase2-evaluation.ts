import type { DevelopmentEventType } from "@developer-brand-copilot/contracts";

import type {
  DevelopmentEventInterpretation,
  DevelopmentEventInterpretationInput,
} from "./index.js";

/** Versioned, repository-safe Phase 2 offline regression corpus; not the Phase 5 held-out release set. */
export const phase2EvaluationCorpusVersion = "phase2-synthetic-v1";
export const phase2EvaluationScenarioCount = 60;

type ExpectedDecision =
  | { readonly decision: "event"; readonly type: DevelopmentEventType; readonly technologies: readonly string[]; readonly confidencePolicy: "active" | "rejected" }
  | { readonly decision: "insufficient_evidence"; readonly reason: "ambiguous" | "noise" | "insufficient_detail" };

export interface Phase2EvaluationScenario {
  readonly expected: ExpectedDecision;
  readonly id: string;
  readonly input: DevelopmentEventInterpretationInput;
  readonly kind: "abstention" | "event";
  readonly lineage: "new" | "supersedes";
  readonly synthetic: true;
  /** A deliberately unsupported phrase which must not appear in the output. */
  readonly unsupportedClaimTrap: string;
}

export interface Phase2EvaluationObservation {
  readonly interpretation: DevelopmentEventInterpretation | null;
  readonly scenarioId: string;
  readonly validationErrors: readonly string[];
}

export interface Phase2EvaluationReport {
  readonly corpusVersion: string;
  readonly metric: {
    readonly confidencePolicyAccuracy: number;
    readonly evidenceGroundedness: number;
    readonly eventPrecision: number;
    readonly eventRecall: number;
    readonly eventTypeAccuracy: number;
    readonly structuredOutputValidity: number;
    readonly technologyPrecision: number;
    readonly unsupportedClaimRate: number;
  };
  readonly scenarioCount: number;
  readonly thresholdFailures: readonly string[];
  readonly thresholdsSatisfied: boolean;
}

const blueprints: readonly {
  readonly label: string;
  readonly paths: readonly string[];
  readonly technologies: readonly string[];
  readonly type: DevelopmentEventType;
}[] = [
  { type: "feature_started", label: "start workspace invitations", technologies: ["TypeScript", "NestJS"], paths: ["src/invitations/invitations.service.ts"] },
  { type: "feature_completed", label: "complete workspace invitations", technologies: ["TypeScript", "React"], paths: ["src/invitations/InvitationDialog.tsx"] },
  { type: "bug_fixed", label: "fix duplicate webhook delivery", technologies: ["TypeScript", "PostgreSQL"], paths: ["src/webhooks/delivery.service.ts"] },
  { type: "ui_improved", label: "improve account settings navigation", technologies: ["React", "CSS"], paths: ["src/settings/SettingsNav.tsx"] },
  { type: "architecture_decision", label: "adopt an outbox for notifications", technologies: ["NestJS", "PostgreSQL"], paths: ["docs/architecture/notification-outbox.md"] },
  { type: "testing_milestone", label: "add invitation integration coverage", technologies: ["Vitest", "TypeScript"], paths: ["src/invitations/invitations.service.spec.ts"] },
  { type: "performance_improvement", label: "reduce dashboard query cost", technologies: ["PostgreSQL", "TypeScript"], paths: ["src/dashboard/dashboard-query.ts"] },
  { type: "release", label: "release workspace invitations", technologies: ["TypeScript"], paths: ["CHANGELOG.md"] },
  { type: "project_milestone", label: "reach beta onboarding milestone", technologies: ["React", "NestJS"], paths: ["docs/milestones/beta-onboarding.md"] },
  { type: "refactor_completed", label: "complete billing module refactor", technologies: ["TypeScript", "NestJS"], paths: ["src/billing/billing.module.ts"] },
];

const variants = ["standalone", "pr_backed", "multi_commit", "pr_and_multi_commit", "confidence_boundary"] as const;

function eventScenario(
  blueprint: (typeof blueprints)[number],
  index: number,
  variant: (typeof variants)[number]
): Phase2EvaluationScenario {
  const id = `synthetic-${blueprint.type}-${String(index + 1).padStart(2, "0")}`;
  const commitId = `${id}-commit-1`;
  const hasPr = variant === "pr_backed" || variant === "pr_and_multi_commit";
  const multiCommit = variant === "multi_commit" || variant === "pr_and_multi_commit";
  const confidencePolicy = variant === "confidence_boundary" ? "rejected" : "active";
  return {
    expected: { decision: "event", type: blueprint.type, technologies: blueprint.technologies, confidencePolicy },
    id,
    input: {
      commits: [
        {
          additions: 24,
          committedAt: "2026-01-15T10:00:00.000Z",
          deletions: 4,
          filePaths: blueprint.paths,
          id: commitId,
          message: `${blueprint.label} (${variant})`,
        },
        ...(multiCommit
          ? [{ additions: 8, committedAt: "2026-01-15T10:05:00.000Z", deletions: 1, filePaths: blueprint.paths, id: `${id}-commit-2`, message: `test ${blueprint.label}` }]
          : []),
      ],
      evidenceFrom: "2026-01-15T09:00:00.000Z",
      evidenceTo: "2026-01-15T11:00:00.000Z",
      groupingReason: variant,
      groupingVersion: "evidence-grouping-v1",
      pullRequests: hasPr
        ? [{ additions: 32, bodySummary: `Synthetic summary: ${blueprint.label}.`, deletions: 5, filePaths: blueprint.paths, id: `${id}-pr-1`, mergedAt: "2026-01-15T10:30:00.000Z", title: blueprint.label }]
        : [],
    },
    kind: "event",
    lineage: blueprint.type === "refactor_completed" && index > 0 ? "supersedes" : "new",
    synthetic: true,
    unsupportedClaimTrap: "deployed to production",
  };
}

const abstentions: readonly Phase2EvaluationScenario[] = [
  ["noise", "format files", "noise"], ["noise", "bump version", "noise"], ["noise", "merge branch", "noise"],
  ["ambiguous", "update stuff", "ambiguous"], ["ambiguous", "fix issue", "ambiguous"], ["ambiguous", "changes requested", "ambiguous"],
  ["insufficient_detail", "wip", "insufficient_detail"], ["insufficient_detail", "progress", "insufficient_detail"], ["insufficient_detail", "minor updates", "insufficient_detail"], ["insufficient_detail", "cleanup", "insufficient_detail"],
].map(([reason, message], index) => {
  const id = `synthetic-abstain-${String(index + 1).padStart(2, "0")}`;
  return {
    expected: { decision: "insufficient_evidence", reason: reason as "ambiguous" | "noise" | "insufficient_detail" },
    id,
    input: {
      commits: [{ additions: null, committedAt: "2026-01-16T10:00:00.000Z", deletions: null, filePaths: [], id: `${id}-commit-1`, message: message! }],
      evidenceFrom: "2026-01-16T09:00:00.000Z", evidenceTo: "2026-01-16T11:00:00.000Z", groupingReason: "synthetic_abstention", groupingVersion: "evidence-grouping-v1", pullRequests: [],
    },
    kind: "abstention", lineage: "new", synthetic: true, unsupportedClaimTrap: "deployed to production",
  };
});

export const phase2EvaluationScenarios: readonly Phase2EvaluationScenario[] = [
  ...blueprints.flatMap((blueprint) => variants.map((variant, index) => eventScenario(blueprint, index, variant))),
  ...abstentions,
];

function fraction(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

/** Scores parsed results only; callers decide if and when model execution is authorized. */
export function scorePhase2Evaluation(
  observations: readonly Phase2EvaluationObservation[],
  scenarios: readonly Phase2EvaluationScenario[] = phase2EvaluationScenarios
): Phase2EvaluationReport {
  const byId = new Map(observations.map((observation) => [observation.scenarioId, observation]));
  let valid = 0, truePositives = 0, actualEvents = 0, typeCorrect = 0;
  let grounded = 0, confidenceCorrect = 0, technologyCorrect = 0, technologyPredicted = 0, unsupported = 0;
  for (const scenario of scenarios) {
    const observation = byId.get(scenario.id);
    const value = observation?.interpretation ?? null;
    if (value && (observation?.validationErrors.length ?? 1) === 0) valid++;
    const predictedEvent = value?.decision === "event";
    const expectedEvent = scenario.expected.decision === "event";
    if (predictedEvent) actualEvents++;
    if (expectedEvent && predictedEvent) truePositives++;
    if (expectedEvent && predictedEvent && value?.event) {
      if (value.event.type === scenario.expected.type) typeCorrect++;
      const allowedIds = new Set([...scenario.input.commits.map((item) => item.id), ...scenario.input.pullRequests.map((item) => item.id)]);
      const refs = [...value.event.evidenceRefs.commitIds, ...value.event.evidenceRefs.pullRequestIds];
      if (refs.length > 0 && refs.every((id) => allowedIds.has(id))) grounded++;
      const expectedPolicy = scenario.expected.confidencePolicy;
      if ((value.event.confidence >= 0.6 ? "active" : "rejected") === expectedPolicy) confidenceCorrect++;
      for (const technology of value.event.technologies) {
        technologyPredicted++;
        if (scenario.expected.technologies.includes(technology)) technologyCorrect++;
      }
      if (`${value.event.title} ${value.event.summary}`.toLowerCase().includes(scenario.unsupportedClaimTrap)) unsupported++;
    }
  }
  const expectedEvents = scenarios.filter((scenario) => scenario.expected.decision === "event").length;
  const metric = {
    confidencePolicyAccuracy: fraction(confidenceCorrect, truePositives), evidenceGroundedness: fraction(grounded, truePositives),
    eventPrecision: fraction(truePositives, actualEvents), eventRecall: fraction(truePositives, expectedEvents),
    eventTypeAccuracy: fraction(typeCorrect, truePositives), structuredOutputValidity: fraction(valid, scenarios.length),
    technologyPrecision: fraction(technologyCorrect, technologyPredicted), unsupportedClaimRate: fraction(unsupported, truePositives),
  };
  const thresholdFailures = [
    ...(metric.eventPrecision < 0.8 ? ["event_precision_below_0.80"] : []),
    ...(metric.eventRecall < 0.7 ? ["event_recall_below_0.70"] : []),
    ...(metric.eventTypeAccuracy < 0.8 ? ["event_type_accuracy_below_0.80"] : []),
  ];
  return { corpusVersion: phase2EvaluationCorpusVersion, metric, scenarioCount: scenarios.length, thresholdFailures, thresholdsSatisfied: thresholdFailures.length === 0 };
}
