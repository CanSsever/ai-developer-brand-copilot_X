# Phase 2 — Development Intelligence Tracker

This tracker records verified repository state for Phase 2. The governing implementation contract is `AI_Developer_Brand_Copilot_PDR_Codex_v1_1.md`. Repository reality remains authoritative, and items are checked only after implementation and required verification succeed.

## Entry State

- [x] Phase 0 is VERIFIED COMPLETE
- [x] Phase 1 is VERIFIED COMPLETE
- [x] normalized commit, commit-file, merged pull-request, pull-request-file, and pull-request-to-commit evidence is available for reuse
- [x] Phase 2 is limited to raw evidence → DevelopmentEvent → ProjectState
- [x] ContentOpportunity, recommendations, drafting, publishing, and social integrations remain Phase 3+

## PDR Audit and Phase 2 Decomposition

The proposed task breakdown matches the PDR's Development Intelligence boundary and is adopted as follows:

1. Task 2.1 — Development Intelligence Persistence Foundation
2. Task 2.2 — Evidence Selection & Grouping
3. Task 2.3 — Development Event Interpretation
4. Task 2.4 — Project State Projection
5. Task 2.5 — Reprocessing, Idempotency & Worker Integration
6. Task 2.6 — Intelligence Read Model / Internal Inspection
7. Task 2.7 — Phase 2 Evaluation & Exit Gate

PDR semantics used by the foundation:

- one DevelopmentEvent represents a semantic development outcome, not necessarily one commit
- multiple commits and a merged pull request may support the same event
- one raw evidence record may support more than one event
- every event remains traceable to normalized raw evidence without copying provider payloads, source, patches, or credentials
- material reprocessing creates a new event that supersedes the previous event instead of silently changing historical meaning
- ProjectState has exactly one current row per Project plus immutable version snapshots and the DevelopmentEvents applied to each snapshot
- ProjectState supports optimistic concurrency through `version` and replay identity through source fingerprint and projection version
- Phase 3 entities and content-generation concerns do not belong in the Phase 2 foundation

## Task 2.1 — Development Intelligence Persistence Foundation

### DevelopmentEvent

- [x] `DevelopmentEvent` is owned through `Project`
- [x] all PDR-defined initial event types are represented exactly
- [x] lifecycle status is `active | superseded | rejected`
- [x] title, summary, occurrence time, technologies, related feature IDs, PDR scores, extraction version, and input fingerprint are durable
- [x] score values are database-constrained to the inclusive `0..1` range
- [x] event key and input fingerprint use deterministic SHA-256-shaped identifiers
- [x] `Project + eventKey + extractionVersion` is database-unique without prematurely defining Task 2.2 semantic grouping
- [x] material reprocessing lineage is one-to-one and constrained to the same Project
- [x] no fake DevelopmentEvent rows or interpreted content were created

### Evidence Provenance

- [x] commit provenance uses `DevelopmentEventCommitEvidence`
- [x] merged pull-request provenance uses `DevelopmentEventPullRequestEvidence`
- [x] evidence-link uniqueness is event-scoped
- [x] the same raw record may support different events
- [x] database triggers reject cross-Project evidence relationships and mismatched stable provider identities
- [x] stable commit SHA / provider pull-request identity remains after raw evidence removal
- [x] raw evidence deletion detaches provenance rather than deleting the DevelopmentEvent
- [x] no source, patch, diff, raw provider payload, token, or credential is copied

### ProjectState

- [x] exactly one current `ProjectState` may exist per Project
- [x] current state remains structured through scalar, string-array, and validated JSON-array fields
- [x] optimistic concurrency is supported through an integer version constrained to `>= 1`
- [x] `ProjectStateVersion` retains immutable structured snapshots
- [x] snapshot version and replay fingerprint identities are database-unique
- [x] `ProjectStateVersionEvent` records each applied DevelopmentEvent once
- [x] applied-event links are constrained to the same Project
- [x] no ProjectState projection service or interpreted state was created

### Ownership, RLS, and Lifecycle

- [x] all six new tenant-domain tables have RLS enabled
- [x] authenticated SELECT resolves through the owning Project/User
- [x] authenticated direct INSERT, UPDATE, and DELETE remain denied
- [x] backend privileged access remains compatible with the established non-FORCE-RLS design
- [x] Project deletion cascades through DevelopmentEvent, provenance, ProjectState, and version history
- [x] raw GitHub evidence deletion does not silently destroy derived intelligence
- [x] existing Phase 0/1 ownership, RLS, ingestion, and connection behavior is unchanged

### Migration and Verification

- [x] one focused forward migration deployed to the configured development database
- [x] Prisma schema validates and client generation succeeds
- [x] focused deterministic persistence/migration tests pass
- [x] full repository lint, typecheck, test, build, and E2E gates pass
- [x] migration status and database connectivity checks pass
- [x] secret scan and repository hygiene checks pass

### Task Status

- [x] Task 2.1 VERIFIED COMPLETE

## Task 2.2 — Evidence Selection & Grouping

### PDR Grouping Interpretation

- [x] grouping is deterministic evidence organization and does not create semantic DevelopmentEvents
- [x] merged pull requests are the strongest available grouping boundary
- [x] explicitly linked commits and a selected merge commit remain supporting evidence in the PR-backed group
- [x] PR-linked commits are not duplicated as unrelated standalone candidates
- [x] a raw commit may overlap multiple PR-backed candidates only when GitHub explicitly links it to multiple merged pull requests
- [x] merge commits do not independently create duplicate candidates when selected constituent commits are already represented
- [x] the PDR requires multi-commit grouping but does not prescribe a detailed heuristic, so ambiguous standalone evidence is handled conservatively

### Evidence Selection

- [x] selection requires one owned Project and its active ConnectedRepository and active GitHubConnection
- [x] callers supply a fixed evaluation boundary and source-window start; the window is limited to 30 days
- [x] selection is capped at 500 commits and 500 merged pull requests and fails instead of silently truncating
- [x] only non-orphaned commits inside the fixed window are eligible
- [x] commits with recognized case-insensitive GitHub `[bot]` login suffixes are excluded by default; commits with no provider login remain eligible
- [x] only closed merged-pull-request evidence inside the fixed window is eligible
- [x] already considered raw evidence may be regrouped deterministically; Task 2.5 owns durable reprocessing orchestration

### Deterministic Grouping Rules

- [x] PR-backed candidates are built before standalone candidates from provider-linked commit SHAs plus selected merge-commit evidence
- [x] remaining standalone commits group only across a direct parent/child edge, exact normalized file-path overlap, and at most 24 hours of separation
- [x] temporal proximity or file overlap alone never groups standalone commits
- [x] input order does not affect candidate membership, evidence ordering, group ordering, or keys
- [x] equal timestamps use stable provider identity and internal-ID tie-breakers
- [x] every candidate is isolated to one Project and one ConnectedRepository
- [x] grouping version is `evidence-grouping-v1`
- [x] candidate keys are SHA-256 hashes over grouping version, Project ID, ConnectedRepository ID, sorted commit SHAs, and sorted provider pull-request IDs

### Output, Persistence, and Privacy

- [x] the internal candidate contract contains only group key, Project/repository scope, ordered commit and pull-request evidence IDs, evidence time range, grouping version, and structural reason
- [x] no semantic title, summary, type, score, confidence, or interpreted content is produced
- [x] candidate groups are deterministic transient internal values; no table or migration was added because durable interpretation, lineage, and replay foundations already belong to DevelopmentEvent and Task 2.5
- [x] no pending or fake DevelopmentEvent shell is created; Task 2.3 owns semantic interpretation
- [x] no source, diff, patch, file content, provider payload, message, PR text, file path, token, or credential enters candidate output or logs
- [x] logs contain only internal Project ID, safe counts, and grouping version
- [x] the component performs no provider, network, OpenAI, or other LLM call and is not connected to the Phase 1 worker

### Verification

- [x] 21 focused synthetic Task 2.2 tests pass
- [x] all 263 repository unit/integration tests pass: 228 API, 23 web, and 12 configuration tests
- [x] all 11 browser E2E tests pass
- [x] lint, typecheck, and production build pass
- [x] Prisma client generation and schema validation pass
- [x] database connectivity passes; all 8 migrations are applied and the schema is up to date
- [x] Gitleaks history and trackable-content scans pass with no leaks
- [x] Phase 1 ingestion and Task 2.1 persistence regressions remain green
- [x] no schema change or migration was required

### Task Status

- [x] Task 2.2 VERIFIED COMPLETE

## Remaining Phase 2 Tasks

- [ ] Task 2.3 — Development Event Interpretation: NOT STARTED
- [ ] Task 2.4 — Project State Projection: NOT STARTED
- [ ] Task 2.5 — Reprocessing, Idempotency & Worker Integration: NOT STARTED
- [ ] Task 2.6 — Intelligence Read Model / Internal Inspection: NOT STARTED
- [ ] Task 2.7 — Phase 2 Evaluation & Exit Gate: NOT STARTED

## Phase Status

- [x] Phase 0 VERIFIED COMPLETE
- [x] Phase 1 VERIFIED COMPLETE
- [ ] Phase 2 VERIFIED COMPLETE
- [x] Phase 2 IN PROGRESS
- [x] Phase 3 NOT STARTED
