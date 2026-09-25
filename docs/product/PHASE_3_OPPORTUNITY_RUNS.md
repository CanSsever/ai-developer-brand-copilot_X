# Phase 3 Opportunity Run Orchestration

Task 3.6 introduces the durable orchestration boundary for the existing Task 3.3 selector, Task 3.4 detector, and Task 3.5 scorer. It adds no detection or scoring policy.

## Boundary and identity

An `OpportunityRun` belongs to one Project and one successful `IntelligenceRun`. Its `evaluationBoundary` is copied from the source run's immutable `sourceWindowEnd`, so retries do not substitute worker time for semantic time. A database trigger enforces source status, same-Project ownership, and boundary equality.

At enqueue, the Task 3.3 selector runs with that boundary and persists only its `expectedInputFingerprint`, not the canonical input payload. The worker selects again before detection; a changed fingerprint terminalizes the old run as `OPPORTUNITY_INPUT_STALE`. Detection must return the same fingerprint, and Task 3.5 retains its own currentness checks.

`runKey` is the lowercase SHA-256 of canonical JSON containing Project ID, source `IntelligenceRun` ID, Task 3.3 input fingerprint, and Phase 3 processing version. The processing version hashes the Task 3.6 orchestration version, Task 3.3 selection version, Task 3.4 detector/extraction/model-configuration/prompt/schema/validation identities, and Task 3.5 scoring version. Exact identity uniqueness includes Project, source, input fingerprint, and processing version; changed inputs or policy versions remain distinct historical boundaries.

## Eligibility and reprocessing

Automatic discovery considers only the latest successful Phase 2 `IntelligenceRun` at the current Phase 2 processing version, and only while the Project's GitHub connection remains active. Failed, retryable, or running Phase 2 runs are not eligible. Manual reprocessing is an internal owner-scoped service method and uses the same eligibility and fingerprint rules; no public API is added.

The database enforces one active queued/running/retryable run per Project. Serializable enqueue transactions lock the Project row, reuse exact identity, and rely on unique/partial-unique constraints to converge concurrent attempts. A different active identity is an active conflict, not reported as exact reuse.

Before work, stale Phase 2 sources, inactive connections, old processing versions, and changed Task 3.3 fingerprints are terminalized without invoking detection or scoring. Old-version active work is never claimed under current code.

## Worker lifecycle

Statuses are `queued`, `running`, `succeeded`, `failed_retryable`, and `failed_terminal`. Triggers are `intelligence_completion` and `manual_reprocess`. Claims use PostgreSQL `FOR UPDATE SKIP LOCKED`, a random lease token, 15-minute lease, 30-second heartbeat, three-attempt maximum, and exponential retry delay starting at 60 seconds. Every post-claim state mutation is fenced by run ID, `running` status, and lease token. Expired running work can be reclaimed with a new token; exhausted work is terminal and queryable.

Execution is sequential but not enclosed in a long database transaction: revalidate source and lease, select Task 3.3 input at the stored boundary, check the expected fingerprint, invoke Task 3.4, verify its fingerprint, invoke Task 3.5 with the same selected input, then persist counters and success under lease fencing. Existing Task 3.4 persisted-result reuse and Task 3.5 semantic idempotency are relied upon for crash/retry convergence, including zero-candidate results.

Typed Task 3.4 transient failures remain retryable and preserve provider retry-after information. Semantic/provider failures are terminal. AI budget exhaustion defers to the end of the current Project developer-day. Typed stale/invariant failures from Task 3.5 are terminal; known transient database failures are bounded retries. No failure classification depends on error-message text.

## Privacy and operations

The row stores operational identity, lifecycle, bounded counts, and safe failure codes only. It does not store the selected input, evidence, source text, prompt, provider response, or secrets. Authenticated access is owner-scoped read-only RLS; trusted backend code owns mutations. Logs contain run/project/source IDs, versions, attempts, safe failure codes, counts, and retry timestamps, never candidate text or evidence.

The worker service is manually driven with `runOnce`; registering it does not auto-start opportunity processing. The existing `GitHubSyncWorkerService` remains the sole scheduler and calls sync processing, the Phase 2 worker, then the Phase 3 worker on each enabled central tick. Phase 3 receives a turn even when that tick claims no SyncRun or Phase 2 work. An unexpected outer Phase 3 worker error is safely logged and isolated from completed upstream work, while the central polling loop continues. `IntelligencePipelineWorkerService.runOnce()` remains Phase-2-only.

`AppModule.registerOperational(... backgroundWorkers: false)` continues to disable the central loop, and `NODE_ENV=test` prevents automatic polling. Thus module initialization, operational/bootstrap use, tests, migrations, and database health checks do not implicitly claim an OpportunityRun or invoke the provider.

RLS verification combines migration-static assertions with migrated-database catalog and privilege probes: RLS is enabled, exactly one owner-scoped authenticated SELECT policy exists, authenticated has SELECT privilege, and authenticated INSERT/UPDATE/DELETE privileges are absent. The repository does not currently contain a credential-safe authenticated-session runtime harness, so browser-role row visibility is not exercised with live user tokens.

## Checkpoint state

The Task 3.6 schema, migration, orchestration service, worker, central-loop integration, module registration, and focused persistence/replay/fencing tests are implemented. Migration `20260925020000_add_opportunity_run_orchestration` is applied to the development database; all 19 migrations are current. Rollback/cleanup-safe database probes verify source validity, identity/active uniqueness, status/lease/counter constraints, cascades, concurrent claim/fencing behavior, retry exhaustion, and RLS catalog state without leaving probe records. Task 3.6 is verified complete locally and awaits its separate commit/push/hosted-CI delivery checkpoint. Tasks 3.7 onward remain untouched.
