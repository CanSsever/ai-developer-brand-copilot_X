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

- [x] persist normalized merged pull-request metadata, changed-file metadata, and linked commit SHAs alongside synchronized default-branch evidence
- [x] enforce repository-scoped uniqueness for immutable provider pull-request IDs and repository pull-request numbers
- [x] exclude open and unmerged pull requests from the default MVP path
- [x] use the same fixed 30-day initial window and incremental 24-hour overlap as commit synchronization
- [x] run commit and pull-request ingestion in one SyncRun and advance the repository boundary only after both complete
- [x] preserve partial evidence safely across retry and recovery without duplicating pull requests, files, or commit links
- [x] apply the existing bounded retry, rate-limit, authorization, and provider-error policy
- [x] enforce ownership-aware RLS reads while denying direct authenticated writes
- [x] store no raw provider payload, source content, patch, diff, credential, or installation token
- [x] forward migration deploy, database connectivity, and migration-status checks pass against the configured development database
- [x] deterministic provider, migration, persistence, recovery, dashboard, and privacy tests pass
- [x] all repository quality gates, E2E tests, and secret scans pass

### Task 1.6 Design Notes

- `GitHubPullRequest` stores bounded normalized metadata. The body summary is limited to 2,000 characters; changed files store paths, statuses, and numeric statistics only.
- Pull-request identity is scoped to the connected repository by the immutable GitHub pull-request ID. The repository-local pull-request number is independently unique within the same connected repository.
- Merged pull requests are discovered by `mergedAt` inside the same fixed SyncRun window used for commits. Detail responses are revalidated as closed, merged, and in-window before persistence.
- Linked commit SHAs use a normalized child table rather than a foreign key to `GitHubCommit`, because squash and rebase workflows can legitimately produce provider-linked SHAs that are not retained as synchronized default-branch commit rows.
- Commit and pull-request provider calls share one SyncRun, provider retry policy, durable worker lifecycle, and final success transaction. The successful boundary moves only when both evidence phases finish.
- Partial commit or pull-request evidence remains intentionally idempotent after a later provider failure. Durable retry and expired-lease recovery replay the same fixed window without duplicate rows.
- Real-provider commit and pull-request synchronization remains reserved for Task 1.7 live verification.

### Task Status

- [x] Task 1.6 VERIFIED COMPLETE

## Task 1.7 — Live Verification & Phase Exit

- [x] verify the real GitHub App can mint an installation token, resolve the connected private repository, and perform read-only provider calls
- [x] verify the real scheduler and durable worker enqueue, claim, and complete repository synchronization
- [x] verify a queued SyncRun survives a controlled API-process restart and completes after restart
- [x] verify a second active enqueue is rejected and an incremental run uses the required 24-hour overlap
- [x] verify empty GitHub repositories are handled as zero commit evidence rather than a false authorization failure
- [x] verify real commit and merged pull-request rows, file evidence, and pull-request commit links are ingested
- [x] verify repeated and overlapping synchronization is duplicate-free with real commit and pull-request evidence present
- [x] deterministically test rate-limit, authorization, retry, partial-import, terminal-failure, stale-lease recovery, and disconnected-repository scheduling behavior
- [x] verify the authenticated dashboard/manual API flow against the real repository after test evidence exists
- [x] verify live disconnect/access loss, stopped scheduling, and reconnect without deleting the GitHub App
- [x] verify live worker logs contain no credential, token, authorization header, repository identifier, provider body, private key, or lease-token field
- [x] verify all migrations are applied, database connectivity succeeds, ingestion-table RLS is enabled, and authenticated PR-table grants remain read-only
- [x] pass the complete local regression suite, deterministic E2E suite, and Gitleaks scan
- [x] verify final hosted GitHub Actions after the Task 1.7 fixes are committed and pushed
- [x] verify no provider token or private repository identifier appears in client responses or logs
- [x] Phase 1 exit gate VERIFIED

### Task 1.7 Live Verification Record

- The configured GitHub App successfully created installation tokens, resolved the authorized repository, and read real non-sensitive commit and merged pull-request evidence.
- The first live scheduled run exposed GitHub's documented empty-repository commit-list response being normalized as an authorization failure. The provider reader now accepts only that exact response as an empty commit list; unrelated conflicts remain terminal. Focused regression tests cover both cases.
- After the fix, the durable worker completed the original fixed-window run. A second run was queued while the API process was stopped, a duplicate active enqueue was rejected, and the restarted worker claimed and completed the queued run with a 24-hour overlap.
- The first real-evidence run persisted three commit rows, three commit-file rows, one merged pull-request row, one pull-request-file row, and one pull-request commit link. Commit and pull-request SyncRun counters matched those aggregate counts, and the repository success boundary matched the completed fixed window.
- Live PR ingestion exposed an optional provider `merge_commit_sha` field being omitted rather than returned as `null`. The normalizer now maps both omitted and explicit-null values to `null`; malformed provided SHAs remain rejected. A focused regression test covers the omitted-field response.
- A second 24-hour-overlap run rediscovered three commits and one merged pull request while inserting zero new evidence. All five aggregate evidence counts remained unchanged, all repository-scoped duplicate counts were zero, and the success boundary advanced to the second completed window.
- Live log inspection was performed by boolean comparison only; no credential value, Authorization header, token/JWT, private key marker, repository identifier, provider response body, or lease-token field was found.
- Live local disconnect correctly removed the application connection while leaving the GitHub App installation unchanged. A separate user-authorization reconnect path discovers the authenticated GitHub user's existing installation, re-verifies App ownership and user access, and restores the local connection idempotently. Existing-installation reconnect, repository reconnect, dashboard state, and post-reconnect manual synchronization were verified successfully.
- The reconnect retest exposed a stale selected-connection URL after local deletion. The connection page previously grouped base Project/installation loading with optional repository discovery, so the expected not-found result for the deleted connection incorrectly set the whole page's generic load error. Base responses are now runtime-validated independently, stale selections are ignored, and repository-specific failures no longer discard valid Project/installation state.
- A clean-URL retest proved the stale selection was not the only failure. Value-free inspection of the real service output confirmed no contract field mismatch: Project IDs/timezones were strings, the disconnected repository was null, and connections was an empty array. The remaining base-load defect was the page resolving independent Supabase SSR sessions concurrently for the two requests. The page now resolves one server-side session into a token-closed requester and reuses it for both validated responses; safe diagnostics contain only stage, parser, field path, expected type, and actual category.
- No destructive provider-side rate-limit test was performed. Rate-limit, retry, authorization-loss, partial-import, crash recovery, and disconnected scheduling remain covered by deterministic automated tests as required by the safe-verification boundary.
- The current local regression contains 222 passing unit/integration tests across 32 files, 11 passing Playwright scenarios, a successful production build, and a clean Gitleaks history/trackable-content scan. Focused verification includes 47 reconnect tests, four response-parser tests, one single-session requester test, and two browser regressions for disconnected and connected installation states.
- Commit `fe4967c` (`fix: complete Phase 1 live GitHub verification`) is the final Phase 1 implementation commit. The hosted GitHub Actions workflow completed successfully for that commit; both quality gates and secret scanning passed on the committed code.

### Task 1.7 Remaining Blockers

- None.

### Task Status

- [x] Task 1.7 VERIFIED COMPLETE
- [x] Phase 1 VERIFIED COMPLETE

## Current Status

- [x] Phase 1 VERIFIED COMPLETE
- [x] Task 1.1 VERIFIED COMPLETE
- [x] Task 1.2 VERIFIED COMPLETE
- [x] Task 1.3 VERIFIED COMPLETE
- [x] Task 1.4 VERIFIED COMPLETE
- [x] Task 1.5 VERIFIED COMPLETE
- [x] Task 1.6 VERIFIED COMPLETE
- [x] Task 1.7 VERIFIED COMPLETE
- [x] Phase 2 NOT STARTED
