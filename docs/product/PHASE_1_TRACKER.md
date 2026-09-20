# Phase 1 — GitHub Ingestion Tracker

This tracker records verified repository state for Phase 1. The governing implementation contract is `AI_Developer_Brand_Copilot_PDR_Codex_v1_1.md`. Items are checked only after the corresponding implementation and required verification have succeeded.

## Entry State

- [x] Phase 0 is VERIFIED COMPLETE
- [x] Supabase identity, Project ownership, tenant RLS, GitHub App installation, authorized repository selection, observability, dashboard, CI, and secret scanning are reused
- [x] Phase 1 scope excludes `DevelopmentEvent`, Project intelligence, AI/LLM calls, content generation, and social publishing

## Task 1.1 — Raw Commit & SyncRun Persistence Foundation

### Domain and Persistence

- [x] `GitHubCommit` is normalized provider evidence owned through `ConnectedRepository`
- [x] `GitHubCommitFile` stores changed-path metadata and numeric statistics without file contents or patches
- [x] `SyncRun` records the PDR status lifecycle, time window, cursor version, safe counters, and safe failure code
- [x] `ConnectedRepository.lastSuccessfulSyncAt` records the durable successful synchronization boundary
- [x] no GitHub fetch, sync service, queue, scheduler, or API endpoint was added

### Idempotency and Lifecycle

- [x] `GitHubCommit(connectedRepositoryId, sha)` is database-unique
- [x] the same SHA may exist in different connected repositories
- [x] `SyncRun(connectedRepositoryId, idempotencyKey)` is database-unique
- [x] only one queued or running SyncRun may exist per connected repository
- [x] SyncRun status, timestamp, count, cursor-version, and key-shape rules are database-constrained
- [x] deleting a ConnectedRepository cascades to commits, commit files, and SyncRuns

### Ownership, RLS, and Data Minimization

- [x] all new tables have RLS enabled
- [x] authenticated reads resolve through both the owning Project/User and GitHub connection
- [x] direct authenticated writes remain denied
- [x] no token, credential, raw provider payload, source file content, patch, or diff field exists
- [x] backend BYPASSRLS behavior and API ownership responsibilities are unchanged

### Verification

- [x] forward migration applied to the configured development database
- [x] Prisma generate, validate, connectivity, and migration status checks pass
- [x] focused migration/schema tests pass
- [x] all repository quality gates and E2E pass
- [x] secret scan and repository hygiene checks pass

### Design Notes

- `ConnectedRepository` is the lifecycle root for raw commits and SyncRuns because Phase 0 already binds it to exactly one owned Project and one authorized GitHub installation.
- Commit SHA uniqueness is repository-scoped. Git objects can legitimately be shared across forks or repositories, while duplicate ingestion must be rejected within one connected repository.
- Task 1.2 will use `lastSuccessfulSyncAt` plus the PDR-required 24-hour overlap to form a time window. `SyncRun.windowStart`, `windowEnd`, and `cursorVersion` make that boundary and its algorithm auditable; no speculative opaque provider cursor is stored.
- Local disconnect already deletes `ConnectedRepository`. Raw commits, file metadata, and SyncRuns cascade with it as the smallest consistent MVP retention rule and to satisfy the PDR rule that raw provider data must not be orphaned.

### Task Status

- [x] Task 1.1 VERIFIED COMPLETE

## Task 1.2 — Incremental Commit Synchronization

- [x] one internal server-side synchronization service loads trusted repository and installation identity from persistence
- [x] default-branch initial synchronization uses a fixed 30-day window capped at 500 commits
- [x] incremental synchronization uses the last successful boundary with the required 24-hour overlap
- [x] commit and changed-file pagination use explicit safety limits and fail closed rather than truncate silently
- [x] unseen commits and normalized file metadata persist idempotently
- [x] overlapping runs do not duplicate commit or file rows
- [x] in-window evidence no longer reachable from the default branch is marked with `orphanedAt`
- [x] SyncRun queued/running/success/failure transitions and counters are implemented
- [x] `lastSuccessfulSyncAt` advances to the fixed window end only after full success
- [x] provider calls occur outside database transactions; final success state and boundary update atomically
- [x] deterministic synthetic tests cover provider, persistence, pagination, overlap, conflict, failure, and privacy behavior
- [x] no public/manual endpoint, dashboard action, scheduler, queue, webhook, or pull-request ingestion was added

### Task 1.2 Design Notes

- The internal entry point accepts only a persisted `ConnectedRepository.id`; provider owner/name values are never accepted from browser input.
- The GitHub API service resolves the current repository location from the immutable provider repository ID before listing the persisted default-branch evidence window.
- A SHA-256 idempotency key is derived from connected repository ID, fixed window start/end, and cursor version. The database partial unique index remains the race-safe active-run gate.
- Commit listing completes before detail retrieval. Only SHAs absent from the same connected repository receive detail requests.
- Each new commit and its file rows use one nested atomic Prisma create. Partial completed evidence remains safely idempotent if a later operation fails.
- The final SyncRun success state, safe counters, refreshed repository metadata, and successful boundary update share one short database transaction.
- Real GitHub ingestion verification is deferred to Task 1.7; Task 1.2 uses deterministic synthetic provider fixtures and does not add a temporary public trigger.

### Task Status

- [x] Task 1.2 VERIFIED COMPLETE

## Task 1.3 — Retry, Idempotency & Provider Error Hardening

- [x] classify network/timeout, transient 5xx, primary/secondary rate-limit, authorization, malformed-response, and safety-limit failures
- [x] retry only normalized retryable provider calls with three finite attempts and bounded exponential backoff/jitter
- [x] honor valid short `Retry-After` and `X-RateLimit-Reset` timing; defer long waits without sleeping in-process
- [x] persist only safe `attemptCount`, `retryAfterAt`, and failure-code metadata
- [x] finalize exhausted/deferred failures as `failed_retryable` and terminal failures as `failed_terminal`
- [x] never advance `lastSuccessfulSyncAt` on failure or overwrite a cancelled run
- [x] verify repeated and overlapping runs create no duplicate commit/file evidence
- [x] preserve partial and bot-authored raw evidence for later idempotent processing and default intelligence exclusion
- [x] keep installation tokens ephemeral and exclude tokens, provider payloads, commit messages, and file paths from retry logs
- [x] deterministic synthetic tests cover retry success/exhaustion, rate-limit timing, authorization loss, cancellation, partial progress, and privacy
- [x] one focused forward migration adds retry metadata without changing ownership or RLS
- [x] forward migration deploy, database connectivity check, and migration-status verification pass against the configured development database
- [x] no endpoint, dashboard action, scheduler, cron, queue, worker, webhook, or pull-request ingestion was added

### Task 1.3 Design Notes

- The centralized provider policy permits at most three HTTP attempts per call. Local backoff starts at 250 ms, is capped at 2 seconds, and uses bounded jitter supplied through an injectable random source.
- Valid provider timing overrides local backoff. Inline waits are capped at 5 seconds; longer provider windows produce a deferred retryable failure with a normalized `retryAfterAt` capped to a 24-hour metadata horizon.
- `SyncRun.attemptCount` is the total number of GitHub HTTP attempts in the run, including successful requests. `retryAfterAt` is constrained to `failed_retryable` rows and no raw headers or provider payloads are stored.
- One installation token is reused throughout each list or detail phase. Tokens remain process-memory-only and authorization failures are terminal rather than causing an unbounded token-refresh loop.
- Provider calls and retry delays remain outside database transactions. Previously committed evidence is retained after later failure, while database uniqueness and the 24-hour overlap make a later run idempotent.
- Final success updates the SyncRun only while it is still `running`; a concurrent cancellation cannot be overwritten and the repository success boundary is not advanced.
- Development-database deployment, migration status, and connectivity were verified with TLS certificate validation enabled through the Supabase CA; no SSL verification bypass was used.
- Task 1.3 intentionally added no automatic delayed re-execution. Task 1.5 now owns the durable retry and scheduled orchestration recorded below.

### Task Status

- [x] Task 1.3 VERIFIED COMPLETE

## Task 1.4 — Manual Sync API & Dashboard Status

- [x] add the authenticated ownership-safe `POST /projects/:projectId/sync-runs` API surface
- [x] enforce the full authenticated User -> owned Project -> active ConnectedRepository and GitHub connection chain
- [x] return indistinguishable not-found behavior for unknown and cross-user Projects/repositories
- [x] reuse `GitHubCommitSyncService` and the database-backed one-active-run constraint without duplicating ingestion logic
- [x] rate-limit manual synchronization per user and repository with a durable 60-second minimum interval and persisted provider retry timing
- [x] return `202 Accepted` only after the SyncRun has been durably queued, then continue work asynchronously in the API process
- [x] expose only the latest safe SyncRun summary through the existing owned-Project read model
- [x] show never-synced, queued, running, success, incomplete/import-limit, rate-limit/retry, authorization, cancellation, and terminal states in human-readable dashboard text
- [x] keep tokens, provider payloads, raw errors, commit messages, and file paths out of API responses, URLs, logs, and client code
- [x] deterministic API, service, dashboard, server-action, and Playwright tests pass without real GitHub or Supabase credentials

### Task 1.4 Design Notes

- The browser supplies only an owned Project UUID. The API resolves the active ConnectedRepository and GitHub installation under the authenticated application user; client-supplied owner/name or provider identifiers are never trusted.
- A successful initiation response contains only the new SyncRun identifier and `queued` status. Counters, timestamps, safe failure metadata, retry timing, and `lastSuccessfulSyncAt` are read through the Project summary after navigation/refresh.
- Task 1.4 originally used a process-local asynchronous handoff after the durable queued row was created. Task 1.5 supersedes that handoff with the PostgreSQL-backed worker recorded below.
- Manual requests are protected by the existing active-run database constraint, a persistent per-repository cooldown, and persisted provider `retryAfterAt`. No automatic retry is scheduled by this task.
- Real GitHub ingestion remains reserved for the Task 1.7 live Phase exit. Task 1.4 verification uses synthetic provider fixtures and the existing deterministic dashboard fixture server.

### Task Status

- [x] Task 1.4 VERIFIED COMPLETE

## Task 1.5 — Background Synchronization

- [x] keep PostgreSQL and `SyncRun` as the durable queue source of truth
- [x] make manual synchronization enqueue-only with no request-lifetime GitHub work
- [x] claim queued or expired-lease work atomically with `FOR UPDATE SKIP LOCKED`
- [x] use opaque lease tokens and conditional finalization so stale workers cannot overwrite newer claims
- [x] heartbeat active leases and recover abandoned running work after lease expiry
- [x] preserve the same SyncRun, fixed window, idempotency key, and commit uniqueness across recovery/retry
- [x] bound worker execution to three attempts and honor provider timing plus exponential backoff
- [x] never automatically execute succeeded, failed-terminal, or cancelled runs
- [x] reuse the same application service and idempotency rules as manual synchronization
- [x] schedule active repositories at most hourly in MVP with bounded candidate scans
- [x] re-check repository and GitHub connection status before scheduling, claiming, and final success
- [x] stop new claims during graceful shutdown and make abrupt termination recoverable
- [x] stop scheduling and cancel/remove eligible work after disconnect
- [x] keep multiple API replicas safe without Redis, BullMQ, or a separate deployment unit
- [x] deterministic worker, migration, sync-engine, API, dashboard, and E2E tests pass

### Task 1.5 Design Notes

- The NestJS API hosts the worker lifecycle. Five-second queue polling, 30-second heartbeats, a 15-minute lease, a 25-repository scheduling batch, and the hourly repository cadence are injectable/testable bounded defaults.
- Worker polling only claims existing durable jobs. A separate bounded scheduling pass creates at most one hourly run per active repository; database uniqueness closes multi-replica races.
- Retryable execution requeues the same SyncRun only after the later of provider timing or worker backoff. The persisted window and cursor remain fixed, so overlapping recovery stays idempotent. A later user-triggered run supersedes and cancels the older waiting retry so an older window cannot regress the success boundary.
- Existing running rows are migrated with immediately expiring leases, making pre-deployment in-flight work recoverable after rollout.
- Worker logs contain safe run identifiers, attempt counts, and normalized failure codes only. Lease tokens, provider tokens, repository evidence, and raw errors are never logged or returned.
- Real GitHub background ingestion remains reserved for Task 1.7 live verification.

### Task Status

- [x] Task 1.5 VERIFIED COMPLETE

## Task 1.6 — Merged Pull-Request Ingestion

- [ ] persist merged pull-request metadata linked to synchronized default-branch commits
- [ ] enforce repository-scoped provider pull-request uniqueness
- [ ] exclude open and unmerged pull requests from the default MVP path
- [ ] apply the same ownership, RLS, privacy, retry, and idempotency standards

## Task 1.7 — Live Verification & Phase Exit

- [ ] verify a real GitHub App installation can select, connect, sync, disconnect, and reconnect a repository
- [ ] verify repeated and overlapping commit and pull-request synchronization is duplicate-free
- [ ] integration-test rate-limit, authorization, retry, partial-import, and terminal-failure states
- [ ] verify background synchronization stops after disconnect
- [ ] verify no provider token or private repository identifier appears in client responses or logs
- [ ] Phase 1 exit gate VERIFIED

## Current Status

- [x] Phase 1 IN PROGRESS
- [x] Task 1.2 VERIFIED COMPLETE
- [x] Task 1.3 VERIFIED COMPLETE
- [x] Task 1.4 VERIFIED COMPLETE
- [x] Task 1.5 VERIFIED COMPLETE
- [x] Task 1.6 NOT STARTED
- [x] Phase 2 NOT STARTED
