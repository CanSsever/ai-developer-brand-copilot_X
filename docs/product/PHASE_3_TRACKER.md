# Phase 3 — Content Opportunity & Explainability Tracker

This tracker records verified repository state for Phase 3. The governing implementation contract is `AI_Developer_Brand_Copilot_PDR_Codex_v1_1.md`, supplemented by the reviewed Phase 3 product decisions. Items are checked only after implementation and required verification succeed.

## Entry State

- [x] Phase 0 is VERIFIED COMPLETE
- [x] Phase 1 is VERIFIED COMPLETE
- [x] Phase 2 is VERIFIED COMPLETE
- [x] authoritative DevelopmentEvents and ProjectState are available for Phase 3 reuse
- [x] Phase 3 is limited to ContentOpportunity decisions, explainability, recommendation presentation, and opportunity feedback
- [x] ContentDraft, content generation, publishing, trends, audience intelligence, embeddings, and autonomous agents remain out of scope

## PDR Audit and Phase 3 Decomposition

The reviewed task breakdown is adopted as follows:

1. Task 3.1 — Content Opportunity Domain Contract & Persistence
2. Task 3.2 — Phase 3 Evaluation Corpus & Review Rubric
3. Task 3.3 — Authoritative Opportunity Input Selection
4. Task 3.4 — Structured Opportunity Detection
5. Task 3.5 — Novelty, Duplicate Suppression, Ranking & Persistence
6. Task 3.6 — Opportunity Run Orchestration & Reprocessing
7. Task 3.7 — Opportunity Read Model & Dashboard Cards
8. Task 3.8 — Accept/Dismiss Feedback
9. Task 3.9 — Phase 3 Evaluation & Exit Gate

## Task 3.1 — Content Opportunity Domain Contract & Persistence

### Approved Domain Contract

- [x] exact opportunity-type taxonomy is shared and database-backed
- [x] exact platform-neutral recommended-format taxonomy is shared and database-backed
- [x] lifecycle is `recommended | suppressed | expired`
- [x] user accept/dismiss feedback remains separate and deferred to Task 3.8
- [x] normalized machine-readable reason signals use only approved codes and effects

### Persistence, Identity, and Provenance

- [x] ContentOpportunity stores scores, confidence, should-post decision, lifecycle, versions, fingerprints, currentness, and timestamps
- [x] semantic candidate identity does not depend on title or mutable UI text
- [x] exact input/version replay is database-unique and only one current row exists per semantic candidate
- [x] provenance links only to same-Project DevelopmentEvents and rejects duplicates
- [x] semantic opportunity, provenance, and reason history is append-only while expiry remains possible
- [x] no fake ContentOpportunity rows are created

### Ownership, Privacy, and Verification

- [x] score, lifecycle, fingerprint, version, and reason-signal constraints are database-enforced
- [x] owner-only RLS permits authenticated reads and denies authenticated direct writes
- [x] Project deletion cascades while independent DevelopmentEvent deletion cannot detach opportunity provenance
- [x] no raw provider content, source, diff, prompt, response, token, or credential is persisted
- [x] focused tests and all required repository, database, build, and security gates pass

### Task Status

- [x] Task 3.1 VERIFIED COMPLETE

## Task 3.2 — Phase 3 Evaluation Corpus & Review Rubric

- [ ] NOT STARTED

## Task 3.3 — Authoritative Opportunity Input Selection

- [ ] NOT STARTED

## Task 3.4 — Structured Opportunity Detection

- [ ] NOT STARTED

## Task 3.5 — Novelty, Duplicate Suppression, Ranking & Persistence

- [ ] NOT STARTED

## Task 3.6 — Opportunity Run Orchestration & Reprocessing

- [ ] NOT STARTED

## Task 3.7 — Opportunity Read Model & Dashboard Cards

- [ ] NOT STARTED

## Task 3.8 — Accept/Dismiss Feedback

- [ ] NOT STARTED

## Task 3.9 — Phase 3 Evaluation & Exit Gate

- [ ] NOT STARTED

## Phase Status

- [x] Phase 0 VERIFIED COMPLETE
- [x] Phase 1 VERIFIED COMPLETE
- [x] Phase 2 VERIFIED COMPLETE
- [x] Phase 3 IN PROGRESS
- [ ] Phase 3 VERIFIED COMPLETE
- [x] Phase 4 NOT STARTED
