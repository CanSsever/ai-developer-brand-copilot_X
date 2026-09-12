# AI Developer Brand Copilot
## Project Development Requirements (PDR) — Codex Execution Reference
**Version:** 1.1  
**Source of Truth:** This document is the normative implementation source of truth for MVP Phases 0–5. The earlier Master Project Specification v2.0 is background context only unless a requirement from it is explicitly incorporated here.  
**Purpose:** This document is the self-contained implementation contract for Codex Agent and the product/engineering team.

Normative language:

- `must` / `must not`: required for acceptance
- `should` / `should not`: expected unless an ADR documents a justified exception
- `may`: optional and must not block the current phase exit gate

If this document contains an internal conflict, the more specific requirement wins. If equally specific requirements conflict, implementation must stop and request a product decision rather than guessing.

---

# 1. Product Definition

AI Developer Brand Copilot is a web-based AI product that analyzes a developer's real software-development activity and transforms it into explainable, high-quality Build in Public content opportunities.

The product must not directly turn every GitHub commit into a social post.

The core product logic is:

```text
GitHub Raw Activity
        ↓
DevelopmentEvent
        ↓
ProjectState
        ↓
ContentOpportunity
        ↓
Explainable Recommendation
        ↓
ContentDraft
        ↓
User Edit / Save / Copy / Manual Publish
```

The initial objective is not social-media automation.

The initial objective is to reliably reduce the developer's cognitive burden around:

> "What should I share about what I built today?"

---

# 2. Core Product Hypothesis

A developer should be able to continue building normally while the system:

1. Understands what changed.
2. Distinguishes meaningful development activity from noise.
3. Identifies what is worth sharing.
4. Explains why it is worth sharing.
5. Generates a usable content draft.
6. Keeps the user in control.

The MVP is successful when it satisfies the measurable Phase 5 release gate in Section 19. Product-value targets are evaluated over at least 20 dogfooding developer-days from at least 3 consenting developers. If fewer than 3 developers are available, the product may continue as an internal alpha but must not be declared MVP-released.

## 2.1 Product Terminology

- **User:** An authenticated person who owns their product data.
- **GitHub Identity:** The GitHub account used for sign-in.
- **GitHub Connection:** A separately authorized GitHub repository-access integration.
- **Repository:** A provider-owned source repository selected through a GitHub Connection.
- **Project:** The product-level workspace analyzed by the copilot. In MVP, one Project maps to exactly one connected Repository.
- **Developer Day:** A calendar day in the user's configured IANA timezone.
- **Raw Activity:** Stored GitHub commit and pull-request metadata. It is evidence, not a recommendation.
- **DevelopmentEvent:** A semantic development outcome inferred from one or more evidence records.
- **ContentOpportunity:** A scored, explainable decision about whether one or more DevelopmentEvents are worth sharing.
- **ContentDraft:** User-controlled generated copy created only from an accepted ContentOpportunity.

The default user timezone is captured from the browser during onboarding and persisted as an IANA timezone identifier. The user may change it. All “today” boundaries and daily summaries must use this stored timezone; database timestamps remain UTC.

---

# 3. MVP Scope Lock

The following capabilities are part of the MVP.

## Build Now

- Supabase Auth sign-in with GitHub
- Separate GitHub App installation for repository access
- Repository listing
- Repository selection
- Commit synchronization
- Merged pull-request metadata synchronization for the selected repository and synchronization window
- Incremental and idempotent ingestion
- DevelopmentEvent extraction
- DevelopmentEvent classification
- Importance scoring
- Confidence scoring
- Evidence linking
- Structured ProjectState
- Daily development summary
- ContentOpportunity detection
- Should-post decision
- Priority scoring
- Novelty scoring
- Explainable reason signals
- X single-post draft generation
- Draft editing
- Draft saving
- Draft regeneration
- Copy to clipboard
- Manual mark-as-published flow
- Published URL storage
- Product feedback events
- Technical observability
- AI evaluation and regression testing

## Explicitly Deferred

Do not build these before the MVP exit gate:

- Trend Intelligence
- Audience Intelligence
- Automatic Voice Learning
- Automatic social publishing
- X thread generation
- Advanced social analytics
- Autonomous agents
- Full media intelligence
- Cross-platform orchestration
- Complex vector memory
- Autonomous growth actions
- Weekly content strategy engine

Scope expansion requires an explicit new task or product decision.

---

# 4. Architectural Principles

## 4.1 Raw Data Is Not Domain Intelligence

GitHub commits and pull requests are raw evidence.

They must not become the central product abstraction.

Downstream intelligence must operate primarily on:

- `DevelopmentEvent`
- `ProjectState`
- `ContentOpportunity`

Architectural rule:

> The Content Opportunity Engine must not directly treat GitHubCommit as its primary input.

Raw activity must first be normalized into domain intelligence.

---

## 4.2 Structured State Is the Source of Truth

The database is the source of truth.

LLM memory is not the source of truth.

Project history must be represented through structured database state rather than unbounded conversational or vector memory.

The first version uses:

- ProjectState
- DevelopmentEvent history
- ContentOpportunity history
- ContentDraft history
- PublicationFeedback

---

## 4.3 Explainability Is Mandatory

Recommendations must not be explained only through unconstrained LLM prose.

The system must first generate or calculate machine-readable reason signals.

Example:

```text
Feature completed today
High novelty score
No previous content about this feature
Strong demo potential
```

The UI may convert stored signals into human-readable language.

---

## 4.4 AI Must Be Stage-Based

Do not implement the entire intelligence pipeline as one giant prompt.

AI orchestration must be separated into testable stages:

1. Activity preparation / summarization
2. DevelopmentEvent extraction
3. Event classification and scoring
4. ProjectState update
5. ContentOpportunity detection and ranking
6. Recommendation explanation assembly
7. Content draft generation

Each stage must have:

- Explicit inputs
- Explicit outputs
- Validation
- Error handling
- Model metadata
- Prompt version
- Observability

---

# 5. Locked Technology Stack

## Frontend

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui

## Backend

- NestJS
- TypeScript
- REST API

## Database

- PostgreSQL
- Supabase

## ORM

- Prisma

## Authentication

- Supabase Auth
- GitHub OAuth for user sign-in
- GitHub App installation for repository access

Authentication and repository authorization are separate concerns:

- Supabase Auth establishes the application user identity.
- A GitHub App installation grants access only to repositories explicitly selected by the user.
- The frontend must never receive a GitHub installation access token.
- The backend must generate short-lived installation tokens only when required and must not persist them after expiry.
- GitHub App private keys and webhook secrets must be stored only in the deployment secret manager.
- Disconnect must stop jobs immediately, remove the local installation reference, and guide or initiate GitHub App installation revocation where the provider permits it.
- A user may connect more than one installation, but a Project belongs to exactly one installation and one repository in MVP.
- Authentication session failure and GitHub authorization failure must be represented as different user-facing errors.

## AI

- OpenAI API
- Backend-only integration

## Background Jobs

Start with:

- Supabase Cron schedules synchronization work.
- A Postgres-backed queue records durable jobs.
- The NestJS worker consumes jobs, applies retry policy, and records terminal failures.

Jobs must use an idempotency key, have at most 3 retry attempts with exponential backoff, and move to a queryable terminal-failure state after the last attempt. A user-triggered retry creates a new attempt linked to the failed job. Only introduce Redis + BullMQ through an ADR after measured queue limitations block an accepted requirement.

## Testing

- Vitest
- Supertest
- React Testing Library
- Playwright

## CI/CD

- GitHub Actions

## Repository

- pnpm monorepo

## Hosting

Frontend:
- Vercel

Backend:
- Container-based hosting

---

# 6. Target Monorepo Structure

```text
developer-brand-copilot/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── shared/
│   ├── contracts/
│   ├── config/
│   └── ai/
├── docs/
│   ├── architecture/
│   ├── product/
│   ├── adr/
│   └── api/
└── .github/
    └── workflows/
```

Package boundaries must remain explicit.

Applications may depend on packages.

Packages must not depend on applications.

Avoid circular dependencies.

## 6.1 API and Trust Boundaries

- The web application communicates with the NestJS API through versioned REST endpoints under `/api/v1`.
- Shared request and response schemas live in `packages/contracts` and are validated at the API boundary.
- Supabase access tokens authenticate API requests. The API must verify signature, issuer, audience, expiry, and subject before using `sub` as the application user identifier.
- Browser code must not access domain tables directly. All domain writes and repository-data reads go through the API.
- Queue consumers and scheduled jobs run server-side and must re-check ownership and connection status before work begins.
- Error responses use a stable machine-readable error code, safe user message, correlation ID, and appropriate HTTP status. Provider payloads and secrets must not be returned.

## 6.2 Ownership and Data Isolation

Every user-owned root record must contain `userId`. Every descendant must be reachable through a user-owned parent and must never be fetched only by an unscoped public identifier.

MVP ownership rules:

```text
User
├── GitHubConnection
│   └── ConnectedRepository
│       └── Project
│           ├── Commit / PullRequest / SyncRun
│           ├── DevelopmentEvent
│           ├── ProjectState
│           ├── ContentOpportunity
│           └── ContentDraft / Feedback
└── ContentPreferences
```

- All user-originated API queries must include or derive the authenticated `userId` constraint.
- PostgreSQL Row Level Security must be enabled for user-owned tables as defense in depth.
- The service role may bypass RLS only inside trusted API and worker processes; it must never be exposed to the client.
- IDs exposed externally must be non-sequential UUIDs.
- Authorization failures return `404` when revealing resource existence would leak another user's data.
- Database integration tests must prove that User A cannot read or mutate User B's records.
- MVP has no shared projects, organizations, roles, or invitations.

## 6.3 Minimum REST Resource Surface

Exact payloads belong in `packages/contracts` and generated API documentation, but MVP must keep these resource boundaries:

- `/auth/session` — authenticated application identity and connection summary
- `/github/connections` — GitHub App installation state and disconnect
- `/repositories` — authorized repository listing and connection selection
- `/projects` — project metadata and configured timezone
- `/projects/:projectId/sync-runs` — manual sync and status history
- `/projects/:projectId/development-events` — evidence-backed event list
- `/projects/:projectId/daily-summaries` — developer-day summary
- `/projects/:projectId/opportunities` — ranked recommendations and feedback
- `/opportunities/:opportunityId/drafts` — generation and version history
- `/drafts/:draftId` — edit, save, copy telemetry, and publication state
- `/preferences/content` — explicit user preferences
- `/account/data` — export and deletion request state

List endpoints use cursor pagination and bounded page sizes. Mutation endpoints that can be retried by the browser accept an idempotency key. Contracts must distinguish validation, authentication, authorization/not-found, conflict, rate-limit, provider, and AI-stage failures.

---

# 7. Core Domain Model

## 7.0 Common Persistence Rules

- Primary keys are UUIDs.
- Mutable records contain `createdAt` and `updatedAt`; timestamps are stored in UTC.
- Externally sourced records contain provider identifiers and provider timestamps separately from local timestamps.
- Scores use a decimal range from `0.0` to `1.0`, inclusive.
- Confidence means estimated reliability of the classification, not content quality.
- Status values are database-backed enums or constrained strings shared through `packages/contracts`.
- Deleting a user cascades to product-owned data through an auditable deletion job. Raw provider data must not be orphaned.
- Schema changes require a forward migration and an updated Prisma schema. Production migrations must not depend on `prisma db push`.

## 7.1 Raw Source Models

### Repository

Represents a connected source repository.

Minimum concepts:

- provider
- owner
- repository identifier
- default branch
- connection status
- synchronization state

Constraints:

- Unique provider repository ID per GitHub installation.
- Exactly one active Project per connected repository in MVP.
- Connection status: `active | disconnected | authorization_error`.

### Commit

Minimum concepts:

- SHA
- author
- message
- timestamp
- changed file metadata
- additions/deletions summary

### PullRequest

Minimum concepts:

- title
- body summary
- state
- merged timestamp
- linked commits

### SyncRun

Minimum concepts:

- sync cursor
- started time
- finished time
- status
- error metadata
- deduplication metadata

Status lifecycle:

```text
queued → running → succeeded
                 ↘ failed_retryable → queued
                 ↘ failed_terminal
queued/running → cancelled when the repository is disconnected
```

Only one active SyncRun may exist per connected repository. Each run has a unique idempotency key derived from repository, synchronization window, and cursor version.

## 7.2 Minimum Database Uniqueness Rules

- `GitHubConnection(userId, providerInstallationId)` is unique.
- `ConnectedRepository(gitHubConnectionId, providerRepositoryId)` is unique.
- `Commit(connectedRepositoryId, sha)` is unique.
- `PullRequest(connectedRepositoryId, providerPullRequestId)` is unique.
- Evidence links between a DevelopmentEvent and a raw record are unique.
- A generated AI artifact is unique by stage, input fingerprint, prompt version, and model configuration unless explicitly regenerated by the user.

---

# 8. DevelopmentEvent

`DevelopmentEvent` is the core domain entity of the product.

A DevelopmentEvent is not necessarily one commit.

It represents the semantic development meaning extracted from one or more raw evidence records.

Expected structure:

```text
DevelopmentEvent
- id
- projectId
- type
- title
- summary
- importanceScore
- contentPotentialScore
- confidence
- occurredAt
- technologies[]
- relatedFeatureIds[]
- evidenceRefs[]
- extractionVersion
- inputFingerprint
- status
- createdAt
```

Initial supported event types:

- feature_started
- feature_completed
- bug_fixed
- ui_improved
- architecture_decision
- testing_milestone
- performance_improvement
- release
- project_milestone
- refactor_completed

Event extraction must support:

- multi-commit grouping
- noise filtering
- event classification
- evidence traceability
- scoring
- confidence
- structured validation

DevelopmentEvent status is `active | superseded | rejected`. Reprocessing must not silently mutate the historical meaning of an active event. If material output changes, the new event supersedes the previous event and keeps evidence lineage.

Score definitions:

- `importanceScore`: estimated significance to the project's progress.
- `contentPotentialScore`: estimated suitability as raw material for an external update, independent of whether it is novel.
- `confidence`: reliability of event existence, grouping, and classification.

An event with confidence below `0.60` must not automatically create a postable ContentOpportunity. It may appear in the internal review/debug view. Initial thresholds are configuration values with a recorded scoring version and may change only with evaluation evidence.

---

# 9. ProjectState

ProjectState represents the current structured state of a project.

Expected structure:

```text
ProjectState
- id
- projectId
- purpose
- targetAudience
- technologies[]
- currentPhase
- activeFeatures[]
- completedFeatures[]
- recentMilestones[]
- recentDevelopmentEvents[]
- recentContentTopics[]
- lastUpdatedAt
- version
```

Rules:

- It must remain structured.
- It must be persisted.
- LLM calls should receive only relevant slices of context.
- The entire project history must not be injected into every prompt.
- There is exactly one current ProjectState per Project plus append-only state-version audit metadata.
- Updates use optimistic concurrency through `version`; stale writes must retry from the latest committed state.
- A ProjectState update and the DevelopmentEvents it applies must commit atomically or be safely replayable.
- `recent*` collections are bounded by explicit count and date limits in configuration.

## 9.1 DailyDevelopmentSummary

A persisted daily summary is keyed by `projectId`, developer-day date, timezone, input fingerprint, and generation version. It contains:

- bounded DevelopmentEvent references
- factual summary items with evidence references
- commit and event counts
- excluded/noise activity count
- generation status and confidence

There may be only one current summary per Project and developer-day; regeneration creates a new version. A day with raw activity but no meaningful DevelopmentEvents must produce an explicit “no meaningful event detected” state rather than fabricated progress. Changing the user's timezone affects future summaries and may trigger explicit regeneration; it must not silently rewrite historical day boundaries.

---

# 10. ContentOpportunity

Expected structure:

```text
ContentOpportunity
- id
- projectId
- developmentEventIds[]
- opportunityType
- title
- reasonSignals[]
- recommendedFormat
- priorityScore
- noveltyScore
- shouldPost
- confidence
- status
- scoringVersion
- inputFingerprint
- createdAt
```

The engine must evaluate whether an event is worth sharing.

It must be capable of returning:

```text
shouldPost = false
```

Not every development activity deserves content.

The engine must also suppress repetitive or near-duplicate opportunities.

Opportunity status lifecycle:

```text
recommended → accepted → draft_generated
recommended → dismissed
recommended/accepted → expired
```

- `shouldPost = false` opportunities are stored for evaluation but are not shown as recommendations in the primary dashboard.
- `priorityScore` ranks currently eligible opportunities using importance, content potential, freshness, novelty, confidence, and repetition penalties.
- `noveltyScore` measures topic novelty against active and published opportunities from the same Project during the previous 30 developer-days.
- MVP duplicate suppression uses normalized topic keys, linked feature IDs, event type, and recent opportunity history. It must not introduce a vector database.
- Opportunities with `noveltyScore < 0.35` are suppressed by default unless they represent a release or project milestone.
- Every score component, threshold, and reason signal must be stored or reproducible through `scoringVersion`.
- Users may accept or dismiss only currently recommended opportunities. A dismissal stores a structured reason when provided.

---

# 11. ContentDraft

Expected structure:

```text
ContentDraft
- id
- opportunityId
- platform
- content
- generationVersion
- userEdited
- status
- model
- promptVersion
- createdAt
- updatedAt
```

MVP platform:

- X
- Single post

Thread generation is outside MVP scope.

Draft generation must use only relevant:

- DevelopmentEvent
- ProjectState
- ContentOpportunity
- explicit user content preferences

Do not invent unsupported feature claims.

Draft status lifecycle:

```text
generated → edited/saved → copied → published
generated/edited/saved → discarded
```

Copying does not imply publication. Regeneration creates a new draft version and does not overwrite user-edited content. An X single-post draft must respect the platform character limit configured by the backend at generation time; the UI must display the count and block marking invalid content as ready.

## 11.1 ContentPreferences

One preference record per user contains:

- language
- tone: `concise | educational | reflective`
- technicalDepth: `low | medium | high`
- emojiUsage: `none | light`
- includeHashtags
- avoidTopics[]
- timezone

Defaults must produce a usable draft without onboarding completion. Preferences are explicit user settings; MVP must not infer or automatically learn voice.

---

# 12. PublicationFeedback

Expected structure:

```text
PublicationFeedback
- id
- draftId
- published
- publishedUrl
- publishedAt
- rejectedReason?
```

Opportunity feedback is stored separately:

```text
OpportunityFeedback
- id
- opportunityId
- action: accepted | dismissed
- reason?: not_relevant | repetitive | too_minor | sensitive | other
- createdAt
```

There may be at most one current feedback decision per user and opportunity; changing the decision retains audit history. Published URLs must use `https`, be normalized, and belong to an allowlisted X domain for MVP. A user may mark a draft as published without a URL, but if supplied the URL must validate.

MVP publishing is manual.

The application must not automatically publish to X.

Publication feedback becomes the first seed for future personalization and ranking improvements.

---

# 13. GitHub Ingestion Requirements

The ingestion layer must provide:

- GitHub App installation and repository authorization
- Repository listing
- Repository selection
- Connected repository persistence
- Incremental commit synchronization
- Idempotent ingestion
- Sync status tracking
- Error tracking
- Manual synchronization
- Background synchronization
- Provider error mapping
- Rate-limit handling

Critical rule:

The same commit SHA must not be inserted multiple times for the same relevant repository context.

Disconnecting a repository must stop synchronization.

## 13.1 MVP Synchronization Policy

- Synchronize commits reachable from the selected repository's default branch.
- Synchronize merged pull-request metadata linked to those commits. Open and unmerged pull requests are outside the default MVP analysis path.
- The initial synchronization covers the previous 30 developer-days, capped at 500 commits. If the cap is reached, the UI must disclose that the import is partial.
- Incremental synchronization starts from the last successful provider cursor with a 24-hour overlap window to tolerate delayed or reordered provider data. Uniqueness constraints make the overlap idempotent.
- Manual and scheduled synchronization use the same application service and idempotency rules.
- Scheduled synchronization runs at most hourly per active repository in MVP. Manual synchronization is rate-limited per user and repository.
- Pagination continues until the cursor/window boundary or configured safety limit is reached.
- Provider rate limits must be stored with reset time, surfaced as a safe status, and retried no earlier than allowed.
- Retryable failures include provider timeout, transient `5xx`, and rate limiting. Authorization errors and invalid repository access require user action and are not blindly retried.
- Merge commits may be stored as evidence but must not independently produce duplicate DevelopmentEvents when their constituent commits are already represented.
- Bot-authored commits are stored but excluded from event generation by default. The debug view must disclose the exclusion.
- Force-push or rebase does not delete previously analyzed evidence automatically. Records no longer reachable from the default branch are marked `orphanedAt`; their derived artifacts are re-evaluated and may be superseded.
- Repository rename or transfer is tracked by immutable provider repository ID rather than owner/name.
- Webhooks may improve freshness but must not be the only correctness mechanism. Webhook signatures must be verified and delivery IDs deduplicated.

## 13.2 Evidence Input Policy

MVP ingestion stores only the provider data required for the accepted workflow:

- commit SHA, message, author identity metadata, timestamp, parent references, and change statistics
- changed file paths and file-level additions/deletions when available
- pull-request number, title, limited body text, state, merge time, author metadata, and linked commits

MVP must not store or send source file contents, patch bodies, binary contents, generated artifacts, or full raw GitHub payloads to the AI provider. Expanding AI input to source code or diffs requires an explicit post-MVP product decision, consent design, security review, and ADR.

---

# 14. Data Minimization and Security

Security is part of the foundation.

It is not a post-MVP concern.

Requirements:

- GitHub App permissions are limited to read-only repository metadata, contents metadata required for commit history, and pull-request metadata. Any permission expansion requires an ADR and reconnect consent.
- GitHub installation access tokens stay server-side and are short-lived.
- Tokens must never appear in frontend responses.
- Tokens must not be logged.
- Secrets must not be hardcoded.
- `.env` files must not be committed.
- Full raw GitHub payloads must not be written to application logs.
- Private repository names and file paths must be masked in logs, traces, analytics, support exports, and error reports.
- Binary files must not be sent to the AI.
- Secret files must not be sent to the AI.
- Source code and diffs must not be sent during MVP.
- Default AI context is restricted to the evidence fields in Section 13.2 and bounded structured state.
- User disconnect must stop future access and perform the cleanup/revocation behavior defined in the authentication section.
- Account deletion must immediately disable access and background work, then delete product-owned personal data within 30 days.
- Repository disconnect offers either retention of derived history or deletion of repository-related data; the selected action must be explicit and auditable.
- Logs are retained for at most 30 days and must not contain content payloads or secrets. Product analytics are retained for at most 13 months using pseudonymous identifiers.
- AI request and response payloads must not be written to general application logs. A restricted evaluation store may retain redacted structured artifacts only with explicit purpose and retention metadata.
- Commit messages, pull-request text, and file paths are untrusted input. They must never be interpreted as system instructions or allowed to modify tool, security, or output-schema policies.

---

# 15. AI Structured Output Requirements

Event extraction and content-opportunity detection must use structured outputs.

Raw model text must never be written directly into domain tables without validation.

Expected behavior:

```text
LLM Output
    ↓
Schema Validation
    ↓
Valid?
 ┌──────┴──────┐
 Yes           No
 ↓             ↓
Domain Write   Retry / Repair / Fail
```

Invalid structured output must not corrupt domain state.

Every AI execution should capture:

- model
- prompt version
- latency
- token usage where available
- validation result
- failure stage

Every AI stage must persist an `AIExecution` record containing stage, project, input fingerprint, model, model configuration, prompt version, schema version, start/end timestamps, latency, token usage when available, validation result, attempt number, and safe error classification. Content payloads and secrets must not be placed in observability fields.

Validation and retry policy:

1. Parse the model response against the versioned schema.
2. Reject unknown enum values, out-of-range scores, missing evidence, and unsupported references.
3. Allow at most one schema-repair attempt using the validation errors.
4. If repair fails, mark the stage failed and preserve the last valid domain state.
5. Never partially write a batch of invalid domain entities.

Temperature and other model configuration are part of the generation version. A user-requested regeneration must create a new AIExecution and draft version.

---

# 16. Evaluation Requirements

## Offline Evaluation

Maintain curated development scenarios containing expected outcomes such as:

- DevelopmentEvent expected or not expected
- Expected event type
- Expected shouldPost decision
- Expected recommended format

Track technical metrics where practical:

- event extraction precision
- event extraction recall
- event type accuracy
- opportunity precision
- invalid structured-output rate
- AI stage failure rate

Prompt/model changes should run against the regression set.

## 16.1 Evaluation Dataset and Release Thresholds

Before Phase 3 exits, the regression set must contain at least 100 independently reviewable scenarios, including noise-only days, multi-commit features, bug fixes, refactors, releases, repetitive work, ambiguous activity, bot activity, and private/sensitive-looking metadata. No single event category may represent more than 30% of the set.

- Ground truth is created from evidence by a human reviewer using a documented rubric.
- A second reviewer adjudicates all release-set failures and at least 20% of passing samples.
- Evaluation fixtures are versioned and separated into development and held-out release subsets.
- Exact-match classification metrics and thresholded binary decisions must be computed deterministically.
- Drafts are evaluated for evidence grounding, unsupported claims, usefulness, clarity, and platform-limit compliance.

Minimum Phase 5 technical release thresholds on the held-out set:

- DevelopmentEvent precision: `>= 0.80`
- DevelopmentEvent recall: `>= 0.70`
- Event type accuracy: `>= 0.80`
- Visible ContentOpportunity precision: `>= 0.75`
- Unsupported-claim rate in drafts: `<= 0.02`
- Invalid structured-output rate after repair: `< 0.01`
- AI stage terminal-failure rate: `< 0.02`

No prompt or model change may reduce any release metric by more than 5% relative without an explicit reviewed product decision. Security or unsupported-claim regressions always block release regardless of aggregate score.

---

# 17. Product Metrics

Relevant MVP product metrics include:

- Opportunity acceptance rate
- Draft generation rate
- Draft acceptance / copy rate
- Draft edit intensity
- Publish conversion
- Posts per active week
- Return usage

Primary MVP signal:

```text
Recommendation
    ↓
User Generates or Uses Draft
    ↓
User Marks Draft as Published
```

Follower growth is not an MVP north-star metric.

Phase 5 product-value targets over the defined dogfooding cohort:

- At least 60% of daily summaries are rated useful or receive no correction before opportunity action.
- At least 40% of sessions containing a visible recommendation lead to accept or draft generation.
- At least 25% of accepted opportunities lead to copy or mark-as-published.
- At least 20% of weekly active dogfooders return in the following week; report this directionally until the cohort is large enough for statistical conclusions.

All denominators and event definitions must be documented in `docs/product/metrics.md`. These are MVP learning thresholds, not claims of statistical significance.

## 17.1 Non-Functional Requirements

Unless a phase defines a stricter target, MVP must satisfy:

- Authenticated read API p95 latency below 500 ms excluding provider and AI calls.
- Dashboard initial content p75 below 2.5 seconds on a representative broadband connection after authentication.
- Manual sync acknowledgement below 1 second; sync runs asynchronously with visible progress.
- For repositories within the 500-commit import cap, 95% of initial syncs complete within 10 minutes when GitHub and the AI provider are healthy.
- AI calls have explicit per-stage timeouts and a total daily per-user budget. Budget exhaustion must degrade safely and never cause uncontrolled retry spending.
- Cost per active developer-day, split by model and stage, is reported during Phase 5. The provisional release target is at most USD 1.00 per active developer-day.
- API logs, AIExecution metadata, SyncRun records, and correlation IDs make a failed user workflow traceable without exposing private content.
- Database backups and point-in-time recovery are enabled in the production plan; a restore procedure is documented and tested before MVP release.
- Core flows meet WCAG 2.1 AA for keyboard access, focus, labels, contrast, and status announcements.
- Dashboard and draft workflow support current desktop and mobile viewport widths.
- Loading, empty, partial-data, authorization-error, rate-limit, AI-failure, and retry states have explicit UI behavior.
- CI must block merge when required lint, typecheck, unit, integration, contract, migration, or build checks fail.
- Critical/high security findings and cross-user data access failures block release.

---

# 18. MVP Dashboard Target

The final MVP dashboard must support the states and actions represented below. The exact copy and visual layout are illustrative rather than contractual.

```text
TODAY

14 commits
→
3 Development Events

DEVELOPMENT SUMMARY

✓ GitHub repository connected
✓ Repository sync retry fixed
✓ Dashboard empty-state improved

TOP CONTENT OPPORTUNITY

"Show the repository connection flow you completed today."

WHY?

✓ Feature completed today
✓ High novelty
✓ Not posted before
✓ Strong demo potential

RECOMMENDED FORMAT

Short progress post + screenshot

DRAFT

[AI-generated X draft]

[Edit]
[Regenerate]
[Save]
[Copy]
[Mark as Published]
```

The UI must not pretend that Trend Intelligence or Audience Intelligence exists before those features are actually implemented.

“Screenshot” is a recommendation to the user, not automatic media analysis or upload. MVP does not inspect, generate, store, or publish media unless a separately approved task explicitly adds manual attachment support.

---

# 19. Production Roadmap

Development must proceed sequentially.

A later intelligence phase must not begin until the previous phase's exit gate is satisfied.

---

## PHASE 0 — Foundation & Quality Gates

Goal:

Build the engineering foundation before business intelligence.

Deliverables:

- pnpm monorepo
- Next.js web shell
- NestJS API shell
- Supabase project
- PostgreSQL
- Prisma baseline
- Supabase Auth
- Supabase GitHub sign-in skeleton
- GitHub App installation skeleton
- GitHub Actions CI
- testing baseline
- config
- logging
- error handling
- basic authenticated dashboard shell

Exit Gate:

Foundation exits only when:

- authenticated web and API shells run in the documented local environment
- a migration creates the baseline ownership model and RLS policies
- cross-user isolation integration tests pass
- CI requires lint, typecheck, unit tests, migration validation, and builds
- secrets are provided through documented environment variables and secret scanning finds no committed secret
- structured error responses, correlation IDs, health checks, and logging redaction are verified
- the deployment environments and backup/restore procedure are documented

---

## PHASE 1 — GitHub Ingestion

Goal:

Create a reliable raw GitHub activity pipeline.

Deliverables:

- repository listing
- repository selection
- connected repository persistence
- commit synchronization
- merged pull-request metadata synchronization
- SyncRun tracking
- manual sync
- background sync
- synchronization status UI

Exit Gate:

Phase 1 exits only when a real GitHub App installation can select, connect, sync, disconnect, and reconnect a repository; repeated and overlapping syncs create no duplicate commits or pull requests; rate-limit, authorization, retry, partial-import, and terminal-failure states are integration-tested; background sync stops after disconnect; and no provider token or private repository identifier appears in client responses or logs.

---

## PHASE 2 — Development Intelligence

Goal:

Transform raw development activity into meaningful DevelopmentEvents.

Deliverables:

- DevelopmentEvent schema
- extraction AI stage
- event classification
- evidence linking
- importance scoring
- confidence scoring
- ProjectState
- daily development summary
- event review/debug view
- offline fixtures

Exit Gate:

Phase 2 exits only when the versioned evaluation set has at least 60 scenarios, DevelopmentEvent precision is at least `0.80`, recall at least `0.70`, event type accuracy at least `0.80`, every visible event links to valid evidence, low-confidence events are withheld as specified, ProjectState replay is idempotent, and the user receives a useful evidence-backed answer to:

> "What did I actually build today?"

---

## PHASE 3 — Content Opportunity & Explainability

Goal:

Determine what is worth sharing and why.

Deliverables:

- ContentOpportunity
- shouldPost
- priority scoring
- novelty scoring
- recommended format
- reason signals
- opportunity cards
- accept/dismiss feedback

Exit Gate:

Phase 3 exits only when the full 100-scenario evaluation set exists, visible opportunity precision is at least `0.75`, duplicate suppression and `shouldPost = false` behavior pass regression tests, every visible recommendation has reproducible reason signals, accept/dismiss feedback persists correctly, and the system answers:

> "What should I share and why?"

before generating content.

---

## PHASE 4 — Content Copilot & Draft Workflow

Goal:

Convert selected opportunities into editable X drafts.

Deliverables:

- X single-post generator
- content preferences
- draft editor
- persistence
- regenerate
- copy
- mark as published
- published URL
- generation telemetry

Exit Gate:

Phase 4 exits only when the full core loop works in Playwright against a test environment; generated drafts contain no unsupported evidence references in the release set, respect the configured X limit, preserve user edits across save and regeneration, validate publication URLs, record telemetry, and pass cross-user authorization tests:

```text
GitHub
→ Event
→ Opportunity
→ Explanation
→ Draft
→ User Action
```

---

## PHASE 5 — Dogfooding, Evaluation & MVP Release

Goal:

Use the system in real development days and validate the product hypothesis.

Deliverables:

- dogfooding metrics
- offline evaluation suite
- prompt/model comparisons
- error taxonomy
- feedback capture
- observability
- cost reporting
- MVP release checklist

Exit Gate:

Phase 5 exits only when:

- the cohort and developer-day minimum in Section 2 are met
- the technical thresholds in Section 16.1 pass on the held-out set
- the product-value thresholds in Section 17 are met or an explicit product review documents why a specific miss is acceptable
- the NFRs in Section 17.1 pass
- cost reporting, deletion, restore, incident, rollback, and release checklists have been exercised
- there are no unresolved critical/high security issues or known cross-user data-isolation defects

If these conditions demonstrate repeatable value, post-MVP work may begin.

If it does not, improve event/opportunity quality instead of adding more features.

---

# 20. Post-MVP Roadmap

Only begin after Phase 5.

Sequence:

- Phase 6 — Project Memory Expansion
- Phase 7 — Voice Learning
- Phase 8 — Media Intelligence
- Phase 9 — Analytics
- Phase 10 — Learning Loop
- Phase 11 — Trend Intelligence
- Phase 12 — Audience Intelligence
- Phase 13 — Publishing
- Phase 14 — Content Strategy
- Phase 15 — Developer Growth OS

Important scope lock:

Do not build infrastructure for Trends or Audience Intelligence during Phase 0–5 solely because it may be useful later.

---

# 21. Codex Execution Model

Codex must not receive instructions such as:

> "Build Phase 2."

Every phase must be decomposed.

Required hierarchy:

```text
PHASE
  ↓
EPIC
  ↓
FEATURE
  ↓
TASK
  ↓
ACCEPTANCE CRITERIA
  ↓
IMPLEMENTATION
  ↓
TESTS
  ↓
REVIEW
```

Every Codex task should have one primary responsibility.

---

# 22. Standard Codex Task Contract

Every implementation prompt should contain:

## Task

One clearly bounded responsibility.

## Context

- relevant module(s)
- current repository state
- existing contracts
- relevant architectural rules

## Goal

One concrete outcome.

## Acceptance Criteria

Observable behavior.

Include:

- success behavior
- failure behavior
- security behavior when relevant

## Tests

Require the appropriate combination of:

- unit tests
- integration tests
- E2E tests for real user-visible workflows

## Constraints

Always include:

- no unrelated refactors
- preserve type safety
- preserve module boundaries
- no secrets in client/logs
- do not implement future-phase work
- do not change public contracts without updating shared contracts
- do not change database structure without a migration

## Definition of Done

At minimum:

- tests pass
- typecheck passes
- lint passes
- required builds pass
- docs updated when necessary
- ADR added if architecture materially changed

---

# 23. Codex Agent Operating Rules

The following rules apply to all implementation tasks.

## 23.1 Inspect Before Modifying

Before making changes:

- inspect the repository
- understand existing code
- reuse valid infrastructure
- avoid replacing working code unnecessarily

---

## 23.2 Do Not Advance Automatically

Codex must stop when the assigned task is complete.

It must not begin the next feature, task, or phase unless explicitly instructed.

---

## 23.3 Avoid Speculative Infrastructure

Do not create infrastructure for hypothetical future needs.

Examples:

- do not introduce Redis before needed
- do not introduce vector databases during MVP
- do not add event buses without a concrete requirement
- do not build multi-platform publishing during X-only MVP
- do not create complex abstraction layers without present value

---

## 23.4 No Unrelated Refactoring

A task should modify only the code needed to satisfy its acceptance criteria.

If unrelated technical debt is discovered:

1. report it
2. do not silently rewrite it unless required for the assigned task

---

## 23.5 Verify Work

Codex must execute relevant checks before claiming completion.

Typical commands include:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run integration or E2E tests when relevant.

Never report a test as passing unless it was actually executed.

---

## 23.6 Report Completion Clearly

Every Codex implementation response should contain:

```text
What Changed
Files / Structure
Commands Run
Tests Added
Architecture Notes
Remaining Work
Risks / Blockers
```

Do not include future implementation unless requested.

---

# 24. Engineering Definition of Done

A feature is not complete merely because it works locally.

A task is done only when relevant conditions are satisfied:

- Acceptance criteria are observable.
- TypeScript typecheck succeeds.
- Lint succeeds.
- Relevant tests pass.
- Public API contract changes update shared contracts.
- Database changes include migrations.
- Security-sensitive information is not logged.
- AI stages record model/prompt/version/validation telemetry.
- New AI behavior is represented in evaluation fixtures.
- Unrelated changes are minimized.
- Architecture changes receive an ADR when appropriate.

---

# 25. Decision Priority

When implementation choices conflict, use this priority:

1. This PDR
2. Current approved phase
3. Current task acceptance criteria
4. Existing architecture and contracts
5. Simplicity
6. Future extensibility

Future extensibility must never override explicit MVP scope.

---

# 26. Product Non-Goals During MVP

The MVP is not:

- an autonomous social-media manager
- an X automation bot
- an influencer analytics system
- a trend-monitoring platform
- an audience intelligence platform
- an autonomous agent framework
- a generic AI writing tool
- a commit-to-tweet converter

The product is a developer-context intelligence system first and a content copilot second.

---

# 27. Core Quality Principle

The system must optimize for:

```text
Development Understanding
        before
Content Generation
```

If DevelopmentEvent quality is poor, the solution is not to add more content-generation complexity.

If ContentOpportunity quality is poor, the solution is not to add Trends or Audience Intelligence prematurely.

Improve the core intelligence layer first.

---

# 28. Final MVP Definition

The MVP is complete when a developer can:

1. Sign in.
2. Connect GitHub.
3. Select a repository.
4. Synchronize development activity.
5. See meaningful DevelopmentEvents.
6. See an understandable development summary.
7. Receive ranked ContentOpportunities.
8. Understand why each recommendation exists.
9. Generate an X draft from an accepted opportunity.
10. Edit and save the draft.
11. Copy it.
12. Manually publish it.
13. Mark it as published with a URL.
14. Generate useful product feedback data.

And all of this is supported by:

- strong type safety
- validation
- tests
- secure token handling
- structured domain state
- observability
- AI regression evaluation
- explicit phase boundaries

---

# 29. North Star

> You build.  
> The system understands what changed, finds what is worth sharing, explains why, and prepares the draft.  
> You stay in control.

---

# 30. Instruction to Codex

Treat this PDR as a persistent implementation constraint.

For every task:

- obey the current phase
- obey the current task scope
- preserve the locked architecture
- preserve the MVP scope
- validate your work
- stop after completing the assigned task

Do not reinterpret the product into a broader social-media automation platform.

Do not skip directly from raw GitHub activity to content generation.

The intelligence chain must remain:

```text
Raw GitHub Activity
→ DevelopmentEvent
→ ProjectState
→ ContentOpportunity
→ Explainable Recommendation
→ ContentDraft
```
