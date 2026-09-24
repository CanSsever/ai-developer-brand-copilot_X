# Phase 3 Opportunity Input Selection

Task 3.3 builds a deterministic, owner-scoped input boundary for future opportunity detection. It does not detect opportunities, score novelty, rank candidates, decide `shouldPost`, persist decisions, or invoke an AI provider.

## Authority and privacy

The selector and Phase 2 projection, daily-summary, and intelligence-read code share `authoritativeDevelopmentEventWhere`. Its predicate remains the Phase 2 rule: the event belongs to the selected Project, is active, and has at least one attached supporting commit whose raw commit is not orphaned, or an attached supporting pull-request evidence relation with its current raw pull-request relation. Candidate-only links do not establish authority. The selector adds only a Phase 3 defense-in-depth filter: confidence must be at least `0.600`; Phase 2 acceptance and projection semantics are unchanged.

The input contains DevelopmentEvent semantic fields and immutable identity/version fields, plus the evidence kinds that established authority. It excludes raw commit and pull-request payloads, source, patches, diffs, file contents, prompts, provider responses, and credentials. ProjectState contributes only its current row and bounded structured context; it never makes an ineligible event eligible. DailyDevelopmentSummary is not queried.

The service first scopes the Project lookup by both `projectId` and authenticated `userId`; absent and cross-user Projects return the same not-found response. Event and opportunity queries are explicitly scoped to that Project. Historical opportunity-to-event links are also filtered to same-Project events.

## Boundary and history window

Callers supply one explicit evaluation instant. The selector resolves its Project developer-day with the shared IANA-timezone helper, then selects opportunity history from local midnight 30 calendar days before that developer-day, inclusive, up to the start of the evaluation developer-day, exclusive. This is a calendar-day window, not 30 × 24 hours; it excludes current-day history and handles DST, month, and year boundaries. An opportunity's developer day is derived from `createdAt` in the Project timezone because the current Task 3.1 schema has no persisted opportunity developer-day field.

Recommended, suppressed, and expired records are retained with their status and `shouldPost` values. Safe history includes candidate/topic/type and scoring/input identity, plus same-Project linked event ID/type pairs and feature IDs. The selector does not infer publication or apply any meaning/penalty to those statuses.

## Deterministic bounds and ordering

The PDR specifies the date window and bounded ProjectState collections but does not set input cardinality caps. These conservative implementation limits are engineering/safety bounds, not scoring thresholds:

| Input | Bound | Truncation/order behavior |
| --- | ---: | --- |
| Authoritative events | 100 | newest `occurredAt`, then event ID descending; an explicit flag indicates more eligible rows existed |
| Opportunity history | 100 | newest created developer-day, then `createdAt` and opportunity ID descending; an explicit flag indicates more rows existed |
| Active, completed, or milestone state references | 20 per collection | newest `occurredAt`, then event ID ascending; per-collection truncation flags |
| Project technologies | 50 | lexical order and an explicit truncation flag |
| Event technologies / related feature IDs | 20 / 50 | lexical order and per-event truncation flags |
| Historical linked events / linked feature IDs | 100 / 100 | event ID and feature ID lexical order; explicit truncation flags |
| Event title / summary | 300 / 2,000 characters | deterministic prefix clipping with per-event flags |
| ProjectState purpose, audience, current phase | 500 characters each | deterministic prefix clipping; count reported in input truncation metadata |

Every output collection has explicit canonical ordering; object keys are recursively sorted for fingerprint serialization. Query results use database orderings consistent with these canonical rules. The selected Project, state identity/context, event semantics/versions, bounded history, timezone, evaluation instant/developer-day, truncation metadata, and selection version all participate in the fingerprint.

## Identity and query design

Selection version: `phase3-opportunity-input-v1`. It must change when authority rules, included fields, bounds/truncation, history-window semantics, canonical ordering, or ProjectState projection changes. The resulting SHA-256 input fingerprint is distinct from `topicKey`, `candidateKey`, and future `scoringVersion`.

The current schema already has the required `(projectId, createdAt)` ContentOpportunity index and ProjectState is unique per Project. No migration or index change is required. Reads run in one repeatable-read transaction, with a fixed number of owner, event, and opportunity-history queries; there is no per-event N+1 lookup.
