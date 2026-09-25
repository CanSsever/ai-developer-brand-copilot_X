# Phase 3 Task 3.5 - Deterministic Opportunity Scoring

Task 3.5 consumes canonical owner-scoped Task 3.3 input and a complete, successfully validated Task 3.4 detector result. It deterministically calculates novelty, duplicate suppression, priority, shouldPost, lifecycle, and reason signals, then persists to existing ContentOpportunity tables. It does not draft content, call a model, synchronize GitHub, add an API route, or orchestrate detector runs.

## Eligibility and identity

The persistence service reselects Task 3.3 input for the owner, project, and evaluation boundary, and requires the canonical fingerprint to match. Candidate event IDs must all occur in that input. Task 3.4 reuse requires an owner-scoped Project, the dedicated opportunity_detection stage, successful execution, valid validation status, matching Task 3.3 input fingerprint, extraction/detector identity, model-configuration fingerprint, prompt version, schema version, and a complete persisted result. Candidate positions, selected-event counts, provenance positions, and event membership are checked again. A missing or incomplete matching result fails closed.

The selector remains authoritative for excluding non-current, superseded, rejected, or orphan-invalid DevelopmentEvents. ProjectState is not a source of event provenance. DailyDevelopmentSummary is not consumed. A zero-candidate detector result creates zero ContentOpportunity rows and expires prior current Task 3.5 rows in the same transaction.

Topic normalization is NFKC, locale-independent lowercase, Unicode letter/number/mark retention, and separator collapse to hyphens. Empty and over-160-code-point keys fail closed instead of truncating. Version: phase3-topic-normalization-v1.

Candidate identity is SHA-256 over the identity version, sorted unique DevelopmentEvent IDs, opportunity type, and normalized topic key. It deliberately excludes title, detector order, priority, and generated database IDs. Version: phase3-opportunity-candidate-v1. Same-run identity collisions fail closed.

The ContentOpportunity input fingerprint binds the Task 3.3 input fingerprint, Task 3.4 result/extraction/detector/model-configuration identity, validated candidate fields, and scoring/identity versions. Exact persistence identity remains Project + candidateKey + processing inputFingerprint + scoringVersion. An existing row is reused only after all semantic fields, provenance links, and ordered reason links are checked. Project-row locking plus a serializable transaction makes expiry, parent creation, and child creation atomic; database uniqueness remains the final concurrency guard.

## Deterministic policy

Only same-Project history with developer-day age 0 through 29 is considered. Expired and future-dated history is ignored. A current recommended row with the same normalized topic and opportunity type is an exact duplicate. Repetition considers opportunity type, supporting DevelopmentEvent type, and linked-feature overlap. A suppressed relevant item contributes 0.18; another relevant repeat contributes 0.08.

Novelty is 0 for any recent matching topic/type history, 0.30 for relevant history with both linked-feature overlap and opportunity/event-type overlap, 0.55 for another relevant opportunity/event-type/feature repeat, and 1.00 otherwise. Values are bounded to [0,1]. The novelty cutoff is 0.35. A release exception is recognized only when candidate type and a selected authoritative event type jointly ground release or milestone, and the novelty cutoff would otherwise suppress it. It does not bypass confidence, invalid provenance, structural validation, priority threshold, or exact duplicate suppression. This follows the PDR distinction between the novelty exception and duplicate detection.

Candidate confidence is the lower of detector confidence and mean confidence of its selected authoritative events. Importance and content potential are arithmetic means of selected events. Freshness uses the Project developer-day in the selected timezone: age 0 => 1.00; age 1-2 => 0.85; age 3-7 => 0.60; age 8-14 => 0.30; older => 0.00. The scorer does not use the wall clock.

Priority is rounded to three decimals after the weighted sum:

importance * 0.18 + contentPotential * 0.18 + freshness * 0.14 + novelty * 0.18 + confidence * 0.14 + (1 - repetitionPenalty) * 0.18

shouldPost is true only when confidence is at least 0.60, priority is at least 0.60, novelty is at least 0.35 or the grounded release/milestone novelty exception applies, and the candidate is not an exact duplicate. Otherwise it is false. Status is recommended for true and suppressed for false. Task 3.5 never creates accepted, dismissed, draft, or published lifecycle states.

Reason signals use only approved positive/negative codes and stable positive-taxonomy then negative-taxonomy order. high_importance and high_content_potential require component score at least 0.75; fresh_work requires freshness at least 0.80; novel_topic requires novelty at least 0.70; low_novelty is emitted below 0.35; low_confidence is emitted below 0.60; repetition_penalty is emitted only for a nonzero penalty; duplicate_topic only for an exact current duplicate. Numeric values are bounded and rounded to three decimals; every signal links only to selected candidate events. feature_completed is emitted only for selected events of that type; release_or_milestone requires a grounded release/milestone event; multi_event_story requires at least two selected events.

## Storage, ownership, privacy

No migration or schema change was required. The Task 3.1 ContentOpportunity parent and provenance/reason child tables provide required fields, uniqueness/currentness constraints, same-Project triggers, and owner-read-only RLS. Writes require a verified owner/project pair. No prompts, provider responses, raw GitHub evidence, tokens, or credentials are persisted by Task 3.5. No new read endpoint or dashboard behavior is included.

## Development-only evaluation

The adapter invokes only getPhase3DevelopmentScenarios and scorePhase3DevelopmentEvaluation. Expected Task 3.4 semantic candidate presence/type/topic/format/provenance are used as oracle input so evaluation isolates Task 3.5 decisions; it is not end-to-end detector precision. No held-out getter/scorer or held-out expectations are accessed. Corpus pins are unchanged.

Final development report (80 scenarios; phase3-opportunity-v1):

- Visible precision 0.8958 (43 TP, 5 FP; hard gate 0.75 passes); visible recall 0.9556 (2 FN).
- shouldPost and suppression accuracy 0.8955.
- Opportunity type and format accuracy 1.0000; provenance accuracy 1.0000.
- Duplicate-suppression accuracy 0.8209; novelty-threshold accuracy 0.9194; low-confidence withholding accuracy 1.0000.
- Release/milestone exception accuracy 0.9104.
- Reason-signal precision 0.3628 and recall 0.8849. This is a known quality limitation: approved rule-based signals are over-emitted relative to frozen reviewer labels and are not fully calibrated.

The frozen DEV rubric contains material semantic tensions that were not fixed with fixture-specific code. Its generic duplicate evaluator exempts release/milestone cases from duplicate suppression, while the PDR says the exception bypasses the novelty cutoff; it also contains the reviewed 033/040 suppressed-history duplicate/nonduplicate disagreement where structured history is materially indistinguishable. The implementation follows the PDR. Resolve these through corpus review/adjudication, not by changing corpus pins or encoding scenario IDs in the scorer.

## Exclusions

Task 3.6 run orchestration, Task 3.7 read model/UI, Task 3.8 feedback, Task 3.9 exit evaluation, Phase 4 drafting, publishing, trends, audience intelligence, embeddings, autonomous agents, live provider calls, and GitHub sync are out of scope.
