# AI Developer Brand Copilot

This repository contains the verified Phase 0 engineering foundation and verified Phase 1 GitHub ingestion foundation for AI Developer Brand Copilot. Core ownership persistence, Supabase authentication, tenant RLS, GitHub App installation and reconnect, normalized commit and merged pull-request ingestion, idempotent incremental synchronization, provider retry hardening, authenticated manual synchronization, durable background execution, observability, CI, and the authenticated dashboard foundation are implemented and verified. Phase 2 has not started; DevelopmentEvent, ProjectState, product intelligence, and AI integration are not implemented.

## Prerequisites

- Node.js 22.13 or newer
- pnpm 11.22 or newer

Corepack can activate the repository-pinned pnpm version:

```bash
corepack enable
corepack prepare pnpm@11.22.0 --activate
```

## Install

```bash
pnpm install
```

## Workspace

```text
apps/
├── api/        NestJS REST API
└── web/        Next.js App Router application
packages/
├── ai/         Reserved backend AI package boundary
├── config/     Reserved shared configuration boundary
├── contracts/  Shared public contract boundary
└── shared/     Generic shared TypeScript boundary
```

Applications may depend on packages. Packages must not depend on applications.

## Commands

Run both development applications:

```bash
pnpm dev
```

The web application uses `http://localhost:3000`. The API uses `http://localhost:3001`, with `GET /health` for application health, `GET /health/db` for PostgreSQL connectivity, and bearer-protected `GET /auth/me` for the current application user.

Authenticated users can open `/dashboard` for the product shell. The server-rendered dashboard lists owned Projects, creates Projects with an IANA timezone, shows the current Project, represents GitHub App and connected-repository state, links to the existing GitHub connection flow, provides sign-out, and allows manual synchronization for connected repositories. Unauthenticated requests are redirected to the existing sign-in shell. Product intelligence remains unimplemented.

Run an application individually:

```bash
pnpm --filter @developer-brand-copilot/web dev
pnpm --filter @developer-brand-copilot/api dev
```

Repository-wide quality commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Database commands:

```bash
pnpm db:generate
pnpm db:validate
pnpm db:format
pnpm db:check
```

## Environment configuration

Copy the safe application examples to local ignored `.env` files when needed:

```bash
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
```

Current server-only API variables are `NODE_ENV` (`development`, `test`, or `production`), `PORT` (an integer from 1 to 65535), `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`. The API defaults to port `3001` when `PORT` is omitted. Both database values are required PostgreSQL URLs: use the Supabase pooler URL for `DATABASE_URL` at runtime and a direct connection URL for `DIRECT_URL` in Prisma CLI commands. The Supabase values let the API cryptographically verify access tokens; no service-role key is required or accepted by application configuration.

`apps/api/.env.example` contains safe local placeholders only. Put real Supabase values only in the ignored `apps/api/.env`; never commit or paste them into source control or chat. `pnpm db:check` executes a minimal `SELECT 1` query and therefore requires valid local database credentials.

Browser-public configuration consists of `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. These values are explicitly selected before parsing. A publishable key is safe for browser use, but a Supabase service-role key, database URL, GitHub OAuth secret, access token, or refresh token must never use a `NEXT_PUBLIC_` variable or be committed.

## Authentication architecture

The Next.js App Router uses `@supabase/ssr` cookie-backed clients. The session-refresh proxy validates and restores the session, the server-rendered application shell displays signed-in or signed-out state, and server actions implement GitHub sign-in and sign-out. The OAuth callback exchanges the PKCE code for a cookie-backed session.

The Nest API accepts only `Authorization: Bearer <access-token>` for protected routes. Supabase verifies the token cryptographically, after which the API also checks issuer, authenticated audience, expiry, and UUID subject. The verified `sub` is the application `User.id`; a Prisma upsert resolves exactly one ownership-root user without storing passwords or provider tokens. `GET /auth/me` returns only that UUID. Request bodies and custom user-ID headers are never identity sources.

Supabase Auth with GitHub is the login provider. It remains separate from GitHub App installation and repository authorization.

## Manual Supabase Auth setup and verification

The provider dashboards cannot be configured from repository code. Complete these steps locally before Task 0.5 can be marked verified complete:

1. Create a GitHub OAuth App for sign-in. Set its authorization callback URL to the Supabase callback shown for the GitHub provider, normally `https://<project-ref>.supabase.co/auth/v1/callback`.
2. In Supabase Authentication providers, enable GitHub and enter the OAuth App client ID and client secret. Keep the client secret in the provider dashboard only.
3. In Supabase Auth URL configuration, set the local Site URL to `http://localhost:3000` and allow `http://localhost:3000/auth/callback` as a redirect URL. Add production URLs separately before deployment.
4. Put the project URL and publishable key in the ignored API and web env files using the names in the example files. Do not use a service-role key.
5. Start both apps, sign in with GitHub, refresh the page to verify session restoration, and sign out.
6. Verify `GET /auth/me` with a real authenticated session and confirm repeated requests resolve the same application user without duplicate rows.

### Task 0.5 live verification record

The real configured Supabase and GitHub OAuth flow was manually verified successfully on September 13, 2026. The verified flow covered GitHub login, the Supabase callback, authenticated web state, session restoration after refresh, sign-out, and a real bearer-authenticated `GET /auth/me` response with HTTP 200. The application user identity matched the verified Supabase subject and remained stable across refresh.

The development-only verification route used for this one-time check was removed after verification. No access token, refresh token, cookie, JWT, OAuth secret, database credential, or personal user identifier is retained in this record.

## Tenant isolation and Row Level Security

The current tenant boundary is `User.id` → `Project.userId`. Supabase Auth proves identity, and API code derives the application user only from the cryptographically verified bearer-token subject. Request query parameters, bodies, and custom headers are not authorization evidence.

The `User` and `Project` tables have RLS enabled through the `20260913024500_enable_core_tenant_rls` migration. Anonymous roles have no grants. Authenticated Supabase database requests may select only their own `User` row. They may select, insert, update, and delete only `Project` rows whose `userId` equals `auth.uid()`; update checks prevent ownership reassignment. Direct authenticated creation, update, and deletion of application `User` rows remain denied because user synchronization is a server responsibility.

RLS protects authenticated Supabase/PostgREST data access. The Prisma API uses the configured PostgreSQL backend role, which has `BYPASSRLS`; its queries are not filtered by these policies. Therefore RLS is defense in depth, not a replacement for API ownership constraints. Every future ownership-sensitive API query must derive and apply the verified `AuthenticatedUser.id` scope.

### Real two-user RLS verification record

Real two-user RLS verification completed successfully on September 13, 2026, using two distinct authenticated Supabase users. The run verified own-User access, own-Project access and update, bidirectional cross-user User and Project read denial, bidirectional cross-user Project update and delete denial, bidirectional cross-owner Project insert denial, direct authenticated User insert denial, cross-user User update and delete denial, and rightful-owner access after rejected cross-user mutations. Temporary Projects were cleaned up successfully.

The development-only browser registration route, server action, in-memory token handoff, loopback coordinator, and manual verification command were removed after the successful run. No user IDs, access tokens, refresh tokens, JWTs, cookies, credentials, or provider payloads from the verification are retained in the repository or this record.

Never paste an access token, refresh token, GitHub client secret, or database URL into source files, logs, documentation, commits, or chat.

## GitHub App connection foundation

Supabase GitHub OAuth is used only for application sign-in and session identity. Repository authorization uses a separate GitHub App installation. A successful Supabase sign-in is never treated as repository consent, and its provider OAuth token is never used for repository access.

The authenticated installation flow is:

1. The user chooses a Project they own. The API verifies ownership and creates a random, ten-minute connection state. Only its SHA-256 digest is stored, bound to the authenticated User and Project.
2. The browser is redirected to the configured GitHub App installation URL with the opaque state. The GitHub App must request user authorization during installation.
3. The callback requires the same authenticated Supabase user, consumes the state exactly once, and exchanges the one-time GitHub code on the API server.
4. The API verifies the installation twice: an App JWT request proves the installation belongs to this GitHub App, and the ephemeral GitHub App user token proves the installing user can access that installation. A callback `installation_id` is never trusted by itself.
5. Only stable installation/account metadata is persisted. The user token is discarded after verification.
6. Authorized repositories are loaded with an on-demand, short-lived installation access token. The selected numeric repository ID must be present in GitHub's installation-authorized list before it can be connected to the owned Project.

GitHub App JWTs use RS256, an issued-at value adjusted for clock drift, a lifetime below ten minutes, and the configured GitHub App client ID as issuer. Installation access tokens and GitHub App user tokens remain server-side, are not persisted, are not returned through shared contracts, and are not logged. Repository pagination uses pages of 100 and fails closed beyond the explicit 10,000-repository MVP bound.

Persistence contains `GitHubConnection`, `ConnectedRepository`, and short-lived `GitHubConnectionAttempt` records. A User may have multiple installation connections. A Project has at most one connected repository, and a provider repository ID is unique within an installation. All new tables have RLS enabled. Authenticated database clients receive only tenant-scoped read access to safe connection metadata; writes remain server-only and API operations independently enforce User and Project ownership.

Local disconnect deletes the local installation reference and cascades its connected repository records. It does not uninstall or revoke the GitHub App at GitHub; use GitHub's installation settings for provider-side revocation. The Phase 0 connection foundation itself introduced no background jobs; the Phase 1 PostgreSQL-backed sync worker is documented below.

### Local GitHub App registration

Create a development GitHub App in **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App** with these settings:

- GitHub App name: a globally unique development name, such as `AI Developer Brand Copilot Local <unique suffix>`
- Homepage URL: `http://localhost:3000`
- Callback URL: `http://localhost:3000/github/callback`
- Callback wildcard matching: disabled
- Request user authorization (OAuth) during installation: enabled
- Expire user authorization tokens: enabled
- Device Flow: disabled
- Setup URL: unused; GitHub disables it when user authorization during installation is enabled
- Webhooks: inactive, with no webhook URL or subscribed events
- Repository permissions: Metadata read-only, Contents read-only, Pull requests read-only
- Organization and account permissions: none
- Availability for local development: only the owning account; choose only the repository required for verification during installation

Metadata read access supports repository identity and discovery. Contents read access supports read-only commit synchronization, and Pull requests read access supports merged pull-request synchronization required by the PDR. No write permission is requested.

Generate a private key from the GitHub App settings. Store these values only in the ignored `apps/api/.env`: `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_CALLBACK_URL`. The PEM may be represented with escaped `\\n` line breaks. Never commit the PEM or paste it into chat. None of these values belongs in `NEXT_PUBLIC_*` configuration.

After configuring the App, start the API and web application, sign in through Supabase, open `http://localhost:3000/github/connect`, create or choose a Project, select **Connect GitHub App**, install it on a selected repository, and choose that repository after the verified callback.

### Task 0.7 live verification record

The real GitHub App flow completed successfully on September 16, 2026. An authenticated application user completed the separate selected-repository GitHub App installation, returned through the verified callback, discovered the authorized private repository through the GitHub API, and connected it to the intended Project. The App used read-only Metadata, Contents, and Pull requests permissions with no write permission.

No installation ID, repository ID, callback parameter, access token, installation token, user token, client secret, private key, database credential, or private repository name from the live flow is retained in this record.

Task 0.7 does not implement commit or pull-request ingestion, webhook processing, synchronization jobs, raw GitHub event persistence, `DevelopmentEvent`, analytics, recommendations, or AI/content generation.

## Raw GitHub ingestion persistence foundation

Phase 1 adds normalized, tenant-owned raw evidence beneath each `ConnectedRepository`:

- `GitHubCommit` stores commit identity, message, safe author labels, provider timestamps, parent SHAs, aggregate change statistics, and optional orphaning time.
- `GitHubCommitFile` stores changed paths, change status, and numeric statistics. It never stores file contents or patches.
- `GitHubPullRequest` stores repository-scoped provider identity, PR number, title, a body summary limited to 2,000 characters, author login, branches, provider timestamps, merge SHA, and aggregate statistics for merged PRs only.
- `GitHubPullRequestFile` stores normalized changed-path metadata and statistics without patches or source contents.
- `GitHubPullRequestCommit` stores deduplicated linked commit SHAs. It intentionally remains raw provider evidence even when a squash or rebase means a linked SHA is not present in the synchronized default-branch commit set.
- `SyncRun` stores a constrained synchronization lifecycle, time-window boundary, cursor-algorithm version, SHA-256 idempotency key, safe counters, and an optional safe failure code.
- `ConnectedRepository.lastSuccessfulSyncAt` is the durable successful time boundary for the later incremental synchronization service.

Commit identity is unique by connected repository and SHA. Pull-request identity is unique by connected repository plus immutable provider PR ID, with repository-scoped PR number uniqueness as an additional integrity rule. PR file paths and linked commit SHAs are unique beneath each PR. Overlapping fetches are therefore idempotent while the same commit SHA or PR number remains valid in different repositories. Only one queued or running synchronization may exist per connected repository. Deleting a local connected repository cascades through all raw evidence and synchronization history.

All raw-evidence and SyncRun tables have RLS enabled. Authenticated database clients can select only rows that resolve through both the owned Project and GitHub connection; direct client writes are not granted. Application and worker writes remain server-only and retain API ownership checks.

Raw evidence is not exposed through a browser evidence API. Fetching, manual enqueue, and durable background execution are implemented only through the server-side services described below. `DevelopmentEvent`, interpretation, scoring, and AI behavior remain unimplemented.

### Internal incremental GitHub activity synchronization

`GitHubCommitSyncService` is the existing shared server-side synchronization capability; its historical class name is retained to avoid a broad refactor. It loads an active `ConnectedRepository` and its installation identity from persistence, resolves the repository through its immutable provider ID, obtains short-lived installation tokens inside the existing GitHub API service, and synchronizes both default-branch commits and merged pull-request evidence.

An initial run uses one fixed 30-day window capped at 500 commits. A later run starts 24 hours before `lastSuccessfulSyncAt` and ends at one fixed captured time. Commit and file uniqueness constraints make the intentional overlap idempotent. The provider reader paginates commits and changed files within explicit limits and fails closed if the supported boundary is exceeded instead of silently truncating.

Only unseen SHAs receive commit-detail requests. Each new commit and its normalized file metadata are written atomically; previously stored evidence in the completed window is marked reachable or orphaned according to the default-branch result.

Merged PR discovery uses the same fixed 30-day initial or 24-hour-overlap incremental window, with `mergedAt` as its inclusion boundary. GitHub search is restricted to merged PRs, and every candidate is revalidated as closed, merged, and inside the fixed window before normalized details, changed-file metadata, and linked commit SHAs are accepted. Search, file, and linked-commit pagination have explicit safety limits and fail closed rather than truncating.

PR upserts and child-row reconciliation are transactionally idempotent. Historical merged PRs are not assigned commit-style orphan semantics. Provider calls never run inside a database transaction. Commit evidence written before a later PR failure is retained, but the SyncRun fails and `lastSuccessfulSyncAt` does not advance. Only after both commit and PR ingestion succeed do the final SyncRun counters and successful boundary advance atomically.

Installation tokens, Authorization headers, provider error payloads, patches, file contents, commit messages, PR titles/body summaries, and file paths are not written to routine logs or returned by the service. Real GitHub commit and PR ingestion verification remains part of the Task 1.7 Phase exit gate.

### Provider retry and rate-limit behavior

GitHub provider calls classify network errors and timeouts, transient 5xx responses, primary rate limits, and identifiable secondary rate limits as retryable. Authorization or repository-access failures, malformed provider responses, and configured safety-limit failures are terminal for the current SyncRun. Raw provider error bodies and header collections are neither logged nor persisted.

Each provider HTTP call has at most three attempts. Local exponential backoff starts at 250 ms, includes bounded jitter, and is capped at 2 seconds. Valid `Retry-After` or `X-RateLimit-Reset` timing takes precedence. Provider delays of at most 5 seconds may be awaited inline; longer windows are normalized to a maximum 24-hour metadata horizon, persisted as `SyncRun.retryAfterAt`, and deferred instead of sleeping in-process. Malformed timing falls back to bounded local backoff.

`SyncRun.attemptCount` records the total GitHub HTTP attempts made by that run, including successful requests, while `retryAfterAt` is present only on `failed_retryable` runs. A successful retry completes the same SyncRun. Exhausted or deferred transient failures end as `failed_retryable`; terminal failures end as `failed_terminal`; neither advances `lastSuccessfulSyncAt`. Final success is conditional on the run still being `running`, so cancellation cannot be overwritten. Repository/SHA, commit-file, repository/provider-PR, PR-file, linked-commit, idempotency-key, and active-run database constraints remain authoritative.

### Authenticated manual synchronization

An authenticated user can start synchronization for an owned connected repository from the dashboard. `POST /projects/:projectId/sync-runs` verifies the complete User-to-Project-to-ConnectedRepository ownership chain, resolves repository identity only from persistence, applies the existing one-active-run database gate, and reuses `GitHubCommitSyncService`. Unknown and cross-user resources use the same safe not-found behavior.

The endpoint returns `202 Accepted` with only a SyncRun identifier and `queued` status after the queued record has been durably created. It performs no GitHub network work in the request. The dashboard reads only the latest safe SyncRun summary and presents human-readable never-synced, queued/running, success, incomplete/import-limit, retry timing, access-attention, cancellation, and terminal-failure states; it never receives provider payloads, raw errors, credentials, commit messages, or file paths.

Manual starts use a durable 60-second per-repository minimum interval and honor a persisted future `retryAfterAt`. Real GitHub ingestion verification remains reserved for the Task 1.7 Phase exit.

### Durable background synchronization

The long-running NestJS API process also hosts a focused PostgreSQL-backed synchronization worker. PostgreSQL and `SyncRun` remain the queue source of truth: the worker polls every five seconds, evaluates at most 25 active repositories per scheduling pass, and atomically claims one queued or expired-lease run with `FOR UPDATE SKIP LOCKED`. The manual request and browser lifetime are therefore independent of execution. No Redis, BullMQ, external broker, separate worker deployment, webhook, or in-memory correctness state is required.

A claim records an opaque UUID lease token, a 15-minute lease expiry, and a bounded worker-attempt count. A 30-second heartbeat extends the owned lease. Success and failure finalization require the same lease token, so an expired worker cannot overwrite a newer claim. After a crash, queued work remains claimable and expired running work is recovered with the same SyncRun window and idempotency key. Commit/repository uniqueness keeps recovered ingestion duplicate-safe.

Retryable runs retain their safe failure metadata and become eligible no earlier than the later of the provider `retryAfterAt` or bounded exponential worker backoff. They are requeued on the same SyncRun and fixed synchronization window, with at most three worker execution attempts; exhausted work becomes terminal. If a newer manual run supersedes a waiting retry, the older run is cancelled so its older window cannot later move the repository success boundary backwards. Succeeded, terminal, and cancelled runs are never automatically claimed. Inactive/disconnected repository work is cancelled or removed by the existing cascade and cannot be claimed.

Active repositories are considered for automatic synchronization at most hourly. Manual and scheduled work both use `GitHubCommitSyncService`, the same database active-run constraint, and the same idempotency rules. A terminal failure blocks automatic rescheduling until user intervention creates a new manual run. Worker polling is distinct from repository scheduling and does not call GitHub unless a durable run is successfully claimed.

## API observability baseline

Every API request receives a bounded correlation identifier. A caller-provided `X-Request-Id` is reused only when it is a canonical UUID v4; otherwise the API generates a UUID. The identifier is stored in an `AsyncLocalStorage` request context, returned in the `X-Request-Id` response header, included in request logs, and included in API error responses.

API errors use this stable safe shape:

```json
{
  "statusCode": 400,
  "code": "BAD_REQUEST",
  "message": "Safe validation message",
  "requestId": "00000000-0000-4000-8000-000000000000",
  "timestamp": "ISO-8601 timestamp",
  "path": "/safe/path"
}
```

Expected Nest HTTP exceptions preserve their intended status and safe message. Unexpected exceptions become `INTERNAL_SERVER_ERROR` responses with the generic message `Internal server error`; stack traces, raw exception objects, Prisma/SQL details, and upstream provider internals are never returned to the browser.

The API writes newline-delimited JSON logs to standard output or standard error. Request-completion events contain timestamp, level, event, request ID, method, query-free path, status code, and duration. Request/response bodies, query strings, Authorization headers, cookies, OAuth codes, tokens, private keys, client secrets, database credentials, and raw provider payloads are not logged. Central recursive redaction also protects sensitive metadata keys and common bearer-token, GitHub-token, PEM, and credential-bearing PostgreSQL URL representations.

This Phase 0 baseline behaves safely in development and production and does not persist operational logs or add external log shipping, metrics, tracing, or monitoring infrastructure.

## Operations

- [Deployment environments and release procedure](docs/operations/DEPLOYMENT.md)
- [Database backup and restore runbook](docs/operations/BACKUP_RESTORE.md)

These runbooks document the Phase 0 deployment and recovery contract. They do not claim that production infrastructure has been deployed or that a production backup/restore has been executed. A recorded non-production restore rehearsal remains required before MVP release.

## Continuous integration and secret scanning

The GitHub Actions workflow in `.github/workflows/ci.yml` is configured for pull requests and pushes to `main`. It uses read-only repository permissions, cancels obsolete runs for the same pull request or branch, disables persisted checkout credentials, and does not use `pull_request_target`, deployment permissions, privileged containers, or repository secrets.

The quality-gates job pins Node.js `22.13.0`, installs the Node-compatible Corepack `0.34.5`, and activates the repository-declared pnpm `11.22.0` with integrity verification enabled. It runs:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:validate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the deterministic foundation browser suite with:

```bash
pnpm test:e2e:install
pnpm test:e2e
```

The installation command uses Playwright's supported Chromium installer. The E2E suite starts isolated local Supabase-auth protocol and API fixtures on ports `4100` and `4101`, plus the web application on port `3100`. It exercises the real application session/cookie and server-side bearer-request architecture without real Supabase, GitHub, database, or production credentials and without a production authentication bypass.

Prisma and frontend build-time validation receive synthetic CI-only values. Normal CI never copies local environment files, connects to the real Supabase database, runs migrations, or receives GitHub App/Supabase production credentials.

The separate secret-scan job fetches full Git history and runs Gitleaks `8.30.0`. The official release archive is selected per supported platform and must match its pinned SHA-256 checksum before execution. It scans both Git history and the current tracked/untracked-but-not-ignored file set; ignored local environment files are excluded. Findings are redacted and fail the job. Repository contents are not uploaded to an external scanning service, and no broad allowlist is configured.

Run the same history scan locally with:

```bash
pnpm security:secrets
```

The command requires network access to download the checksum-pinned Gitleaks binary into an operating-system temporary directory. The binary and archive are removed after the scan. Hosted GitHub Actions verification completed successfully for commit `907e7ff`: both `quality-gates` and `secret-scan` passed on a clean GitHub-hosted runner.
