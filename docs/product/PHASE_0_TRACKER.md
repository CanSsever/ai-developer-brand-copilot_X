# Phase 0 — Foundation & Quality Gates Tracker

This tracker records verified repository state. Items are checked only after the corresponding implementation and required commands have been executed successfully.

## Task 0.1 — Monorepo Bootstrap & Application Shells

### Workspace

- [x] pnpm workspace resolves all application and package projects
- [x] root development and quality commands are defined
- [x] strict shared TypeScript baseline is enabled
- [x] application-to-package dependency direction is preserved

### Web

- [x] Next.js App Router shell builds successfully
- [x] Tailwind CSS is configured
- [x] product identifier renders
- [x] frontend smoke test executes and passes

### API

- [x] NestJS application builds successfully
- [x] typed `GET /health` endpoint returns HTTP 200 with `{ "status": "ok" }`
- [x] API health integration test executes and passes
- [x] shared contracts package resolves through its public package entry point

### Package Boundaries

- [x] `packages/shared` is a valid typed workspace package
- [x] `packages/contracts` is a valid typed workspace package
- [x] `packages/config` is a valid typed workspace package
- [x] `packages/ai` is a valid typed workspace package
- [x] packages do not depend on applications

### Quality

- [x] `pnpm install` passes
- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm test` passes and executes both application test projects
- [x] `pnpm build` passes
- [x] README matches the implemented foundation
- [x] no secrets or future-phase integrations were introduced

### Task Status

- [x] Task 0.1 complete

## Task 0.2 — Configuration & Environment Validation

### Shared Configuration

- [x] `packages/config` implementation created
- [x] runtime schema validation implemented
- [x] API and public-web schemas separated
- [x] typed configuration exports available

### API Configuration

- [x] API runtime config validated
- [x] validated port used during bootstrap
- [x] invalid configuration prevents normal startup

### Web Configuration

- [x] public web config contract implemented
- [x] `NEXT_PUBLIC_API_BASE_URL` validated
- [x] client config exposes approved public fields only

### Security

- [x] no secrets committed
- [x] example environment files contain safe values only
- [x] raw environment object is not exposed client-side
- [x] environment values are not indiscriminately logged

### Tests

- [x] valid API configuration test passes
- [x] invalid PORT tests pass
- [x] invalid `NODE_ENV` test passes
- [x] valid public URL test passes
- [x] invalid public URL test passes
- [x] browser-safe configuration test passes
- [x] root `pnpm test` actually executes config package tests

### Quality

- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm test` passes
- [x] `pnpm build` passes
- [x] previous Task 0.1 tests remain green
- [x] documentation reflects current configuration

### Task Status

- [x] Task 0.2 complete

## Task 0.3 — Database Foundation (Supabase + Prisma)

### Prisma and configuration

- [x] Prisma 7, Prisma Client, PostgreSQL driver adapter, and `pg` are installed and pinned for the API
- [x] Prisma build scripts are explicitly approved in the workspace configuration
- [x] PostgreSQL datasource is configured
- [x] Prisma CLI configuration is established
- [x] Prisma Client generation passes
- [x] `DATABASE_URL` is required and validated for the runtime PostgreSQL connection
- [x] `DIRECT_URL` is required and validated for the Prisma CLI and migration connection
- [x] PostgreSQL protocol validation is implemented for both database URLs
- [x] runtime and Prisma CLI connection purposes are separated
- [x] database variables remain server-only
- [x] public web configuration cannot expose database URLs
- [x] no real connection strings or credentials are present in repository source files
- [x] database credentials are not logged
- [x] safe API environment example documents both database variables
- [x] Prisma schema declares PostgreSQL with no domain models or migrations
- [x] Prisma CLI configuration takes its connection URL from `DIRECT_URL`
- [x] generated Prisma client is excluded from source control and generated before API quality commands

### Database runtime

- [x] one Nest-managed Prisma service creates the PostgreSQL adapter from validated `DATABASE_URL`
- [x] backend Prisma module and service are implemented
- [x] Prisma lifecycle is handled through Nest shutdown cleanup
- [x] database health service performs only `SELECT 1`
- [x] typed `GET /health/db` success contract is exported from shared contracts
- [x] `GET /health/db` returns a controlled HTTP 503 response without connection details on failure
- [x] existing `GET /health` remains green
- [x] database health mechanism is verified against the real Supabase database
- [x] no domain tables, RLS, authentication, migrations, or Supabase SDK integration were introduced

### Scripts and tests

- [x] root `db:generate`, `db:validate`, `db:format`, and `db:check` scripts delegate to the API package
- [x] Prisma generation, validation, and formatting succeed without live database access
- [x] database URL validation tests pass
- [x] public configuration database-isolation behavior is covered and passes
- [x] database health success and failure paths pass without a live database
- [x] Prisma infrastructure tests pass
- [x] regression tests pass
- [x] `pnpm db:generate` passes
- [x] `pnpm db:validate` passes
- [x] `pnpm db:check` passes
- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm test` passes
- [x] `pnpm build` passes
- [x] documentation reflects the verified database architecture

### Real connectivity verification

- [x] local ignored `apps/api/.env` provides the real Supabase configuration
- [x] real PostgreSQL connection succeeds
- [x] `pnpm db:check` completes a real minimal connectivity query
- [x] live `GET /health/db` returns HTTP 200 with connected status against Supabase

### Task Status

- [x] Task 0.3 complete

## Task 0.4 — Core Ownership Data Model & Initial Migration

### Ownership schema

- [x] minimum UUID `User` ownership-root model implemented
- [x] minimum UUID `Project` model implemented
- [x] required one-to-many `User` → `Project` ownership relation implemented
- [x] required `Project.userId` ownership foreign key represented in the schema
- [x] owner-based project query index implemented
- [x] user deletion cascades to owned projects
- [x] required project timezone is persisted
- [x] UTC-compatible creation and update timestamps are represented
- [x] no password, OAuth token, profile, billing, or speculative product fields introduced

### Initial migration

- [x] first Prisma migration created as `20260912215435_init_core_ownership`
- [x] migration SQL contains only the `User` and `Project` ownership structures
- [x] first Prisma migration applied successfully to Supabase
- [x] Prisma migration pipeline verified against the configured direct connection

### Tests and quality

- [x] ownership schema tests cover model existence, required ownership, UUIDs, timestamps, timezone, index, and cascade behavior
- [x] ownership model tests pass
- [x] Prisma Client generation passes
- [x] Prisma validation passes
- [x] runtime database connectivity remains green
- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm test` passes
- [x] `pnpm build` passes
- [x] documentation reflects the core ownership model and migration workflow
- [x] no Task 0.5 or later implementation introduced

### Task Status

- [x] Task 0.4 complete

## Task 0.5 — Supabase Authentication Readiness

### Configuration and boundaries

- [x] API Supabase URL and publishable-key configuration is typed and validated
- [x] web Supabase URL, publishable key, site URL, and API URL are typed and validated
- [x] browser configuration exposes explicitly approved public fields only
- [x] service-role keys and database URLs are excluded from browser configuration
- [x] safe environment examples document required auth variables

### Web authentication

- [x] supported `@supabase/ssr` browser and server clients are implemented
- [x] Next.js session refresh proxy is implemented
- [x] signed-out and authenticated application-shell states are implemented and tested
- [x] GitHub OAuth sign-in server action is implemented
- [x] PKCE callback code exchange is implemented
- [x] sign-out and cookie-backed session restoration are implemented

### Backend authentication

- [x] bearer-token extraction is implemented without custom identity headers
- [x] Supabase access-token cryptographic verification boundary is implemented
- [x] issuer, authenticated audience, expiry, and UUID subject are validated
- [x] missing and invalid tokens return controlled HTTP 401 responses
- [x] verified identity propagation is typed
- [x] protected `GET /auth/me` returns only the application user UUID

### User persistence

- [x] verified Supabase `sub` resolves to application `User.id`
- [x] user resolution uses an idempotent unique upsert
- [x] passwords, access tokens, refresh tokens, and provider secrets are not persisted
- [x] repeated resolution and secret-free persistence behavior are tested
- [x] no Prisma schema change or empty migration was introduced

### Automated verification

- [x] authentication configuration tests pass
- [x] browser public/server isolation tests pass
- [x] missing-token and invalid-token tests pass
- [x] valid identity propagation test passes
- [x] user resolution and idempotent sync tests pass
- [x] web authentication state tests pass
- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm test` passes
- [x] `pnpm build` passes
- [x] `pnpm db:generate` passes
- [x] `pnpm db:validate` passes
- [x] `pnpm db:check` passes against Supabase PostgreSQL
- [x] `pnpm db:migrate:status` reports the schema up to date

### Manual Supabase verification

- [x] local ignored API and web env files contain the required Supabase Auth configuration
- [x] GitHub OAuth App and Supabase GitHub provider configuration are verified
- [x] browser GitHub sign-in succeeds against the real provider
- [x] browser session restoration and sign-out succeed against the real provider
- [x] a real Supabase access token succeeds against `GET /auth/me`
- [x] repeated real verification resolves the same application `User` without duplicates
- [x] temporary development-only auth verification route and helper were removed

### Scope integrity

- [x] RLS was not implemented
- [x] tenant isolation was not implemented
- [x] GitHub App installation or ingestion was not implemented
- [x] no Task 0.6 or later implementation was introduced

### Task Status

- [x] authentication implemented
- [x] Task 0.5 complete

## Task 0.6 — Tenant Isolation & Row Level Security

### RLS migration

- [x] descriptive `20260913024500_enable_core_tenant_rls` migration created
- [x] RLS enabled for the `User` table
- [x] RLS enabled for the `Project` table
- [x] anonymous table grants removed
- [x] authenticated grants reduced to required operations
- [x] own-User SELECT policy uses `auth.uid()`
- [x] direct authenticated User insert, update, and delete remain denied
- [x] Project SELECT, INSERT, UPDATE, and DELETE policies use `auth.uid()` ownership
- [x] Project UPDATE policy prevents ownership reassignment
- [x] no unrestricted true policy exists
- [x] migration applied successfully to the real Supabase development database
- [x] existing ownership rows remained intact after migration

### API ownership boundary

- [x] authenticated identity continues to originate from verified Supabase claims
- [x] request query and custom-header user IDs cannot override authenticated identity
- [x] application User synchronization remains idempotent and server-side
- [x] no speculative Project API was introduced
- [x] Prisma backend role was verified to bypass RLS and is documented accurately

### Automated and live verification

- [x] RLS migration security tests cover tables, grants, policies, and unsafe-policy absence
- [x] Task 0.5 authentication regression tests pass
- [x] anonymous Supabase access to both ownership tables is denied
- [x] temporary two-user authenticated RLS verification flow completed and removed
- [x] two distinct real Supabase users were authenticated for the live isolation test
- [x] bidirectional real cross-user User and Project reads were denied
- [x] bidirectional real cross-user Project insert, update, and delete were denied
- [x] real own-user and own-Project operations succeeded for both users

### Security and repository integrity

- [x] tracked `.gitignore` no longer contains database connection values
- [x] previously exposed database credential was rotated and repository history remediated
- [x] no service-role key or database credential was introduced into browser code
- [x] no access token, refresh token, JWT, or provider secret is logged by verification code
- [x] no Task 0.7 or later implementation was introduced

### Quality gates

- [x] `pnpm lint` passes after final documentation
- [x] `pnpm typecheck` passes after final documentation
- [x] `pnpm test` passes after final documentation
- [x] `pnpm build` passes after final documentation
- [x] `pnpm db:generate` passes
- [x] `pnpm db:validate` passes
- [x] `pnpm db:check` passes
- [x] `pnpm db:migrate:deploy` passes
- [x] `pnpm db:migrate:status` reports the schema up to date

### Task Status

- [x] RLS implemented
- [x] tenant isolation verified
- [x] cross-user isolation verified
- [x] Task 0.6 complete

## Task 0.7 — GitHub App Connection Foundation

### Architecture and configuration

- [x] Supabase login and GitHub App repository authorization remain separate
- [x] typed fail-fast GitHub App server configuration is implemented
- [x] GitHub App private key and client secret are server-only
- [x] safe environment placeholders support multiline private keys
- [x] GitHub App JWT generation uses RS256 and a sub-ten-minute lifetime
- [x] installation and user access tokens are ephemeral and never persisted

### Installation security

- [x] installation start requires an authenticated application user
- [x] target Project ownership is verified before redirect
- [x] random expiring state is bound to authenticated User and Project by digest
- [x] callback state is one-time-use and replay-resistant
- [x] expired, invalid, and cross-user state is rejected
- [x] callback installation ID is not trusted by itself
- [x] installation is independently verified as belonging to the configured GitHub App
- [x] ephemeral GitHub App user authorization verifies installation-user association

### Repository authorization and persistence

- [x] authorized repository discovery uses an ephemeral installation token
- [x] repository pagination is handled with an explicit MVP bound
- [x] arbitrary repository IDs are rejected
- [x] repository connection uses stable GitHub numeric IDs
- [x] repository connection is idempotent
- [x] ConnectedRepository belongs to exactly one Project in MVP
- [x] Project and connection ownership are enforced by authenticated identity
- [x] local disconnect is distinguished from GitHub-side uninstall/revocation
- [x] no provider token, private key, client secret, or raw GitHub payload is persisted

### Migration and isolation

- [x] `20260915204500_add_github_connection_foundation` migration created
- [x] GitHubConnection, ConnectedRepository, and GitHubConnectionAttempt models added
- [x] new tenant-owned tables have RLS enabled
- [x] authenticated direct writes to GitHub connection tables remain denied
- [x] tenant-scoped connection reads require User/Project ownership
- [x] migration applied successfully to the real Supabase development database

### Automated and live verification

- [x] configuration and browser-isolation tests cover GitHub secrets
- [x] App JWT signing boundary is tested
- [x] invalid, expired, replayed, and spoofed installation flows are tested
- [x] repository authorization, idempotency, and cross-user boundaries are tested
- [x] Task 0.5 authentication and Task 0.6 RLS regressions remain covered
- [x] real GitHub App was created and its private key verified server-side
- [x] real authenticated installation flow completed
- [x] real authorized repository discovery completed through GitHub API
- [x] real repository connection persisted to the correct Project
- [x] no GitHub token exposure was confirmed during the real flow

### Live verification record

- [x] a real authenticated user completed the separate selected-repository GitHub App installation and callback
- [x] the GitHub API returned the installation-authorized private repository and it was connected to the intended Project
- [x] the App used read-only Metadata, Contents, and Pull requests permissions with no write permission
- [x] no installation ID, repository ID, callback parameter, token, secret, credential, private key, or private repository name is retained in this record

### Quality gates

- [x] `pnpm lint` passes
- [x] `pnpm typecheck` passes
- [x] `pnpm test` passes with Task 0.5 and Task 0.6 regressions
- [x] `pnpm build` passes
- [x] `pnpm db:generate` passes
- [x] `pnpm db:validate` passes
- [x] `pnpm db:check` passes after migration
- [x] `pnpm db:migrate:deploy` passes
- [x] `pnpm db:migrate:status` reports three migrations and an up-to-date schema

### Scope and task status

- [x] GitHub App connection foundation implemented
- [x] no commit, pull-request, webhook, sync, event, analytics, or AI ingestion implemented
- [x] Task 0.8 had not started before Task 0.7 closure
- [x] Task 0.7 complete

## Task 0.8 — Logging, Error Handling & Observability

### Request correlation

- [x] every API request receives a request ID
- [x] valid UUID v4 `X-Request-Id` values may be reused and all other values are replaced
- [x] request context uses `AsyncLocalStorage` without cross-request global state
- [x] `X-Request-Id` is returned in response headers and safe error bodies

### Structured logging and redaction

- [x] the API uses one newline-delimited JSON logging implementation
- [x] request-completion logs contain request ID, method, sanitized path, status, and duration
- [x] query strings, headers, cookies, and request/response bodies are not logged
- [x] centralized recursive redaction covers auth, cookie, token, OAuth code, secret, private-key, password, Supabase-key, and database-URL fields
- [x] common bearer-token, GitHub-token, PEM, and credential-bearing PostgreSQL URL representations are sanitized
- [x] unexpected errors log safe diagnostic classification without raw messages, stacks, or provider/database payloads

### Error contract and exception handling

- [x] shared stable `ApiErrorResponse` contract implemented
- [x] expected HTTP status and safe message behavior is preserved
- [x] unexpected exceptions become safe HTTP 500 responses
- [x] stack traces, Prisma/SQL internals, provider internals, and raw exceptions are not returned
- [x] authentication, ownership, GitHub provider, conflict, not-found, and database-health behavior remains compatible

### Verification and scope

- [x] request correlation, safe error, lifecycle logging, and recursive redaction tests pass
- [x] Task 0.1–0.7 regression tests pass
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass
- [x] `pnpm db:generate`, `pnpm db:validate`, and `pnpm db:check` pass
- [x] live `GET /health` and `GET /health/db` return HTTP 200 with request correlation enabled
- [x] no database migration or persisted operational-log store was introduced
- [x] no external log shipping, metrics, tracing platform, CI work, webhook, synchronization, or Phase 1 functionality was introduced

### Task Status

- [x] Task 0.9 not started
- [x] Task 0.8 complete

## Phase 0 Exit Gate

- [x] centralized configuration implemented
- [x] PostgreSQL connectivity verified against Supabase
- [x] authenticated web and API shells run in the documented environment
- [x] baseline ownership migration and RLS policies exist
- [x] cross-user isolation integration tests pass
- [ ] CI enforces required quality gates
- [ ] secret handling and secret scanning are verified
- [x] structured errors, correlation IDs, health checks, and log redaction are verified
- [ ] deployment and backup/restore procedures are documented

### Phase Status

**Current status:** IN PROGRESS

- [ ] PHASE 0 COMPLETE
