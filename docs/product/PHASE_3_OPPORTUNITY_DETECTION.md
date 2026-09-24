# Phase 3 Structured Opportunity Detection

Task 3.4 maps a canonical Task 3.3 selection to zero or more validated semantic candidates. It does not make postability, novelty, ranking, lifecycle, publication, or drafting decisions.

## Candidate contract and bounds

Each candidate contains only:

- supplied DevelopmentEvent IDs
- approved opportunity type and recommended format
- bounded title (300 characters)
- bounded semantic topicDescriptor (240 characters)
- detector confidence in [0, 1]

Candidate arrays are bounded at 12 and each candidate references 1–20 events. These are engineering/safety limits, not product-quality thresholds. Changes to bounds require a schema/detector identity version change. Candidate event IDs are sorted lexically; candidate rows use a stable semantic comparator. Duplicate IDs and exact duplicate candidate rows fail closed.

The AI topic descriptor is not a normalized topicKey. No candidateKey, score, reason signal, shouldPost, lifecycle, or ContentOpportunity decision is produced here. Empty candidate arrays are valid successful results.

## Prompt and privacy boundary

The backend Responses API receives an explicit allowlist projected from CanonicalPhase3OpportunityInput: bounded semantic DevelopmentEvent fields and bounded current ProjectState context. ProjectState/history IDs are not candidate provenance; only supplied DevelopmentEvent IDs pass application grounding. Opportunity history is intentionally omitted from provider input so this detector cannot perform Task 3.5 novelty or duplicate suppression. It remains part of the Task 3.3 fingerprint and therefore the execution reuse identity.

The adapter sanitizes and bounds text, caps serialized input at 384,000 bytes, uses strict Structured Outputs, the configured backend model, a 30-second timeout, and store:false. Raw commits, PR bodies, code, diffs, patches, files, provider history, daily summaries, prompts, responses, and credentials are neither loaded nor persisted. Semantic input text is untrusted data, never instructions.

Prompt version: phase3-opportunity-prompt-v1
Schema version: phase3-opportunity-schema-v1
Domain validation version: phase3-opportunity-validation-v1
Detector version: phase3-opportunity-detector-v1

The persisted extraction identity is SHA-256 over detector, Task 3.3 input-selection, prompt, schema, validation, and model-configuration identities. The model-configuration fingerprint includes model name, strict response mode, storage/timeout/output/input bounds, and candidate bounds. It is distinct from Task 3.5 scoringVersion.

## Attempts, reuse, and persistence

Every actual initial or repair provider request creates its own AIExecution row and consumes the existing per-user Project-local developer-day attempt budget. The repair is marked with safe isRepairAttempt audit metadata. Only a provider-successful but invalid structured/domain result can receive one repair; transport/provider failures are classified and never semantically repaired.

The hardening migration enforces one successful-valid canonical AIExecution per complete Project/stage/input/model/configuration/prompt/schema/extraction identity. Concurrent callers may both reach the provider; the database unique index allows only one complete result to commit. A persistence loser is terminalized as failed and reloads the winner's complete validated result before returning. Both real provider attempts remain represented in AIExecution and consume budget. This is result idempotency, not Task 3.6 in-flight orchestration.

Reuse requires an owner-scoped matching AIExecution with the dedicated opportunity_detection stage, canonical Task 3.3 input fingerprint, model and model-configuration fingerprint, prompt/schema versions, detector extraction identity, successful status, and valid validation status. Its linked OpportunityDetectionResult must also exist and pass candidate-count, deterministic-position, provenance-count, event-grounding, and domain validation. Missing or incomplete result data fails closed. A zero-candidate result is persisted as a result row with candidateCount = 0 and no candidate children, so it can be reused.

OpportunityDetectionResult, OpportunityDetectionCandidate, and candidate-to-DevelopmentEvent provenance are separate from ContentOpportunity. Persistence is atomic with successful/valid AIExecution completion. Database constraints and deferred validation enforce complete result/candidate/provenance ordering and same-Project provenance. Authenticated users receive owner-scoped read access only; direct authenticated writes remain revoked.

No AI input/output payload fields are persisted. Database triggers reject updates to result, candidate, provenance, and successful execution identity semantics. Direct child/result deletion cannot leave a successful result incomplete; deleting the parent execution or Project retains the existing cascade cleanup behavior. No public endpoint or worker is added in Task 3.4.
