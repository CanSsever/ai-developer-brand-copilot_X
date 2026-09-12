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

## Phase 0 Exit Gate

- [x] centralized configuration implemented
- [x] PostgreSQL connectivity verified against Supabase
- [ ] authenticated web and API shells run in the documented environment
- [ ] baseline ownership migration and RLS policies exist
- [ ] cross-user isolation integration tests pass
- [ ] CI enforces required quality gates
- [ ] secret handling and secret scanning are verified
- [ ] structured errors, correlation IDs, health checks, and log redaction are verified
- [ ] deployment and backup/restore procedures are documented

### Phase Status

- [ ] PHASE 0 COMPLETE
