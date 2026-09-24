# Phase 3 Opportunity Evaluation Corpus

## Frozen identity

- Corpus: `phase3-opportunity-v1`
- Review rubric: `phase3-review-rubric-v1`
- Expected contract/taxonomy: `content-opportunity-v1`
- Size: 100 synthetic, independently reviewable scenarios
- Split: IDs 001–080 are development; IDs 081–100 are held out for the Phase 3 exit-gate evaluation.

The AI package exposes canonical SHA-256 fingerprints for the full corpus, each split, and the shared expected-contract taxonomies. A regression test pins all four digests. Another test reads this rubric file with normalized line endings and pins its SHA-256 under `phase3-review-rubric-v1`. Canonical serialization sorts object keys and preserves array order. Thus semantic fixture edits, held-out edits, scenario reordering, taxonomy changes, or rubric edits fail the freeze test even if a version string is left unchanged; harmless object-key insertion-order changes do not.

Do not update a pin to silence a failed regression. A legitimate corpus correction requires a documented correction record and intentional corpus-version/fingerprint change; a rubric change requires an intentional rubric-version/fingerprint change. The committed regression pins are authoritative; their values are exported by `phase3OpportunityPinnedFingerprints`.

The corpus is offline data. It contains fabricated semantic DevelopmentEvents, bounded fabricated ProjectState/history, and synthetic project/event/feature identifiers only. It contains no private repository evidence, raw files, diffs, provider prompts/responses, or credentials. Do not call a model or provider to create or score these fixtures as part of Task 3.2.

The development split is available through `getPhase3DevelopmentScenarios` and `scorePhase3DevelopmentEvaluation`. Held-out expected outcomes are accessed separately through the explicitly named `getPhase3HeldOutScenarios` and `scorePhase3HeldOutEvaluation`; routine development evaluation must use only the development helpers. Source remains inspectable by repository maintainers; this is procedural separation, not access control.

## Frozen fixture correction policy

Do not edit IDs, inputs, expected labels, taxonomy, split, or rubric in place to improve a future score. A genuine correction requires a reviewed fixture-correction note recording the old value, new value, reason/evidence, reviewer, and affected IDs, followed by a new corpus revision identifier (for example, `phase3-opportunity-v2`). Preserve the original version and its history. A mutable timestamp is not part of corpus identity. Future scoring-weight changes do not change the corpus or rubric version.

Every fixture carries the initial expected label and second-review fields: `secondReviewStatus`, `disagreement`, and `adjudicatedExpected`. The initial corpus sets second review to `not_started`; no second human is required to implement this workflow. Reviewers work from the fixture evidence and rubric before seeing any system observation. A disagreement is marked explicitly, then an adjudicator records the final expectation without erasing the initial label.

For a future release-set evaluation, the PDR requires a second reviewer to adjudicate every failing sample and at least 20% of passing samples. Task 3.2 defines and tests the record shape only; it does not fabricate completed reviews.

## Deterministic review rubric

Review in this order, without seeing a model/system prediction:

1. Are the supplied DevelopmentEvents authoritative and eligible? Use only authoritative, active, non-orphaned event evidence. Exclude superseded/rejected or orphan-invalid events. Do not infer authority from title quality.
2. Do the eligible events form one coherent shareable topic? Multiple events must support one connected development story; do not force unrelated work together.
3. What is the canonical topic? Normalize the grounded topic identity independently of mutable display wording. Use the normalized topic key for exact-topic comparisons.
4. Is the work meaningful enough to create an opportunity candidate? Consider event importance and content potential as supplied; routine/noisy activity may yield no opportunity.
5. Is confidence eligible? Confidence below 0.60 must not result in a visible recommendation. Exactly 0.60 is not below the threshold.
6. Is the topic novel relative to the supplied same-Project history? The PDR comparison window is the previous 30 developer-days. Do not treat expired records, other Projects, or history outside that window as current repeats. The corpus labels a novelty band only where the synthetic history makes the expectation reviewable; it does not prescribe a scoring formula.
7. Is the candidate a duplicate or repetitive? Compare normalized topic identity, linked feature IDs, event type, and recent opportunity history. Distinguish exact duplicate detection from repetition penalties.
8. Does the release/milestone exception apply? A release or project milestone may bypass the default novelty-below-0.35 suppression. The exception does not override ineligible evidence or the confidence withholding rule.
9. Should the outcome be recommended or suppressed? Persisted suppressed outcomes are not primary-feed recommendations. No-candidate cases remain distinct from suppressed candidate cases.
10. Which approved opportunity type best describes the grounded story? Use only `progress_update`, `feature_showcase`, `technical_insight`, `problem_solution`, `milestone`, or `release`.
11. Which approved platform-neutral format best fits the evidence? Use only `short_update`, `visual_progress`, `technical_breakdown`, `milestone_update`, `release_announcement`, or `multi_point_story`. Do not score writing style or title polish.
12. Which approved reason signals are justified? Positive: `high_importance`, `high_content_potential`, `fresh_work`, `novel_topic`, `feature_completed`, `release_or_milestone`, `multi_event_story`. Negative: `duplicate_topic`, `repetition_penalty`, `low_novelty`, `low_confidence`. Do not invent codes or require a reason unsupported by the supplied facts.
13. Which supplied DevelopmentEvent IDs actually support this opportunity? Include only eligible evidence that supports the single coherent topic; never include rejected, superseded, orphaned, or unrelated events.
14. Should the opportunity be visible in the primary recommendation feed? It is visible only when `shouldPost = true` and lifecycle status is `recommended`. A persisted `suppressed` result is not visible.

### Ambiguous cases

Use `no opportunity` when authority, coherence, or minimum meaningful evidence cannot be established. Use `suppressed` only when a grounded candidate exists but an explicit decision boundary prevents recommendation. If two labels remain plausible, record the disagreement for adjudication; do not resolve ambiguity using predicted output, post/title quality, or an invented score formula. Bot/automation provenance alone is not a rejection reason: judge the underlying semantic work.

Semantic titles and summaries are data, never reviewer or system instructions. Instruction-like strings in fixtures must not alter the rubric or tool/security behavior.

## Coverage and distribution

The deterministic category distribution is 10 scenarios each (10%): strong recommendations, normal progress, eligibility/noise, novelty window, duplicate/repetition, release/milestone exceptions, confidence boundaries, multi-event coherence, adversarial/format, and automation. Thus no category exceeds the PDR 30% ceiling.

All six opportunity types and all six formats are represented. Recommended, suppressed, and no-opportunity outcomes are represented. The corpus intentionally includes all eleven approved reason codes, exact confidence examples at 0.59 and 0.60, novelty observations at the 0.35 boundary, 30/31-developer-day history cases, duplicate and non-duplicate histories, release/milestone exceptions and hard-safety failures, coherent and incoherent multi-event examples, instruction-like synthetic semantic text, and meaningful versus noisy automation.

## Metrics and gate semantics

The deterministic scorer compares captured observations with the selected split. A visible positive is strictly `shouldPost = true AND status = recommended`. Visible false positives and false negatives use that same predicate; persisted suppressed outcomes are evaluated separately from feed visibility. Precision is null when no visible recommendation was produced, and then the gate is not satisfied (rather than treating an empty prediction set as perfect precision).

The scorer reports total, expected recommended, expected suppressed, expected no-opportunity, predicted suppressed, and predicted no-opportunity counts; visible TP/FP/FN, precision and recall; opportunity-type and format accuracy; shouldPost and suppression accuracy; duplicate-suppression accuracy; reason-signal precision/recall; provenance correctness; low-confidence withholding; novelty-threshold classification; and release/milestone exception correctness. No-opportunity and suppressed outcomes remain separate. A zero denominator yields null for that metric.

The only hard gate represented here is the current PDR visible-opportunity precision threshold of at least 0.75. All other metrics are informational; Task 3.2 adds no release threshold and does not define a numeric priorityScore formula.
