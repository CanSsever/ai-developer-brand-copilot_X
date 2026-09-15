# AI Developer Brand Copilot

This repository contains the engineering foundation for AI Developer Brand Copilot. It is currently in **Phase 0 — Foundation**. Core ownership persistence, Supabase authentication, and the initial RLS policies are implemented. Live two-user tenant-isolation verification remains incomplete. Product intelligence, GitHub App ingestion, and AI integration are not implemented yet.

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

Supabase Auth with GitHub is the login provider. It is separate from the future GitHub App installation and repository-ingestion integration.

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
