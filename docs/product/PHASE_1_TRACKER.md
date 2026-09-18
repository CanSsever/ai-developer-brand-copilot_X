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

- [ ] implement one ownership-safe server-side synchronization service
- [ ] synchronize default-branch commits for the initial 30 developer-days, capped at 500 commits
- [ ] use the last successful boundary with the required 24-hour overlap
- [ ] paginate to the boundary or configured safety limit
- [ ] persist commits and file metadata idempotently
- [ ] mark unreachable evidence with `orphanedAt` as required
- [ ] Task 1.2 NOT STARTED

## Task 1.3 — Retry, Idempotency & Provider Error Hardening

- [ ] classify timeout, transient 5xx, rate-limit, authorization, and terminal failures
- [ ] persist safe rate-limit reset metadata and retry no earlier than allowed
- [ ] verify repeated and overlapping runs create no duplicates
- [ ] preserve bot-authored evidence for later default exclusion from intelligence
- [ ] test cancellation and authorization loss safely

## Task 1.4 — Manual Sync API & Dashboard Status

- [ ] add the authenticated ownership-safe `/projects/:projectId/sync-runs` API surface
- [ ] rate-limit manual synchronization per user and repository
- [ ] acknowledge asynchronous work within the PDR target
- [ ] show queued, running, success, partial-import, rate-limit, authorization, retry, cancellation, and terminal states safely

## Task 1.5 — Background Synchronization

- [ ] reuse the same application service and idempotency rules as manual synchronization
- [ ] run at most hourly per active repository in MVP
- [ ] re-check ownership and connection status before work
- [ ] stop scheduling and cancel eligible work after disconnect

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
- [x] Task 1.2 NOT STARTED
- [x] Phase 2 NOT STARTED
