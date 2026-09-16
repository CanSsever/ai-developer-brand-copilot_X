# AI Developer Brand Copilot

This repository contains the engineering foundation for AI Developer Brand Copilot. It is currently in **Phase 0 — Foundation**. Core ownership persistence, Supabase authentication, tenant RLS, and the GitHub App connection foundation are implemented and live-verified. GitHub activity ingestion, product intelligence, and AI integration are not implemented yet.

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

Local disconnect deletes the local installation reference and cascades its connected repository records. It does not uninstall or revoke the GitHub App at GitHub; use GitHub's installation settings for provider-side revocation. No background jobs exist in this phase.

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

Metadata read access supports repository identity and discovery. Contents read access is reserved for later read-only commit synchronization, and Pull requests read access is reserved for later merged pull-request synchronization required by the PDR. No write permission is requested.

Generate a private key from the GitHub App settings. Store these values only in the ignored `apps/api/.env`: `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_CALLBACK_URL`. The PEM may be represented with escaped `\\n` line breaks. Never commit the PEM or paste it into chat. None of these values belongs in `NEXT_PUBLIC_*` configuration.

After configuring the App, start the API and web application, sign in through Supabase, open `http://localhost:3000/github/connect`, create or choose a Project, select **Connect GitHub App**, install it on a selected repository, and choose that repository after the verified callback.

### Task 0.7 live verification record

The real GitHub App flow completed successfully on September 16, 2026. An authenticated application user completed the separate selected-repository GitHub App installation, returned through the verified callback, discovered the authorized private repository through the GitHub API, and connected it to the intended Project. The App used read-only Metadata, Contents, and Pull requests permissions with no write permission.

No installation ID, repository ID, callback parameter, access token, installation token, user token, client secret, private key, database credential, or private repository name from the live flow is retained in this record.

Task 0.7 does not implement commit or pull-request ingestion, webhook processing, synchronization jobs, raw GitHub event persistence, `DevelopmentEvent`, analytics, recommendations, or AI/content generation.

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

## Continuous integration and secret scanning

The GitHub Actions workflow in `.github/workflows/ci.yml` is configured for pull requests and pushes to `main`. It uses read-only repository permissions, cancels obsolete runs for the same pull request or branch, disables persisted checkout credentials, and does not use `pull_request_target`, deployment permissions, privileged containers, or repository secrets.

The quality-gates job pins Node.js `22.13.0` and activates the repository-declared pnpm `11.22.0`. It runs:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:validate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Prisma and frontend build-time validation receive synthetic CI-only values. Normal CI never copies local environment files, connects to the real Supabase database, runs migrations, or receives GitHub App/Supabase production credentials.

The separate secret-scan job fetches full Git history and runs Gitleaks `8.30.0`. The official release archive is selected per supported platform and must match its pinned SHA-256 checksum before execution. It scans both Git history and the current tracked/untracked-but-not-ignored file set; ignored local environment files are excluded. Findings are redacted and fail the job. Repository contents are not uploaded to an external scanning service, and no broad allowlist is configured.

Run the same history scan locally with:

```bash
pnpm security:secrets
```

The command requires network access to download the checksum-pinned Gitleaks binary into an operating-system temporary directory. The binary and archive are removed after the scan. Hosted GitHub Actions execution remains to be observed after this repository is pushed to a GitHub remote.
