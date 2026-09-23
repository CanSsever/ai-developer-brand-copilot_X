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

## Task 2.3 — Development Event Interpretation

### PDR Interpretation Contract

- [x] the PDR requires model-assisted semantic interpretation; the existing backend OpenAI/model boundary is used rather than introducing another provider
- [x] interpretation accepts only a candidate reselected by the trusted Task 2.2 grouping service; callers cannot inject arbitrary repository evidence
- [x] the structured result uses the exact ten-value DevelopmentEvent taxonomy
- [x] the model supplies only semantic type, title, summary, importance score, content-potential score, confidence, technologies, and explicit evidence references
- [x] deterministic application code supplies event identity, occurrence time, lifecycle status, feature IDs, fingerprints, extraction version, provenance links, and supersession lineage
- [x] confidence below `0.60` is persisted as `rejected` for later inspection and never supersedes an active interpretation
- [x] a validated `insufficient_evidence` decision creates no DevelopmentEvent

### Backend AI Boundary and Privacy

- [x] OpenAI Responses API calls are backend-only, use the configured server-side model and API key, set `store: false`, and request a strict JSON Schema response
- [x] evidence is minimized to bounded commit messages, merged-PR title/body summary, structural file paths/metadata, timestamps, change totals, and internal evidence identifiers
- [x] source contents, diffs, patches, raw provider payloads, credentials, tokens, cookies, private keys, and database secrets are never included
- [x] model evidence is treated as untrusted data and cannot override system instructions
- [x] prompts containing repository evidence and raw model responses are neither logged nor persisted
- [x] routine logs contain only safe identifiers, versions, fingerprints, counts, and normalized failure codes
- [x] central observability redaction recognizes generic and OpenAI API-key field names

### Validation, Audit, and Reprocessing

- [x] every model attempt creates an `AIExecution` audit row before the request and records only required stage, model configuration, version, validation, timing, token-count, and safe failure metadata
- [x] prompt version is `development-event-prompt-v1` and schema version is `development-event-schema-v1`
- [x] input fingerprints cover canonical minimized evidence and the grouping boundary; extraction versions cover prompt, schema, and safe model configuration
- [x] malformed, out-of-taxonomy, out-of-range, or unsupported-evidence output receives at most one constrained repair attempt and otherwise fails safely
- [x] repeated interpretation under the same extraction boundary reuses the existing event without another model call
- [x] a materially new extraction version creates a new event and supersedes the prior active event without rewriting its historical semantic fields
- [x] commit and merged-PR provenance is persisted transactionally with the validated DevelopmentEvent
- [x] tenant ownership and cross-Project event linkage are protected by database constraints and authenticated read-only RLS

### Scope and Verification

- [x] interpretation remains an isolated callable backend capability; no worker wiring, ProjectState projection, browser endpoint, ContentOpportunity, recommendation, drafting, or Phase 3 behavior was added
- [x] automated model tests are deterministic and mocked; no live OpenAI call is required or was made
- [x] 55 focused Task 2.3 tests were added across interpretation, provider transport, strict output validation, configuration, and database audit controls
- [x] all 318 repository unit/integration tests pass: 282 API, 23 web, and 13 configuration tests
- [x] all 11 browser E2E tests pass
- [x] lint, typecheck, production build, Prisma generation, and Prisma schema validation pass
- [x] database connectivity passes; all 9 migrations are applied and the schema is up to date
- [x] Gitleaks history and trackable-content scans pass with no leaks
- [x] Task 2.2 grouping boundaries and Phase 1 ingestion regressions remain green

### Task Status

- [x] Task 2.3 VERIFIED COMPLETE

## Task 2.4 — Project State Projection

### PDR State Semantics

- [x] ProjectState is the single current structured state for one Project; ProjectStateVersion is its append-only snapshot history
- [x] only persisted active DevelopmentEvents belonging to the owned Project are authoritative projection inputs
- [x] rejected and superseded events are excluded; an active successor replaces its superseded predecessor in future projections without rewriting history
- [x] applied-event links identify the complete authoritative DevelopmentEvent set that produced each state version
- [x] purpose, target audience, and current phase remain null because validated DevelopmentEvents do not provide authoritative values for those fields
- [x] technologies are a deterministic normalized union; feature-started, feature-completed, release, project-milestone, and testing-milestone events populate their corresponding structured state collections, with explicit related-feature identities reconciling started features that later complete
- [x] recent milestones are limited to 20 events within 90 days of the latest authoritative event

### Deterministic Projection and Replay

- [x] projection uses no model call because validated DevelopmentEvents already provide the structured semantic inputs required for state aggregation
- [x] authoritative events are ordered by occurredAt, then createdAt, then immutable event ID
- [x] projection version is `project-state-projection-v2`; v2 excludes active historical events whose semantic supporting evidence is no longer valid
- [x] the SHA-256 replay fingerprint covers the projection version and canonical authoritative event identity, semantic fields, scores, technologies, feature references, and extraction metadata
- [x] an unchanged replay returns the existing current state/version and creates no duplicate snapshot or applied-event link
- [x] a changed authoritative event set creates the next version and updates the single current state
- [x] an empty authoritative set deterministically creates an empty versioned state anchored to Project creation time
- [x] the callable service supports later deterministic rebuild/replay without adding Task 2.5 orchestration

### Transactions, Concurrency, and Privacy

- [x] current-state mutation, immutable version creation, and applied-event provenance commit in one serializable transaction
- [x] compare-and-swap on the persisted current-state version detects stale projections; unique replay constraints and serializable conflicts fail safely
- [x] ProjectStateVersion and its applied-event links remain append-only and prior versions are unchanged after new events or supersession
- [x] Project ownership is checked from persistence and cross-Project events cannot enter the authoritative query or applied-event relation
- [x] malformed historical state, ownership failure, persistence failure, and concurrency conflicts fail without partial updates
- [x] lifecycle logs contain only Project ID, event count, projection version, state version, replay fingerprint, duration, result, and safe failure code
- [x] projection reads no raw GitHub evidence and logs no event title, summary, commit message, PR text, file path, source, diff, prompt, or model response
- [x] no worker/scheduler wiring, automatic reprocessing, ContentOpportunity, shareability, drafting, or Phase 3 behavior was added

### Verification

- [x] 32 focused deterministic Task 2.4 tests pass
- [x] all 350 repository unit/integration tests pass: 314 API, 23 web, and 13 configuration tests
- [x] Task 2.3 interpretation, Task 2.2 grouping, Task 2.1 persistence, and Phase 1 ingestion regressions remain green
- [x] lint, typecheck, production build, and all 11 browser E2E tests pass
- [x] Prisma client generation and schema validation pass
- [x] database connectivity passes; all 9 existing migrations are applied and the schema is up to date
- [x] Gitleaks history and trackable-content scans pass with no leaks
- [x] no schema change or migration was required

### Task Status

- [x] Task 2.4 VERIFIED COMPLETE

## Task 2.5 — Intelligence Pipeline Integration, Reprocessing & Idempotent Worker Execution

### Trigger and Durable Execution

- [x] only a fully succeeded persisted SyncRun makes its committed evidence boundary eligible; queued, running, failed, and cancelled SyncRuns never trigger intelligence processing
- [x] IntelligenceRun is the durable Project-owned processing unit and records its source SyncRun, fixed evidence window, trigger, complete processing-version set, lifecycle, attempts, retry time, lease, safe counters, and failure code
- [x] automatic discovery selects only the latest successful boundary per Project that lacks the current processing version; stale active versions are terminalized safely without replaying every historical SyncRun
- [x] explicit owned reprocessing selects the latest successful SyncRun and is version-aware; an identical source/version boundary is reused
- [x] the established Phase 1 polling loop services the independently claimed intelligence worker after synchronization work; no second scheduler or external queue was introduced
- [x] job persistence contains no repository evidence text, prompt, response, source, diff, patch, provider payload, or credential

### Orchestration, Partial Failure, and Projection

- [x] each claimed run calls EvidenceGroupingService, DevelopmentEventInterpreterService for every candidate, then ProjectStateProjectorService without duplicating their domain rules
- [x] candidate groups are processed independently, so successful groups remain durable when another group fails
- [x] any transient group failure defers the run and projection until all groups reach a stable decision; successful groups are reused on retry
- [x] terminal group failures do not discard successful events; authoritative successes are projected before the run records a terminal partial-cycle failure
- [x] insufficient-evidence and low-confidence decisions are stable completed outcomes rather than endless retry triggers
- [x] projection always reads current authoritative active DevelopmentEvents and retains Task 2.4 optimistic-concurrency protection

### Retry, Concurrency, Recovery, and Cost Control

- [x] atomic FOR UPDATE SKIP LOCKED claims, one-active-run-per-Project uniqueness, UUID lease fencing, heartbeat extension, and serializable downstream projection prevent duplicate concurrent execution
- [x] expired running leases are recoverable after process failure; queued and retryable rows survive API/worker restarts
- [x] transient failures use at most three attempts with exponential backoff; normalized provider Retry-After takes precedence
- [x] deterministic validation, refusal, configuration, and other terminal failures are not automatically hammered
- [x] the processing fingerprint covers grouping, interpretation, and projection versions; changed versions require explicit historical reprocessing while new SyncRuns use current versions
- [x] unchanged groups reuse DevelopmentEvents and provenance, persisted insufficient decisions skip another model request, and unchanged projection inputs create no ProjectStateVersion
- [x] a configured per-user developer-day OpenAI attempt ceiling defaults to 100 and is checked transactionally before AIExecution creation using the Project IANA timezone
- [x] no live GitHub access is used by the intelligence worker; provider disconnect stops new ingestion, while already durable derived history remains intact

### Ownership, RLS, Observability, and Verification

- [x] database validation constrains every IntelligenceRun to a succeeded SyncRun from the same Project and matching source window
- [x] authenticated clients have owned read-only RLS access; durable writes and claims remain trusted-backend operations
- [x] lifecycle telemetry contains only safe run IDs, Project IDs, version identifiers, counts, retry times, fingerprints, attempt numbers, and normalized failure codes; lease values and private evidence are never logged
- [x] 44 focused Task 2.5 tests were added across durable schema, orchestration, worker claims/recovery, retry timing, idempotency, AI budget control, and Phase 1 polling integration
- [x] all 394 repository unit/integration tests pass: 358 API, 23 web, and 13 configuration tests
- [x] Task 2.4 projection, Task 2.3 interpretation, Task 2.2 grouping, Task 2.1 persistence, and Phase 1 ingestion/worker regressions remain green
- [x] lint, typecheck, production build, and all 11 browser E2E tests pass
- [x] Prisma generation/validation and database connectivity pass; all 10 migrations are applied and current
- [x] Gitleaks history and trackable-content scans pass with no leaks
- [x] no live OpenAI call was made

### Task Status

- [x] Task 2.5 VERIFIED COMPLETE

## Task 2.6 — Intelligence Read Model & Internal Inspection

### PDR Read-Model Interpretation

- [x] the Phase 2 event review/debug requirement is satisfied by a Project-scoped inspection surface within the existing dashboard rather than a separate Phase 3-style experience
- [x] the read model exposes the current ProjectState, recent authoritative DevelopmentEvents, latest IntelligenceRun status, and safe version/provenance metadata
- [x] ProjectStateVersion history is retained internally but not exposed because the PDR requires append-only audit metadata, not user-facing state-history inspection in Task 2.6
- [x] AIExecution rows remain internal; extraction, projection, and processing versions provide sufficient safe inspection without exposing model configuration, prompts, responses, evidence, or token accounting

### API, Ownership, and Privacy

- [x] `GET /projects/:projectId/intelligence` is authenticated and resolves one Project through both Project ID and authenticated User ID
- [x] malformed, unknown, and cross-user Project identifiers use the same safe `404 Project not found` behavior
- [x] one bounded relation query returns current state, at most 20 active events, safe evidence counts, and the latest run without N+1 reads
- [x] events are ordered deterministically by occurrence time, creation time, and ID descending; rejected and superseded events remain internal
- [x] internal IntelligenceRun failure codes are reduced to safe generic codes and human-readable status messages; retry timing and safe group counters remain visible
- [x] commit messages, PR title/body, file paths, raw evidence, source, diffs, patches, prompts, model responses, AIExecution rows, credentials, provider payloads, lease data, and internal failure codes are absent from the contract and UI
- [x] read telemetry contains only Project ID, event count, state version, processing status, and request correlation supplied by existing observability
- [x] endpoint and dashboard reads call neither GitHub nor OpenAI

### Dashboard Inspection

- [x] the selected Project shows a focused Development intelligence section beneath existing repository and sync status
- [x] current ProjectState displays version/projection metadata, purpose, audience, phase, technologies, active features, completed features, and recent milestones
- [x] recent DevelopmentEvents display validated semantic title/summary, human-readable type, occurrence time, confidence, safe evidence-reference counts, and extraction version
- [x] no-intelligence, no-state, no-events, queued, running, retry-deferred, succeeded, terminal-failure, and isolated load-failure states use human-readable copy
- [x] no recommendation, shareability, post-generation, publishing, editing, or other Phase 3 control was added

### Verification

- [x] 27 focused Task 2.6 unit/integration tests were added: 18 API tests and 9 web tests
- [x] all 421 repository unit/integration tests pass: 376 API, 32 web, and 13 configuration tests
- [x] one synthetic Task 2.6 browser scenario was added and all 12 browser E2E tests pass
- [x] Task 2.5 worker/orchestration, Task 2.4 projection, Task 2.3 interpretation, Task 2.2 grouping, Task 2.1 persistence, and Phase 1 regressions remain green
- [x] lint, typecheck, and production build pass
- [x] Prisma generation/validation and database connectivity pass; all 10 migrations are applied and current
- [x] Gitleaks history and trackable-content scans pass with no leaks
- [x] no schema change or migration was required
- [x] no live OpenAI or GitHub call was made

### Task Status

- [x] Task 2.6 VERIFIED COMPLETE

## Task 2.7 — Development Intelligence Evaluation & Phase 2 Exit Gate

### Current Verification State

- [x] pre-flight confirmed a clean worktree with the Task 2.6 commit present
- [x] Prisma generation and validation, database connectivity, and migration status pass with all 10 migrations current
- [x] live private-repository processing authorization was granted for the current Task 2.7 repository verification only
- [x] an initial one-off backend runner attempt failed closed before database selection or network access when required OpenAI runtime configuration was absent
- [x] the configured runtime now passes normal application configuration validation without recording any secret value
- [x] the single authorized live attempt selected the current private repository and discovered two eligible evidence groups; bounded processing recorded four terminal `AI_CONFIGURATION_FAILURE` audit outcomes (two groups with the defined repair attempt)
- [x] the failed-closed live attempt created no DevelopmentEvents, no commit/PR provenance links, and no new ProjectState version; the safe durable result is two terminal failed IntelligenceRuns and four failed AIExecution audit rows
- [x] no retry or duplicate live model execution was performed after the safe failure category was observed
- [x] versioned `phase2-synthetic-v1` Phase 2 offline regression corpus and deterministic scorer/harness added: exactly 60 non-private synthetic scenarios (50 event scenarios across the 10-value taxonomy and 10 abstention scenarios), including PR-backed, standalone, multi-commit, confidence-boundary, and supersession cases
- [x] the corpus preserves the current PDR Phase 2 offline thresholds: event precision >= 0.80, event recall >= 0.70, and event-type accuracy >= 0.80; deterministic golden outputs score 1.00 on these regression measures
- [x] `phase2-synthetic-v1` is not the independently reviewable, development/held-out 100+ scenario Phase 5 release set and has not been run against OpenAI
- [x] provider failures are safely split across invalid request, authentication, authorization, missing model, rate limit, timeout/5xx, and network categories without reading provider response bodies
- [x] strict provider schema omits unsupported `uniqueItems` while application validation continues rejecting duplicate evidence references
- [x] outbound provider evidence is deterministically redacted and bounded by record, text, path, and UTF-8 serialized-byte limits without mutating persisted GitHub evidence
- [x] scoring policy `development-event-scoring-v1`, schema version, prompt version, model configuration, and lifecycle policy all contribute to interpretation and aggregate processing identity

### Cross-Layer Hardening

- [x] candidate-group membership and model-selected semantic support are both preserved on the existing provenance links through `candidate | supporting` roles; `supporting` implies candidate membership and existing historical links migrate as supporting
- [x] all evidence roles retain event-scoped uniqueness, Project/repository trigger enforcement, stable provider identity, RLS, and raw-evidence deletion history without copying evidence text
- [x] feature events receive a deterministic Project/repository-scoped identity from stable evidence lineage; the real interpreter-to-projector path reconciles `feature_started` to `feature_completed` without title matching
- [x] an evolved candidate supersedes active prior candidates only when their complete explicit candidate membership is contained in the new group; `[A] -> [A,B]` reconciles, unchanged `[A,B]` replays, unrelated candidates remain independent, and partial overlaps do not reconcile
- [x] ProjectState and the current read model require at least one currently valid supporting commit or supporting merged PR; orphaned-only meaning stops contributing while historical DevelopmentEvents and ProjectStateVersions remain intact
- [x] mixed support remains authoritative while one selected support is valid, and a supporting merged PR remains authoritative when a subordinate linked commit is orphaned
- [x] stale queued/retryable and expired-running IntelligenceRuns from older processing versions become auditable terminal failures before current-version eligibility; current claims remain lease-fenced and the one-active-run database invariant handles two-worker races
- [x] run counters distinguish accepted active events (`groupsSucceeded`) from low-confidence rejected events and insufficient-evidence decisions (`groupsRejected`); retryable and terminal failures remain `groupsFailed`
- [x] deterministic cross-layer and migration coverage passes for provenance subset preservation, feature lifecycle, evolved groups, orphan reconciliation, rejected/insufficient outcomes, superseded exclusion, replay idempotency, and stale-version recovery
- [x] hardening verification passes: 398 API tests, 32 web tests, and 13 configuration tests (443 total), plus 12 browser E2E tests
- [x] lint, typecheck, production build, Prisma generation/validation, database connectivity, Gitleaks scans, and `git diff --check` pass
- [x] additive migration `20260923120000_harden_development_event_lifecycle` is deployed; all 11 migrations are applied and current

### Remaining Phase 2 Blockers

- [ ] implement and verify `DailyDevelopmentSummary` in its dedicated follow-up
- [ ] obtain fresh scoped authorization and complete one successful private-repository live retry, semantic review, ProjectState/read-model verification, and identical-boundary idempotency proof
- [ ] complete final Phase 2 exit-gate verification against the governing PDR
- [ ] create and push the final Task 2.7 commit after explicit authorization
- [ ] verify the resulting hosted GitHub Actions run

### Task Status

- [x] Task 2.7 INCOMPLETE
- [ ] Task 2.7 VERIFIED COMPLETE

## Phase Status

- [x] Phase 0 VERIFIED COMPLETE
- [x] Phase 1 VERIFIED COMPLETE
- [ ] Phase 2 VERIFIED COMPLETE
- [x] Phase 2 IN PROGRESS
- [x] Phase 3 NOT STARTED
