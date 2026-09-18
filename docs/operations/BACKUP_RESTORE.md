# Database Backup and Restore Runbook

## Purpose and verification status

This runbook defines how the Supabase/PostgreSQL database is backed up and restored. It does not claim that a production backup, production restore, or restore rehearsal has been executed.

The Phase 0 exit gate requires the deployment environments and backup/restore procedure to be documented. The separate PDR non-functional requirement says the restore procedure must be tested before MVP release, and the Phase 5 release gate requires restore and release checklists to have been exercised. Therefore this document closes the Phase 0 documentation requirement; a recorded non-production restore rehearsal remains mandatory before MVP release.

## Recovery scope

A recoverable database backup must cover the complete PostgreSQL state needed by the application, including:

- the application schemas and data, currently including `User`, `Project`, `GitHubConnection`, `ConnectedRepository`, and `GitHubConnectionAttempt`;
- Supabase Auth database state required for application identities;
- Prisma migration history;
- indexes, constraints, enums, functions, grants, and RLS policies;
- any future database extensions or scheduled database work that are explicitly part of the deployed system.

The Git repository remains the source for reviewed Prisma schema and migration files, but it is not a data backup.

The following are outside the database backup and must be managed separately:

- Vercel and API-container configuration;
- Supabase Auth provider settings, redirect allowlists, project API keys, and platform settings;
- database credentials and secret-manager values;
- GitHub OAuth client secrets;
- GitHub App private keys and client secrets;
- provider access tokens, JWT signing material, and environment secrets; and
- future object-storage contents. Supabase database backups include storage metadata, not deleted Storage API objects. Phase 0 does not use Supabase Storage.

Do not place any of those secrets into a database dump to make a restore appear self-contained.

## Backup strategy

### Managed Supabase backups

Production must use the backup option supported by the selected Supabase plan and verify it in the Supabase Dashboard before accepting user data. Supabase backup availability, retention, download behavior, and PITR eligibility depend on the active project plan and configuration; operators must confirm the current settings rather than infer them from this repository.

The current official references are:

- [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase backup and restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase restore to a new project](https://supabase.com/docs/guides/platform/clone-project)

At production readiness review:

1. Record the enabled managed-backup mode and visible recovery window without copying credentials.
2. Enable PITR when required by the approved recovery objective and supported by the project plan. The PDR includes PITR in the production plan, but Phase 0 does not claim it is already enabled.
3. Confirm who can view, create, download, and restore backups; apply least-privilege platform roles.
4. Confirm alerts or operational checks that detect a missing/stale recovery point.
5. Confirm that project deletion, plan changes, or PITR changes will not unexpectedly remove the only usable recovery path.

### Logical backup for portability or pre-change protection

Use an encrypted logical backup when a portable/off-site copy or a pre-migration safety snapshot is required. Follow the current Supabase CLI procedure or compatible PostgreSQL `pg_dump`/`pg_restore` tooling. Match client tooling to the target PostgreSQL version and validate the result with a restore rehearsal.

A PostgreSQL service definition or equivalent short-lived secret injection should provide connection details outside the repository and shell history. An illustrative custom-format dump command is:

```bash
pg_dump --dbname="service=approved_backup_source" --format=custom --file="<encrypted-off-repository-path>/database.dump"
```

This is not authorization to run against production. The operator must verify the exact source project, required schema/role permissions, output destination, available disk space, encryption, and tool compatibility first. A partial `public`-schema-only dump is not a complete recovery backup because authentication and platform-managed database state may also be required.

Never write a real dump beneath the repository working tree. Never commit `.dump`, `.backup`, SQL exports, or archives containing real user/application data.

## Frequency and retention principles

No contractual RPO, RTO, fixed retention period, or backup frequency has been approved in Phase 0.

Operationally:

- Use managed daily backups as the minimum production baseline when the selected Supabase plan provides them.
- Use PITR when the approved data-loss tolerance is shorter than the managed daily-backup interval.
- Take and verify an additional recovery point before destructive, long-running, or difficult-to-reverse migrations.
- Retain enough generations to cover likely incident-detection delay, release rollback windows, security/legal requirements, and provider-plan limits.
- Keep at least one recovery method independent of the application deployment artifact; use encrypted off-site logical backups when the approved risk assessment requires provider-independent recovery.
- Reassess retention after material data-growth, compliance, plan, or architecture changes.

The product owner and operations owner must approve formal RPO/RTO values before production launch. A restore rehearsal records observed recovery point age and elapsed recovery time; it does not itself create a guaranteed service level.

## Backup storage and access

- Treat every backup as sensitive production data because it can contain user identity, Project ownership, private repository metadata, and authentication records.
- Store exports only in an approved encrypted backup location, separate from the source repository and application deployment storage.
- Encrypt backups in transit and at rest. Keep encryption keys in the secret-management/key-management system, separate from the backup object.
- Limit backup and restore permissions to designated operators. Log access and destructive restore approvals.
- Apply retention/deletion policy to backup objects and temporary restore environments.
- Never place database credentials in command examples, CI logs, issue trackers, release records, or documentation.
- GitHub App private keys, Supabase/JWT secrets, OAuth secrets, and environment variables are not database-backup content. Back them up or escrow them separately through the approved secret-management process.

## Restore decision and approval

Before restoring, identify the recovery objective and choose the least destructive option:

- For inspection, data comparison, or recovery of selected records, restore or clone to a new isolated project first.
- For a failed schema release, prefer a reviewed corrective forward migration when data is intact.
- Use an in-place managed restore only for a confirmed recovery incident where its downtime and potential data loss are accepted.

An in-place production restore requires explicit incident/release authority approval. The operator must state the selected source backup/recovery time, estimated data-loss window, expected downtime, and rollback/escalation path. Do not proceed from an ambiguous project name or unverified target.

## Restore rehearsal and recovery runbook

Prefer a non-production rehearsal into a new, isolated Supabase project. For every run:

1. **Open a recovery record.** State the incident or rehearsal purpose, source environment, desired recovery point, owning operator, approver, and start time. Do not record secrets or personal identifiers.
2. **Identify the backup.** Verify its timestamp, source project, backup type, retention state, PostgreSQL compatibility, and integrity/checksum where the backup format provides one.
3. **Select a safe target.** Use a new or disposable non-production Supabase project whenever possible. Record an environment fingerprint that distinguishes it from production.
4. **Prevent production overwrite.** Require a second confirmation of source and target before any destructive command. Keep production application URLs, DNS, and deployment variables unchanged during a rehearsal. Do not give the restore target production GitHub App secrets or enable external jobs/callbacks.
5. **Quiesce when necessary.** For an approved in-place production restore, enter the declared maintenance/read-only state, stop application writes and background work, record the final safe recovery point, and communicate expected downtime.
6. **Restore schema and data.** Use the Supabase managed backup/PITR workflow or the current official logical restore procedure. For a logical custom-format backup, an illustrative non-production command is:

   ```bash
   pg_restore --dbname="service=approved_restore_target" --no-owner "<secure-backup-path>/database.dump"
   ```

   Adjust the reviewed restore flags to the selected backup and target. Do not add destructive flags or point the service definition at production without the approved in-place restore plan.
7. **Reconfigure platform state.** A new Supabase project requires separate Auth provider settings, redirect URLs, API keys, and other platform settings. Restore these from the controlled environment inventory/secret manager, not from the Git repository or database dump.
8. **Verify migration state.** With the restored target's `DIRECT_URL` supplied through the secure operator environment, run `pnpm db:migrate:status`. If the backup predates the application release, review and apply only the committed forward migrations with `pnpm db:migrate:deploy`, then rerun status. Never run `prisma migrate dev` or `prisma db push` on the restore target.
9. **Verify database connectivity.** Supply the target's pooled `DATABASE_URL` securely and run `pnpm db:check`. Confirm failures remain redacted.
10. **Start isolated application instances.** Point a staging web/API deployment only at the restore target. Confirm that no production database URL or production callback is present.
11. **Verify health.** Confirm `GET /health` and `GET /health/db` return their expected HTTP 200 safe responses and request correlation remains enabled.
12. **Verify authentication.** Configure a staging/test GitHub OAuth provider, sign in with a dedicated test identity, verify session refresh/sign-out, and verify bearer-protected `GET /auth/me`. Do not use or expose another user's restored session.
13. **Verify ownership and RLS.** Confirm the ownership relationships and RLS policies exist. Using two authorized test identities created for the isolated environment, verify own-row access and bidirectional cross-user denial without recording UUIDs or tokens.
14. **Verify GitHub connection metadata.** Check that connection/repository metadata and Project relations have expected counts and ownership. Do not call GitHub with production credentials or reconnect restored installations during a rehearsal unless a separately approved isolated integration test requires it.
15. **Run smoke and regression checks.** Verify the authenticated dashboard, Project listing/creation where mutation is approved, safe error behavior, and any release-specific critical workflow. Compare expected row counts and migration records to the recovery record without exporting sensitive rows.
16. **Decide disposition.** For a rehearsal, revoke credentials and securely destroy the temporary project/export according to retention policy. For an incident, obtain approval before redirecting production traffic or resuming writes.
17. **Close the recovery record.** Record end time, observed recovery-point age, elapsed restore time, validation results, data gaps, failures, operator/approver, cleanup, and follow-up actions. Do not include secrets, database URLs, tokens, private repository names, or user identifiers.

## Post-restore acceptance checklist

A restore is not accepted until all applicable checks pass:

- [ ] source backup and target were independently confirmed;
- [ ] schema, data, migration history, grants, and RLS policies are present;
- [ ] `pnpm db:migrate:status` reports the intended state;
- [ ] `pnpm db:check` succeeds against the restore target;
- [ ] `/health` and `/health/db` return HTTP 200 safely;
- [ ] Supabase Auth configuration and an isolated sign-in/session flow work;
- [ ] Project ownership and two-user RLS isolation pass;
- [ ] GitHub connection metadata is internally consistent;
- [ ] application smoke tests pass without production provider access;
- [ ] observed data-loss window and recovery time are recorded;
- [ ] temporary exports, credentials, and restore environments have an approved disposition; and
- [ ] the incident/rehearsal record is reviewed and closed.

## Disaster-recovery validation schedule

- Phase 0: this documented procedure is required and is sufficient for the Phase 0 exit gate. No restore execution is claimed.
- Before MVP release: execute and record at least one non-production restore rehearsal, as required by the PDR non-functional and Phase 5 release gates.
- After material database, backup-provider, encryption, or restore-procedure changes: repeat the rehearsal before relying on the changed recovery path.
- Production restore: execute only for an approved incident; it is never a routine verification step.

Until a rehearsal is recorded, backup restorability and actual RTO are unverified operational properties even though the Phase 0 documentation gate is complete.
