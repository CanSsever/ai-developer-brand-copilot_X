# Deployment Environments and Release Procedure

## Purpose and verification status

This runbook defines the Phase 0 deployment contract for the current application. It is documentation of the required process; it is not evidence that staging or production has been deployed. Record every real deployment separately with the release identifier, environment, operator, approvals, migration result, health checks, and rollback outcome.

The PDR selects Vercel for the Next.js web application and container-based hosting for the NestJS API. It does not select a specific API container provider. PostgreSQL, Supabase Auth, and the public Supabase API are supplied by Supabase.

## Current deployable components

| Component | Deployment model | State and data responsibility |
| --- | --- | --- |
| `apps/web` | Vercel, built from the pnpm monorepo | Stateless Next.js application; owns no database credentials or GitHub App secrets |
| `apps/api` | Long-running Node.js 22 container | NestJS API plus PostgreSQL-backed sync worker; owns server-only database and GitHub App configuration, while durable work state remains in PostgreSQL |
| Supabase | One isolated project per deployed environment | PostgreSQL, Auth configuration, publishable key, database backups, and RLS |
| GitHub OAuth App | Separate registration per deployed environment | User sign-in callback to Supabase Auth |
| GitHub App | Separate registration per deployed environment | Repository authorization callback to the web application |
| GitHub Actions | Pull requests and pushes to `main` | Quality and secret-scan gates; it does not deploy or receive production secrets |

The repository does not currently contain a Dockerfile, deployment workflow, or provider-specific API manifest. Before the first staging deployment, the selected container platform must implement the build/runtime contract below. This is deployment work, not Phase 1 product functionality.

## Responsibilities

- The release operator promotes only a reviewed commit whose required GitHub Actions jobs passed.
- The web platform owner configures the Vercel project, public web variables, custom domain, and immutable deployment rollback.
- The API platform owner configures the container build, runtime secrets, TLS endpoint, health probes, log retention, and previous-image rollback.
- The Supabase project owner controls database access, Auth redirects, backups/PITR, migration credentials, and restore approval.
- The GitHub integration owner configures separate OAuth and GitHub App registrations and exact callbacks for each environment.
- No one role should have more access than necessary. Production migration and restore access must be limited to designated operators.

## Environment strategy

### Local development

- Web: `http://localhost:3000`, started with `pnpm --filter @developer-brand-copilot/web dev`.
- API: `http://localhost:3001`, started with `pnpm --filter @developer-brand-copilot/api dev`.
- Configuration lives only in ignored local environment files based on the checked-in examples.
- The development Supabase project and development GitHub OAuth/GitHub App registrations must not contain production data or production credentials.
- The documented local callbacks are the Supabase provider callback, `http://localhost:3000/auth/callback`, and `http://localhost:3000/github/callback` as appropriate to each provider configuration.

### Staging

- Use a dedicated Vercel staging project or an equivalently isolated Vercel environment with a stable HTTPS hostname.
- Deploy the API as a dedicated container service with its own HTTPS hostname.
- Use a Supabase project that is separate from production. Staging must not point at the production database or reuse production database credentials.
- Use separate GitHub OAuth and GitHub App registrations so staging callbacks, private keys, client secrets, and installations cannot affect production.
- Use synthetic or explicitly approved test data. A production database copy may be used only through the controlled restore process in `BACKUP_RESTORE.md`, with access restrictions and external integrations disabled.
- Staging is the release-candidate environment for migrations, Auth callbacks, GitHub App callbacks, ownership/RLS checks, and smoke tests.

### Production

- Use the Vercel production environment for the web application and an independently scalable container service for the API.
- Use a dedicated production Supabase project and production-only GitHub OAuth/GitHub App registrations.
- Require HTTPS for the web, API, Supabase, OAuth, and GitHub App callback URLs.
- Store all server secrets in the platform secret manager. Do not copy local environment files to a deployment image.
- Enable and verify the selected managed backup/PITR plan before accepting production user data. Backup details and the pre-release restore requirement are in `BACKUP_RESTORE.md`.
- Restrict production deployment, migration, backup, and restore permissions to authorized operators and retain an auditable release record.

## Environment-variable boundary

Use the checked-in example files only as name references. Real values belong in local ignored files or the relevant deployment secret/configuration store.

### Browser-public web configuration

These values are included in the web build and may be visible to a browser:

- `NEXT_PUBLIC_API_BASE_URL`: public HTTPS origin of the API.
- `NEXT_PUBLIC_SITE_URL`: canonical HTTPS origin of the web application.
- `NEXT_PUBLIC_SUPABASE_URL`: public Supabase project origin.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: environment-specific Supabase publishable key.

No database URL, service-role key, OAuth secret, GitHub App private key, provider token, or refresh token may use a `NEXT_PUBLIC_` name.

### API runtime configuration

- Runtime controls: `NODE_ENV=production` and provider-supplied `PORT`.
- Database secrets: `DATABASE_URL` for the pooled runtime connection and `DIRECT_URL` for controlled Prisma CLI/migration access.
- Supabase verification configuration: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The publishable key is not a privileged secret, but it remains server configuration in the API.
- GitHub App identifiers/configuration: `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_SLUG`, and `GITHUB_APP_CALLBACK_URL`.
- GitHub App secrets: `GITHUB_APP_CLIENT_SECRET` and `GITHUB_APP_PRIVATE_KEY`.

`DIRECT_URL`, database credentials, the GitHub client secret, and the private key must be available only to the processes that require them. Prefer a separate short-lived migration job so the normal API runtime does not need migration privileges. The application does not require or accept a Supabase service-role key.

## Callback and origin configuration

For each environment, configure exact HTTPS origins and paths; do not use production wildcards:

1. Set the Supabase Auth Site URL to that environment's canonical web origin.
2. Add the environment's `<web-origin>/auth/callback` to the Supabase redirect allowlist.
3. Set the GitHub OAuth App authorization callback to the callback shown by that environment's Supabase GitHub provider.
4. Set the GitHub App callback and `GITHUB_APP_CALLBACK_URL` to `<web-origin>/github/callback`.
5. Set `NEXT_PUBLIC_SITE_URL` to the same canonical web origin and `NEXT_PUBLIC_API_BASE_URL` to the environment's API origin.

The current browser does not call the NestJS API directly; authenticated requests cross the existing Next.js server boundary. The API therefore has no CORS configuration today. Keep this server-to-server boundary. If a future approved task introduces direct browser-to-API calls, add an explicit per-environment origin allowlist and credential policy; never enable permissive wildcard CORS as a deployment shortcut.

## Build and start contract

All builds use Node.js 22.13.0 or a compatible pinned Node 22 runtime and pnpm 11.22.0.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:validate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Web deployment

- Configure Vercel for the pnpm workspace so `apps/web` can resolve `packages/config` and `packages/contracts`.
- Install from the lockfile and build with `pnpm --filter @developer-brand-copilot/web build` or the equivalent root build.
- Supply the four `NEXT_PUBLIC_*` values during the build and runtime environment.
- Vercel owns the production start command and immutable deployment artifact. Do not run `next dev` in a deployed environment.

### API container deployment

- Use a build stage with repository dev dependencies available, because Prisma generation and TypeScript compilation occur during build.
- Build with `pnpm --filter @developer-brand-copilot/api build` from the workspace.
- The runtime image must contain the API `dist` output, generated Prisma client, production dependencies, and required workspace package outputs.
- Start with `pnpm --filter @developer-brand-copilot/api start` or the equivalent `node dist/main.js` from `apps/api`.
- Run as a non-root user where the platform permits it, use a read-only filesystem except for platform-required temporary paths, and inject secrets at runtime rather than baking them into an image layer.
- Configure the platform health probe to call `GET /health`. Use `GET /health/db` as a database-readiness diagnostic, not as a high-frequency liveness probe.
- The same API process hosts the durable GitHub sync worker. Keep at least one long-running API replica active; serverless request-only execution is not compatible with this worker lifecycle.
- Multiple API replicas are supported. PostgreSQL `FOR UPDATE SKIP LOCKED`, one-active-run-per-repository uniqueness, and lease tokens prevent authoritative duplicate claims/finalization.
- The worker polls for queued work every five seconds, heartbeats owned leases every 30 seconds, and uses a 15-minute lease. Graceful shutdown stops new claims and waits for the active tick. Abrupt termination leaves queued work intact and makes running work recoverable after lease expiry.
- Repository scheduling is database-gated to at most hourly per active repository and is separate from the five-second queue poll. Inactive/disconnected repositories are not scheduled or claimed.
- This migration is not compatible with old API instances starting new SyncRuns, because every running row must carry a lease. Pause/drain old API replicas and manual sync traffic, apply the SyncRun lease migration, deploy the worker-enabled API, then resume traffic. Do not run old and new sync writers concurrently across this migration.

## Migration and controlled release procedure

Schema changes follow a forward-migration workflow:

1. Create migrations only in development with `pnpm db:migrate:dev` against a non-production database.
2. Review the Prisma schema and every committed migration SQL file. Confirm ownership constraints, RLS/grants/policies, indexes, data transforms, lock duration, and destructive operations.
3. Run CI and require the hosted quality-gates and secret-scan jobs to pass for the exact release commit.
4. Apply the committed migrations to staging with `pnpm db:migrate:deploy`; never use `prisma migrate dev` or `prisma db push` in staging or production.
5. Run `pnpm db:migrate:status`, application tests, health checks, authentication, ownership/RLS, and GitHub connection smoke tests in staging.
6. For a destructive, long-running, or hard-to-reverse migration, require explicit review, a maintenance window, a verified pre-change backup, and a tested recovery plan.
7. Run `pnpm db:migrate:deploy` as a controlled production migration job using the production `DIRECT_URL`. Migrations should be backward-compatible with the currently running application whenever practical.
8. Deploy the API and then the web application, or use an expand-and-contract sequence when old and new application versions overlap.
9. Run post-release verification and record the result. Do not mark a release complete while migration status or health checks are failing.

Database schema rollback is not assumed to be reversible. Prisma migration deployment applies forward migrations and does not provide an automatic safe down migration. Prefer a corrective forward migration. A database restore is a disaster-recovery action with potential downtime and data loss, not a routine application rollback.

## Post-deployment verification

At minimum, verify:

1. `GET /health` returns HTTP 200 with the safe application health body.
2. `GET /health/db` returns HTTP 200 without exposing connection details.
3. API logs contain a request correlation ID and no query string, credential, or provider payload.
4. The web sign-in flow returns through the configured Supabase callback and session refresh works.
5. `GET /auth/me` succeeds for an authenticated test account.
6. The authenticated dashboard loads only owned Projects.
7. The environment's GitHub App callback and authorized-repository selection work without exposing provider tokens.
8. `pnpm db:migrate:status` reports the target schema up to date from the controlled migration environment.

Use dedicated staging/test identities. Do not place identifiers or credentials in the release record.

## Rollback

- Web: promote the previous known-good immutable Vercel deployment after confirming it is compatible with the current database schema.
- API: redeploy the previous known-good container image after the same schema-compatibility check.
- Configuration: restore the previous versioned platform configuration/secret references without copying secret values into the repository or incident record.
- Database: do not delete migration history or attempt an improvised down migration. Prefer a reviewed corrective forward migration. Use backup/PITR restoration only under the approval and validation process in `BACKUP_RESTORE.md`.
- If callbacks or domains changed, restore the previous exact Supabase/GitHub configuration as part of rollback and verify sign-in and repository authorization again.

## Release record

For each staging or production deployment, record outside the secret store:

- environment, release commit, immutable web/API artifact identifiers, date, and operator;
- linked CI run and approvals;
- migration names and status, without database URLs or credentials;
- backup/recovery point confirmation for risky changes;
- health, auth, ownership/RLS, and GitHub connection smoke-test results;
- rollback decision and result; and
- open incidents or follow-up actions.

Never record tokens, cookies, private keys, database URLs, private repository names, or user identifiers.
