# AI Developer Brand Copilot

This repository contains the initial engineering foundation for AI Developer Brand Copilot. It is currently in **Phase 0 — Foundation**. Product intelligence, authentication, persistence, GitHub integration, and AI integration are not implemented yet.

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

The web application uses `http://localhost:3000`. The API uses `http://localhost:3001`, with `GET /health` for application health and `GET /health/db` for PostgreSQL connectivity.

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

Current server-only API variables are `NODE_ENV` (`development`, `test`, or `production`), `PORT` (an integer from 1 to 65535), `DATABASE_URL`, and `DIRECT_URL`. The API defaults to port `3001` when `PORT` is omitted. Both database values are required PostgreSQL URLs: use the Supabase pooler URL for `DATABASE_URL` at runtime and a direct connection URL for `DIRECT_URL` in Prisma CLI commands.

`apps/api/.env.example` contains safe local placeholders only. Put real Supabase values only in the ignored `apps/api/.env`; never commit or paste them into source control or chat. `pnpm db:check` executes a minimal `SELECT 1` query and therefore requires valid local database credentials.

`NEXT_PUBLIC_API_BASE_URL` is the only current browser-public variable. It must be an absolute HTTP or HTTPS URL and is explicitly selected before public configuration is parsed. Do not add secrets or unimplemented integration variables to these files.
