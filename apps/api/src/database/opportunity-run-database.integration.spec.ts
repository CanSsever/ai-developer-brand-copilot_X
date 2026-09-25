import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_OPPORTUNITY_RUN_DB_INTEGRATION === "true";
const dbDescribe = enabled ? describe.sequential : describe.skip;
const ids = {
  user1: "f3600000-0000-4000-8000-000000000001", user2: "f3600000-0000-4000-8000-000000000002",
  project1: "f3600000-0000-4000-8000-000000000101", project2: "f3600000-0000-4000-8000-000000000102",
  connection1: "f3600000-0000-4000-8000-000000000201", connection2: "f3600000-0000-4000-8000-000000000202",
  repository1: "f3600000-0000-4000-8000-000000000301", repository2: "f3600000-0000-4000-8000-000000000302",
  sync1: "f3600000-0000-4000-8000-000000000401", sync2: "f3600000-0000-4000-8000-000000000402",
  intelligence1: "f3600000-0000-4000-8000-000000000501", intelligence2: "f3600000-0000-4000-8000-000000000502",
};
const boundary = new Date("2026-09-25T10:00:00.000Z");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let pool: Pool;

async function cleanup(client: PoolClient) {
  await client.query('DELETE FROM public."User" WHERE "id" = ANY($1::uuid[])', [[ids.user1, ids.user2]]);
}

async function seed(client: PoolClient) {
  await client.query('INSERT INTO public."User" ("id") VALUES ($1), ($2)', [ids.user1, ids.user2]);
  await client.query('INSERT INTO public."Project" ("id", "userId", "timezone") VALUES ($1,$2,$3),($4,$5,$3)',
    [ids.project1, ids.user1, "Europe/Berlin", ids.project2, ids.user2]);
  await client.query('INSERT INTO public."GitHubConnection" ("id","userId","providerInstallationId","providerAccountId","accountLogin","accountType") VALUES ($1,$2,936001,936101,$3,$4),($5,$6,936002,936102,$7,$4)',
    [ids.connection1, ids.user1, "task36-probe-1", "User", ids.connection2, ids.user2, "task36-probe-2"]);
  await client.query('INSERT INTO public."ConnectedRepository" ("id","projectId","gitHubConnectionId","providerRepositoryId","owner","name","defaultBranch","isPrivate") VALUES ($1,$2,$3,936201,$4,$5,$6,false),($7,$8,$9,936202,$10,$11,$6,false)',
    [ids.repository1, ids.project1, ids.connection1, "task36", "probe-1", "main", ids.repository2, ids.project2, ids.connection2, "task36", "probe-2"]);
  await client.query('INSERT INTO public."SyncRun" ("id","connectedRepositoryId","status","idempotencyKey","windowStart","windowEnd","startedAt","finishedAt") VALUES ($1,$2,\'succeeded\',$3,$4,$5,$4,$5),($6,$7,\'succeeded\',$8,$4,$5,$4,$5)',
    [ids.sync1, ids.repository1, hash("sync-1"), new Date("2026-09-25T09:00:00Z"), boundary,
      ids.sync2, ids.repository2, hash("sync-2")]);
  await client.query('INSERT INTO public."IntelligenceRun" ("id","projectId","sourceSyncRunId","status","trigger","runKey","processingVersion","groupingVersion","interpretationVersion","projectionVersion","sourceWindowStart","sourceWindowEnd","startedAt","finishedAt") VALUES ($1,$2,$3,\'succeeded\',\'sync_completion\',$4,$5,$6,$7,$8,$9,$10,$9,$10),($11,$12,$13,\'succeeded\',\'sync_completion\',$14,$5,$6,$7,$8,$9,$10,$9,$10)',
    [ids.intelligence1, ids.project1, ids.sync1, hash("intelligence-1"), hash("phase2"), "group-v1", "interpret-v1", "project-v1",
      new Date("2026-09-25T09:00:00Z"), boundary, ids.intelligence2, ids.project2, ids.sync2, hash("intelligence-2")]);
}

interface RunOptions { id?: string; projectId?: string; sourceId?: string; status?: string; runKey?: string;
  processingVersion?: string; inputFingerprint?: string; startedAt?: Date | null; finishedAt?: Date | null;
  attemptCount?: number; leaseToken?: string | null; leaseExpiresAt?: Date | null; candidateCount?: number;
  recommendedCount?: number; suppressedCount?: number; createdCount?: number; reusedCount?: number;
  orchestrationVersion?: string; inputSelectionVersion?: string; detectorVersion?: string; extractionVersion?: string;
  modelFingerprint?: string; scoringVersion?: string; evaluationBoundary?: Date; }

async function insertRun(client: PoolClient, label: string, options: RunOptions = {}) {
  const status = options.status ?? "succeeded";
  const finishedAt = options.finishedAt === undefined ? (status === "succeeded" || status === "failed_terminal" ? boundary : null) : options.finishedAt;
  return client.query(`INSERT INTO public."OpportunityRun" (
    "id","projectId","sourceIntelligenceRunId","status","trigger","runKey","processingVersion",
    "orchestrationVersion","inputSelectionVersion","detectorVersion","extractionVersion",
    "modelConfigurationFingerprint","scoringVersion","expectedInputFingerprint","evaluationBoundary",
    "startedAt","finishedAt","attemptCount","leaseToken","leaseExpiresAt","candidateCount",
    "recommendedCount","suppressedCount","createdOpportunityCount","reusedOpportunityCount")
    VALUES ($1,$2,$3,$4::"OpportunityRunStatus",'manual_reprocess',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
    RETURNING "id"`, [options.id ?? randomUUID(), options.projectId ?? ids.project1,
    options.sourceId ?? ids.intelligence1, status, options.runKey ?? hash(`run-${label}`),
    options.processingVersion ?? hash("phase3-v1"), options.orchestrationVersion ?? "orchestration-v1",
    options.inputSelectionVersion ?? "input-v1", options.detectorVersion ?? "detector-v1",
    options.extractionVersion ?? "extract-v1", options.modelFingerprint ?? hash("model-v1"),
    options.scoringVersion ?? "scoring-v1", options.inputFingerprint ?? hash(`input-${label}`),
    options.evaluationBoundary ?? boundary, options.startedAt ?? null, finishedAt, options.attemptCount ?? 0,
    options.leaseToken ?? null, options.leaseExpiresAt ?? null, options.candidateCount ?? 0,
    options.recommendedCount ?? 0, options.suppressedCount ?? 0, options.createdCount ?? 0, options.reusedCount ?? 0]);
}

async function rollbackProbe(run: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  await client.query("BEGIN");
  try { await run(client); } finally { await client.query("ROLLBACK"); client.release(); }
}

async function expectDatabaseError(client: PoolClient, operation: () => Promise<unknown>, code: string) {
  const savepoint = `probe_${Math.random().toString(16).slice(2)}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await expect(operation()).rejects.toMatchObject({ code });
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

async function claimRun(client: PoolClient, leaseToken: string, processingVersion: string, at: Date) {
  return client.query(`WITH candidate AS (
    SELECT run."id", (run."status"='running') AS recovered FROM public."OpportunityRun" run
    WHERE (run."status"='queued' OR (run."status"='running' AND run."leaseExpiresAt" <= $1))
      AND run."attemptCount" < 3 AND run."processingVersion"=$2
    ORDER BY CASE WHEN run."status"='running' THEN 0 ELSE 1 END, run."queuedAt", run."id"
    FOR UPDATE OF run SKIP LOCKED LIMIT 1)
    UPDATE public."OpportunityRun" run SET "status"='running', "startedAt"=COALESCE(run."startedAt",$1),
      "finishedAt"=NULL,"failureCode"=NULL,"retryAfterAt"=NULL,"attemptCount"=run."attemptCount"+1,
      "leaseToken"=$3::uuid,"leaseExpiresAt"=$1 + interval '15 minutes',"updatedAt"=$1
    FROM candidate WHERE run."id"=candidate."id"
    RETURNING run."id",run."leaseToken"::text,candidate.recovered`, [at, processingVersion, leaseToken]);
}

dbDescribe("applied OpportunityRun database invariants", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the explicitly enabled database probe");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    const client = await pool.connect();
    try { await cleanup(client); await seed(client); } catch (error) { await cleanup(client); throw error; } finally { client.release(); }
  }, 30_000);

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await cleanup(client);
      const remaining = await client.query('SELECT count(*)::int AS count FROM public."User" WHERE "id"=ANY($1::uuid[])',
        [[ids.user1, ids.user2]]);
      expect(remaining.rows[0].count).toBe(0);
    } finally { client.release(); await pool.end(); }
  }, 30_000);

  it("enforces source existence, same-Project ownership, and succeeded state", async () => rollbackProbe(async (client) => {
    await expectDatabaseError(client, () => insertRun(client, "missing", { sourceId: randomUUID() }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "cross", { sourceId: ids.intelligence2 }), "23514");
    await client.query('UPDATE public."IntelligenceRun" SET "status"=\'queued\', "finishedAt"=NULL WHERE "id"=$1', [ids.intelligence1]);
    await expectDatabaseError(client, () => insertRun(client, "not-succeeded"), "23514");
  }));

  it("enforces exact identity and permits changed fingerprint or processing version", async () => rollbackProbe(async (client) => {
    await insertRun(client, "identity", { runKey: hash("identity-one"), inputFingerprint: hash("input-one") });
    await expectDatabaseError(client, () => insertRun(client, "identity", {
      runKey: hash("identity-two"), inputFingerprint: hash("input-one") }), "23505");
    await insertRun(client, "identity-input", { runKey: hash("identity-three"), inputFingerprint: hash("input-two") });
    await insertRun(client, "identity-version", { runKey: hash("identity-four"), inputFingerprint: hash("input-one"),
      processingVersion: hash("phase3-v2") });
  }));

  it("enforces one active run while retaining terminal history", async () => rollbackProbe(async (client) => {
    await insertRun(client, "active", { status: "queued", finishedAt: null });
    await expectDatabaseError(client, () => insertRun(client, "active-running", { status: "running", startedAt: boundary,
      finishedAt: null, leaseToken: randomUUID(), leaseExpiresAt: new Date(boundary.getTime() + 60_000) }), "23505");
    await expectDatabaseError(client, () => insertRun(client, "active-retry", { status: "failed_retryable", finishedAt: null }), "23505");
    await insertRun(client, "terminal-history", { status: "succeeded" });
    const result = await client.query('SELECT count(*)::int AS count FROM public."OpportunityRun" WHERE "projectId"=$1', [ids.project1]);
    expect(result.rows[0].count).toBe(2);
  }));

  it("enforces lease and terminal timestamp state", async () => rollbackProbe(async (client) => {
    await expectDatabaseError(client, () => insertRun(client, "running-no-lease", { status: "running", startedAt: boundary,
      finishedAt: null }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "running-no-expiry", { status: "running", startedAt: boundary,
      finishedAt: null, leaseToken: randomUUID() }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "running-no-start", { status: "running", finishedAt: null,
      leaseToken: randomUUID(), leaseExpiresAt: new Date(boundary.getTime() + 60_000) }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "queued-with-lease", { status: "queued", finishedAt: null,
      leaseToken: randomUUID(), leaseExpiresAt: new Date(boundary.getTime() + 60_000) }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "terminal-no-finish", { status: "failed_terminal", finishedAt: null }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "queued-finished", { status: "queued", finishedAt: boundary }), "23514");
  }));

  it("enforces attempt and counter bounds", async () => rollbackProbe(async (client) => {
    await expectDatabaseError(client, () => insertRun(client, "attempt-low", { attemptCount: -1 }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "attempt-high", { attemptCount: 4 }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "negative-counter", { candidateCount: -1 }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "decision-overflow", { candidateCount: 1,
      recommendedCount: 1, suppressedCount: 1, createdCount: 1 }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "success-incomplete", { candidateCount: 1,
      recommendedCount: 1, createdCount: 0, reusedCount: 0 }), "23514");
  }));

  it("enforces processing hashes and non-empty component versions", async () => rollbackProbe(async (client) => {
    await expectDatabaseError(client, () => insertRun(client, "bad-run-key", { runKey: "not-a-hash" }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "bad-processing", { processingVersion: "not-a-hash" }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "bad-input", { inputFingerprint: "not-a-hash" }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "bad-model", { modelFingerprint: "not-a-hash" }), "23514");
    await expectDatabaseError(client, () => insertRun(client, "empty-component", { detectorVersion: "" }), "23514");
  }));

  it("cascades from Project and source IntelligenceRun without orphans", async () => rollbackProbe(async (client) => {
    await insertRun(client, "project-cascade");
    await client.query('DELETE FROM public."Project" WHERE "id"=$1', [ids.project1]);
    const result = await client.query('SELECT count(*)::int AS count FROM public."OpportunityRun" WHERE "projectId"=$1', [ids.project1]);
    expect(result.rows[0].count).toBe(0);
  }));

  it("cascades when its source IntelligenceRun is deleted", async () => rollbackProbe(async (client) => {
    await insertRun(client, "source-cascade");
    await client.query('DELETE FROM public."IntelligenceRun" WHERE "id"=$1', [ids.intelligence1]);
    const result = await client.query('SELECT count(*)::int AS count FROM public."OpportunityRun" WHERE "projectId"=$1', [ids.project1]);
    expect(result.rows[0].count).toBe(0);
  }));

  it("enables owner-scoped SELECT RLS and denies authenticated table writes", async () => rollbackProbe(async (client) => {
    const relation = await client.query(`SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='OpportunityRun'`);
    expect(relation.rows).toEqual([{ relrowsecurity: true }]);
    const policies = await client.query(`SELECT cmd, roles, qual FROM pg_policies WHERE schemaname='public' AND tablename='OpportunityRun'`);
    expect(policies.rows).toHaveLength(1);
    expect(policies.rows[0].cmd).toBe("SELECT");
    expect(policies.rows[0].roles).toContain("authenticated");
    expect(policies.rows[0].qual).toContain("auth.uid()");
    expect(policies.rows[0].qual).toContain("Project");
    const privileges = await client.query(`SELECT
      has_table_privilege('authenticated','public."OpportunityRun"','SELECT') AS select_ok,
      has_table_privilege('authenticated','public."OpportunityRun"','INSERT') AS insert_ok,
      has_table_privilege('authenticated','public."OpportunityRun"','UPDATE') AS update_ok,
      has_table_privilege('authenticated','public."OpportunityRun"','DELETE') AS delete_ok`);
    expect(privileges.rows[0]).toEqual({ select_ok: true, insert_ok: false, update_ok: false, delete_ok: false });
  }));

  it("converges concurrent canonical inserts to one durable database row", async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    const runId = randomUUID();
    try {
      await first.query("BEGIN");
      await second.query("BEGIN");
      await insertRun(first, "concurrent", { id: runId, runKey: hash("concurrent-run"), inputFingerprint: hash("concurrent-input") });
      const loser = insertRun(second, "concurrent", { runKey: hash("concurrent-run"), inputFingerprint: hash("concurrent-input") });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await first.query("COMMIT");
      await expect(loser).rejects.toMatchObject({ code: "23505" });
      await second.query("ROLLBACK");
      const count = await first.query('SELECT count(*)::int AS count FROM public."OpportunityRun" WHERE "id"=$1', [runId]);
      expect(count.rows[0].count).toBe(1);
    } finally {
      await first.query('DELETE FROM public."OpportunityRun" WHERE "id"=$1', [runId]).catch(() => undefined);
      first.release(); second.release();
    }
  }, 15_000);

  it("uses SKIP LOCKED so two claimers cannot own one queued run", async () => {
    const setup = await pool.connect();
    const workerA = await pool.connect();
    const workerB = await pool.connect();
    const runId = randomUUID();
    const processingVersion = hash("claim-version");
    try {
      await insertRun(setup, "claim", { id: runId, status: "queued", finishedAt: null,
        runKey: hash("claim-run"), inputFingerprint: hash("claim-input"), processingVersion });
      await workerA.query("BEGIN"); await workerB.query("BEGIN");
      const a = await claimRun(workerA, randomUUID(), processingVersion, boundary);
      const b = await claimRun(workerB, randomUUID(), processingVersion, boundary);
      expect(a.rows).toHaveLength(1);
      expect(b.rows).toHaveLength(0);
      await workerA.query("ROLLBACK"); await workerB.query("ROLLBACK");
    } finally {
      await setup.query('DELETE FROM public."OpportunityRun" WHERE "id"=$1', [runId]).catch(() => undefined);
      setup.release(); workerA.release(); workerB.release();
    }
  }, 15_000);

  it("recovers an expired run and fences the stale lease token", async () => {
    const client = await pool.connect();
    const runId = randomUUID();
    const oldLease = randomUUID();
    const newLease = randomUUID();
    const processingVersion = hash("recovery-version");
    try {
      await insertRun(client, "recovery", { id: runId, status: "running", startedAt: new Date(boundary.getTime()-60_000),
        finishedAt: null, attemptCount: 1, leaseToken: oldLease, leaseExpiresAt: new Date(boundary.getTime()-1_000),
        runKey: hash("recovery-run"), inputFingerprint: hash("recovery-input"), processingVersion });
      const recovered = await claimRun(client, newLease, processingVersion, boundary);
      expect(recovered.rows).toMatchObject([{ id: runId, leaseToken: newLease, recovered: true }]);
      const stale = await client.query('UPDATE public."OpportunityRun" SET "candidateCount"=1 WHERE "id"=$1 AND "status"=\'running\' AND "leaseToken"=$2 RETURNING "id"', [runId, oldLease]);
      expect(stale.rowCount).toBe(0);
      const owner = await client.query('UPDATE public."OpportunityRun" SET "leaseExpiresAt"=$2 WHERE "id"=$1 AND "status"=\'running\' AND "leaseToken"=$3 RETURNING "id"',
        [runId, new Date(boundary.getTime()+1_200_000), newLease]);
      expect(owner.rowCount).toBe(1);
    } finally {
      await client.query('DELETE FROM public."OpportunityRun" WHERE "id"=$1', [runId]).catch(() => undefined);
      client.release();
    }
  });

  it("excludes stale versions and terminalizes retry exhaustion", async () => {
    const client = await pool.connect();
    const staleId = randomUUID();
    const exhaustedId = randomUUID();
    try {
      await insertRun(client, "stale-version", { id: staleId, status: "queued", finishedAt: null,
        runKey: hash("stale-run"), inputFingerprint: hash("stale-input"), processingVersion: hash("old-version") });
      const claim = await claimRun(client, randomUUID(), hash("current-version"), boundary);
      expect(claim.rows).toHaveLength(0);
      await client.query('UPDATE public."OpportunityRun" SET "status"=\'failed_terminal\',"finishedAt"=$2,"failureCode"=\'OPPORTUNITY_CONFIGURATION_STALE\' WHERE "id"=$1', [staleId, boundary]);
      await insertRun(client, "exhausted", { id: exhaustedId, status: "failed_retryable", finishedAt: null,
        attemptCount: 3, runKey: hash("exhausted-run"), inputFingerprint: hash("exhausted-input") });
      await client.query('UPDATE public."OpportunityRun" SET "status"=\'failed_terminal\',"finishedAt"=$2,"failureCode"=\'OPPORTUNITY_RETRY_EXHAUSTED\' WHERE "id"=$1 AND "attemptCount">=3', [exhaustedId, boundary]);
      const result = await client.query('SELECT "status","failureCode" FROM public."OpportunityRun" WHERE "id"=$1', [exhaustedId]);
      expect(result.rows).toEqual([{ status: "failed_terminal", failureCode: "OPPORTUNITY_RETRY_EXHAUSTED" }]);
    } finally {
      await client.query('DELETE FROM public."OpportunityRun" WHERE "id"=ANY($1::uuid[])', [[staleId, exhaustedId]]).catch(() => undefined);
      client.release();
    }
  });
});
