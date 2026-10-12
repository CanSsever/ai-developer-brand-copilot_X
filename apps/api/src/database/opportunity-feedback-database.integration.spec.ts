import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { OpportunityFeedbackService } from "../development-intelligence/opportunity-feedback.service";
import { PrismaService } from "./prisma.service";

const enabled = process.env.RUN_OPPORTUNITY_FEEDBACK_DB_INTEGRATION === "true";
const dbDescribe = enabled ? describe.sequential : describe.skip;
const ids = {
  user1: "f3800000-0000-4000-8000-000000000001",
  user2: "f3800000-0000-4000-8000-000000000002",
  project1: "f3800000-0000-4000-8000-000000000101",
  project2: "f3800000-0000-4000-8000-000000000102",
  project3: "f3800000-0000-4000-8000-000000000103",
  opportunity1: "f3800000-0000-4000-8000-000000000201",
  opportunity2: "f3800000-0000-4000-8000-000000000202",
  opportunity3: "f3800000-0000-4000-8000-000000000203",
  opportunity4: "f3800000-0000-4000-8000-000000000204",
  opportunity5: "f3800000-0000-4000-8000-000000000205",
};
const boundary = new Date("2026-09-25T10:00:00.000Z");
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
let pool: Pool;
let prisma: PrismaService | undefined;
let feedbackService: OpportunityFeedbackService | undefined;
let fixtureSeeded = false;

async function cleanup(client: PoolClient): Promise<void> {
  await client.query('DELETE FROM public."User" WHERE "id" = ANY($1::uuid[])', [[ids.user1, ids.user2]]);
}

async function seed(client: PoolClient): Promise<void> {
  await client.query('INSERT INTO public."User" ("id") VALUES ($1), ($2)', [ids.user1, ids.user2]);
  await client.query('INSERT INTO public."Project" ("id", "userId", "timezone") VALUES ($1,$2,$3),($4,$5,$3),($6,$7,$3)',
    [ids.project1, ids.user1, "Europe/Berlin", ids.project2, ids.user2, ids.project3, ids.user1]);
  await insertOpportunity(client, ids.opportunity1, ids.project1, "feedback-a");
  await insertOpportunity(client, ids.opportunity2, ids.project2, "feedback-b");
  await insertOpportunity(client, ids.opportunity3, ids.project3, "feedback-c");
  await insertOpportunity(client, ids.opportunity4, ids.project1, "feedback-d");
  await insertOpportunity(client, ids.opportunity5, ids.project1, "feedback-suppressed", { status: "suppressed", shouldPost: false });
}

async function insertOpportunity(
  client: PoolClient,
  id: string,
  projectId: string,
  label: string,
  lifecycle: { status: "recommended" | "suppressed"; shouldPost: boolean } = { status: "recommended", shouldPost: true },
): Promise<void> {
  await client.query(`INSERT INTO public."ContentOpportunity" (
    "id", "projectId", "candidateKey", "inputFingerprint", "opportunityType", "topicKey", "title",
    "recommendedFormat", "priorityScore", "noveltyScore", "shouldPost", "confidence", "status", "scoringVersion"
  ) VALUES ($1,$2,$3,$4,'progress_update','feedback-topic',$5,'short_update',0.8,0.8,$6,0.8,$7::"ContentOpportunityStatus",'phase3-feedback-test')`,
  [id, projectId, hash(`candidate-${label}`), hash(`input-${label}`), `Synthetic ${label}`, lifecycle.shouldPost, lifecycle.status]);
}

interface InsertFeedbackOptions {
  id?: string;
  userId?: string;
  opportunityId?: string;
  action?: string;
  reason?: string | null;
  current?: boolean;
  supersededAt?: Date | null;
  keyHash?: string;
  fingerprint?: string;
}

async function insertFeedback(client: PoolClient, options: InsertFeedbackOptions = {}): Promise<string> {
  const id = options.id ?? randomUUID();
  await client.query(`INSERT INTO public."OpportunityFeedback" (
    "id", "userId", "opportunityId", "action", "reason", "isCurrent", "supersededAt",
    "idempotencyKeyHash", "requestFingerprint", "createdAt"
  ) VALUES ($1,$2,$3,$4::"OpportunityFeedbackAction",$5::"OpportunityFeedbackReason",$6,$7,$8,$9,$10)`, [
    id, options.userId ?? ids.user1, options.opportunityId ?? ids.opportunity1,
    options.action ?? "accepted", options.reason ?? null, options.current ?? true,
    options.supersededAt ?? null, options.keyHash ?? hash(`key-${id}`), options.fingerprint ?? hash(`fingerprint-${id}`), boundary,
  ]);
  return id;
}

async function rollbackProbe(run: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  await client.query("BEGIN");
  try { await run(client); } finally { await client.query("ROLLBACK"); client.release(); }
}

async function expectDatabaseError(client: PoolClient, operation: () => Promise<unknown>, code: string): Promise<void> {
  const savepoint = `feedback_probe_${Math.random().toString(16).slice(2)}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try { await expect(operation()).rejects.toMatchObject({ code }); }
  finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

dbDescribe("applied Task 3.8 OpportunityFeedback database invariants", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for explicitly enabled feedback integration tests");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    prisma = new PrismaService(process.env.DATABASE_URL);
    feedbackService = new OpportunityFeedbackService(prisma);
    const client = await pool.connect();
    try {
      const collision = await client.query(`SELECT
        (SELECT count(*)::int FROM public."User" WHERE "id"=ANY($1::uuid[])) AS users,
        (SELECT count(*)::int FROM public."Project" WHERE "id"=ANY($2::uuid[])) AS projects,
        (SELECT count(*)::int FROM public."ContentOpportunity" WHERE "id"=ANY($3::uuid[])) AS opportunities,
        (SELECT count(*)::int FROM public."OpportunityFeedback" WHERE "userId"=ANY($1::uuid[]) OR "opportunityId"=ANY($3::uuid[])) AS feedback`,
      [[ids.user1, ids.user2], [ids.project1, ids.project2, ids.project3], [ids.opportunity1, ids.opportunity2, ids.opportunity3, ids.opportunity4, ids.opportunity5]]);
      if (Object.values(collision.rows[0] as Record<string, number>).some((count) => count !== 0)) {
        throw new Error("Synthetic Task 3.8 database fixture IDs already exist; refusing to modify pre-existing rows.");
      }
      try {
        await seed(client);
        fixtureSeeded = true;
      } catch (error) {
        await cleanup(client);
        throw error;
      }
    } finally { client.release(); }
  }, 30_000);

  afterAll(async () => {
    if (!pool) return;
    if (!fixtureSeeded) {
      await prisma?.onModuleDestroy();
      await pool.end();
      return;
    }
    const client = await pool.connect();
    try {
      await cleanup(client);
      const result = await client.query(`SELECT
        (SELECT count(*)::int FROM public."User" WHERE "id"=ANY($1::uuid[])) AS users,
        (SELECT count(*)::int FROM public."Project" WHERE "id"=ANY($2::uuid[])) AS projects,
        (SELECT count(*)::int FROM public."ContentOpportunity" WHERE "id"=ANY($3::uuid[])) AS opportunities,
        (SELECT count(*)::int FROM public."OpportunityFeedback" WHERE "userId"=ANY($1::uuid[]) OR "opportunityId"=ANY($3::uuid[])) AS feedback`,
      [[ids.user1, ids.user2], [ids.project1, ids.project2, ids.project3], [ids.opportunity1, ids.opportunity2, ids.opportunity3, ids.opportunity4, ids.opportunity5]]);
      expect(result.rows[0]).toEqual({ users: 0, projects: 0, opportunities: 0, feedback: 0 });
    } finally { client.release(); await pool.end(); }
    await prisma?.onModuleDestroy();
  }, 30_000);

  it("enforces action/reason, current state, and hash checks", async () => rollbackProbe(async (client) => {
    await expectDatabaseError(client, () => insertFeedback(client, { action: "accepted", reason: "other" }), "23514");
    await expectDatabaseError(client, () => insertFeedback(client, { action: "invalid-action" }), "22P02");
    await expectDatabaseError(client, () => insertFeedback(client, { action: "dismissed", reason: "unapproved" }), "22P02");
    await expectDatabaseError(client, () => insertFeedback(client, { current: false, supersededAt: boundary }), "23514");
    await expectDatabaseError(client, () => insertFeedback(client, { current: true, supersededAt: boundary }), "23514");
    await expectDatabaseError(client, () => insertFeedback(client, { current: false, supersededAt: null }), "23514");
    await expectDatabaseError(client, () => insertFeedback(client, { keyHash: "not-a-hash" }), "23514");
    await expectDatabaseError(client, () => insertFeedback(client, { keyHash: "A".repeat(64) }), "23514");
    await expectDatabaseError(client, () => insertFeedback(client, { fingerprint: "not-a-hash" }), "23514");
    await expectDatabaseError(client, () => insertFeedback(client, { fingerprint: "F".repeat(64) }), "23514");

    let currentId: string | undefined;
    for (const reason of [null, "not_relevant", "repetitive", "too_minor", "sensitive", "other"]) {
      if (currentId) {
        await client.query('UPDATE public."OpportunityFeedback" SET "isCurrent"=false,"supersededAt"=$1 WHERE "id"=$2', [boundary, currentId]);
      }
      currentId = await insertFeedback(client, { action: "dismissed", reason });
    }
    const accepted = await insertFeedback(client, { action: "accepted", reason: null, opportunityId: ids.opportunity3 });
    expect(accepted).toBeTruthy();
  }));

  it("enforces one current row and user-wide idempotency uniqueness", async () => rollbackProbe(async (client) => {
    const keyHash = hash("same-user-idem-key");
    await insertFeedback(client, { keyHash });
    await expectDatabaseError(client, () => insertFeedback(client, { keyHash }), "23505");
    await expectDatabaseError(client, () => insertFeedback(client, { opportunityId: ids.opportunity3, keyHash }), "23505");
    await expectDatabaseError(client, () => insertFeedback(client, { keyHash: hash("other-key") }), "23505");
    const all = await client.query('SELECT count(*)::int AS count FROM public."OpportunityFeedback" WHERE "userId"=$1 AND "opportunityId"=$2', [ids.user1, ids.opportunity1]);
    expect(all.rows[0].count).toBe(1);
  }));

  it("enforces same owner for feedback and Project ownership changes", async () => rollbackProbe(async (client) => {
    await expectDatabaseError(client, () => insertFeedback(client, { opportunityId: ids.opportunity2, userId: ids.user1 }), "23514");
    const feedbackId = await insertFeedback(client);
    await expectDatabaseError(client, () => client.query('UPDATE public."Project" SET "userId"=$1 WHERE "id"=$2', [ids.user2, ids.project1]), "23514");
    const check = await client.query('SELECT "userId" FROM public."OpportunityFeedback" WHERE "id"=$1', [feedbackId]);
    expect(check.rows[0].userId).toBe(ids.user1);
  }));

  it("allows only current-to-historical supersession and preserves semantic fields", async () => rollbackProbe(async (client) => {
    const feedbackId = await insertFeedback(client, { action: "dismissed", reason: "repetitive" });
    await client.query('UPDATE public."OpportunityFeedback" SET "isCurrent"=false,"supersededAt"=$1 WHERE "id"=$2', [boundary, feedbackId]);
    await expectDatabaseError(client, () => client.query('UPDATE public."OpportunityFeedback" SET "isCurrent"=true,"supersededAt"=NULL WHERE "id"=$1', [feedbackId]), "55000");
    await expectDatabaseError(client, () => client.query('UPDATE public."OpportunityFeedback" SET "supersededAt"=$1 WHERE "id"=$2', [new Date(boundary.getTime() + 1), feedbackId]), "55000");
    await expectDatabaseError(client, () => client.query('UPDATE public."OpportunityFeedback" SET "userId"=$1,"opportunityId"=$2 WHERE "id"=$3', [ids.user2, ids.opportunity2, feedbackId]), "55000");
    await expectDatabaseError(client, () => client.query('UPDATE public."OpportunityFeedback" SET "opportunityId"=$1 WHERE "id"=$2', [ids.opportunity3, feedbackId]), "55000");
    await expectDatabaseError(client, () => client.query('UPDATE public."OpportunityFeedback" SET "action"=$1::"OpportunityFeedbackAction" WHERE "id"=$2', ["accepted", feedbackId]), "55000");
    await expectDatabaseError(client, () => client.query(`UPDATE public."OpportunityFeedback" SET "reason"='sensitive' WHERE "id"=$1`, [feedbackId]), "55000");
    await expectDatabaseError(client, () => client.query('UPDATE public."OpportunityFeedback" SET "idempotencyKeyHash"=$1 WHERE "id"=$2', [hash("changed-key"), feedbackId]), "55000");
    await expectDatabaseError(client, () => client.query('UPDATE public."OpportunityFeedback" SET "requestFingerprint"=$1 WHERE "id"=$2', [hash("changed-fingerprint"), feedbackId]), "55000");
    await expectDatabaseError(client, () => client.query('UPDATE public."OpportunityFeedback" SET "createdAt"=$1 WHERE "id"=$2', [new Date(boundary.getTime() + 1), feedbackId]), "55000");
    const row = await client.query('SELECT "action","reason","isCurrent","supersededAt" FROM public."OpportunityFeedback" WHERE "id"=$1', [feedbackId]);
    expect(row.rows[0]).toMatchObject({ action: "dismissed", reason: "repetitive", isCurrent: false, supersededAt: boundary });
  }));

  it("keeps history append-only while Project and User deletions cascade", async () => rollbackProbe(async (client) => {
    const opportunityFeedbackId = await insertFeedback(client, { opportunityId: ids.opportunity3 });
    await client.query('DELETE FROM public."ContentOpportunity" WHERE "id"=$1', [ids.opportunity3]);
    const afterOpportunity = await client.query('SELECT count(*)::int AS count FROM public."OpportunityFeedback" WHERE "id"=$1', [opportunityFeedbackId]);
    expect(afterOpportunity.rows[0].count).toBe(0);

    await insertFeedback(client, { opportunityId: ids.opportunity2, userId: ids.user2 });
    const owned = await client.query('SELECT count(*)::int AS count FROM public."OpportunityFeedback" WHERE "userId"=$1', [ids.user2]);
    expect(owned.rows[0].count).toBe(1);
    await client.query('DELETE FROM public."Project" WHERE "id"=$1', [ids.project2]);
    const afterProject = await client.query('SELECT count(*)::int AS count FROM public."OpportunityFeedback" WHERE "userId"=$1', [ids.user2]);
    expect(afterProject.rows[0].count).toBe(0);
    const feedbackId = await insertFeedback(client);
    await expectDatabaseError(client, () => client.query('DELETE FROM public."OpportunityFeedback" WHERE "id"=$1', [feedbackId]), "55000");
    await client.query('DELETE FROM public."User" WHERE "id"=$1', [ids.user1]);
    const afterUser = await client.query('SELECT count(*)::int AS count FROM public."OpportunityFeedback" WHERE "userId"=$1', [ids.user1]);
    expect(afterUser.rows[0].count).toBe(0);
  }));

  it("enables RLS, owner-selects only own rows, and denies authenticated direct writes", async () => rollbackProbe(async (client) => {
    await insertFeedback(client);
    await insertFeedback(client, { opportunityId: ids.opportunity2, userId: ids.user2 });
    const rls = await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid='public."OpportunityFeedback"'::regclass`);
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const policy = await client.query(`SELECT count(*)::int AS count FROM pg_policies
      WHERE schemaname='public' AND tablename='OpportunityFeedback' AND policyname='opportunity_feedback_select_own'
        AND cmd='SELECT' AND 'authenticated'=ANY(roles)`);
    expect(policy.rows[0].count).toBe(1);
    const grants = await client.query("SELECT has_table_privilege('authenticated',(SELECT oid FROM pg_class WHERE relname='OpportunityFeedback' AND relnamespace='public'::regnamespace),'SELECT') AS can_select, has_table_privilege('authenticated',(SELECT oid FROM pg_class WHERE relname='OpportunityFeedback' AND relnamespace='public'::regnamespace),'INSERT') AS can_insert, has_table_privilege('authenticated',(SELECT oid FROM pg_class WHERE relname='OpportunityFeedback' AND relnamespace='public'::regnamespace),'UPDATE') AS can_update, has_table_privilege('authenticated',(SELECT oid FROM pg_class WHERE relname='OpportunityFeedback' AND relnamespace='public'::regnamespace),'DELETE') AS can_delete");
    expect(grants.rows[0]).toEqual({ can_select: true, can_insert: false, can_update: false, can_delete: false });
    await client.query("SAVEPOINT authenticated_probe");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [ids.user1]);
    const visible = await client.query('SELECT "userId" FROM public."OpportunityFeedback"');
    expect(visible.rows.map((row) => row.userId)).toEqual([ids.user1]);
    await expectDatabaseError(client, () => insertFeedback(client), "42501");
    await expectDatabaseError(client, () => client.query('UPDATE public."OpportunityFeedback" SET "isCurrent"=false WHERE "userId"=$1', [ids.user1]), "42501");
    await expectDatabaseError(client, () => client.query('DELETE FROM public."OpportunityFeedback" WHERE "userId"=$1', [ids.user1]), "42501");
    await client.query("ROLLBACK TO SAVEPOINT authenticated_probe");
    await client.query("RELEASE SAVEPOINT authenticated_probe");
  }));

  it("serializes concurrent same-key service requests into one persisted result", async () => {
    const service = feedbackService;
    if (!service) throw new Error("Feedback service was not initialized");
    const key = "task38-db-concurrent-same-key";
    const results = await Promise.all([
      service.record(ids.user1, ids.project1, ids.opportunity1, { action: "accepted" }, key),
      service.record(ids.user1, ids.project1, ids.opportunity1, { action: "accepted" }, key),
    ]);
    expect(results[0]?.id).toBe(results[1]?.id);
    const persisted = await pool.query('SELECT "id" FROM public."OpportunityFeedback" WHERE "userId"=$1 AND "idempotencyKeyHash"=$2',
      [ids.user1, hash(key)]);
    expect(persisted.rows).toHaveLength(1);
  }, 30_000);

  it("retains both different-key concurrent decisions with exactly one current result", async () => {
    const service = feedbackService;
    if (!service) throw new Error("Feedback service was not initialized");
    const before = await pool.query('SELECT "status","shouldPost","isCurrent","priorityScore","noveltyScore","confidence","topicKey","candidateKey","scoringVersion" FROM public."ContentOpportunity" WHERE "id"=$1',
      [ids.opportunity1]);
    const results = await Promise.all([
      service.record(ids.user1, ids.project1, ids.opportunity1, { action: "accepted" }, "task38-db-concurrent-accept"),
      service.record(ids.user1, ids.project1, ids.opportunity1, { action: "dismissed", reason: "repetitive" }, "task38-db-concurrent-dismiss"),
    ]);
    const persisted = await pool.query('SELECT "id","action","isCurrent","supersededAt" FROM public."OpportunityFeedback" WHERE "userId"=$1 AND "opportunityId"=$2 AND "id"=ANY($3::uuid[]) ORDER BY "id"',
      [ids.user1, ids.opportunity1, results.map((result) => result.id)]);
    expect(persisted.rows).toHaveLength(2);
    expect(persisted.rows.filter((row) => row.isCurrent)).toHaveLength(1);
    expect(persisted.rows.filter((row) => !row.isCurrent && row.supersededAt !== null)).toHaveLength(1);
    expect(persisted.rows.map((row) => row.action).sort()).toEqual(["accepted", "dismissed"]);
    const after = await pool.query('SELECT "status","shouldPost","isCurrent","priorityScore","noveltyScore","confidence","topicKey","candidateKey","scoringVersion" FROM public."ContentOpportunity" WHERE "id"=$1',
      [ids.opportunity1]);
    expect(after.rows).toEqual(before.rows);
  }, 30_000);

  it("keeps a concurrent read-model snapshot consistent while a decision is replaced", async () => {
    const service = feedbackService;
    const db = prisma;
    if (!service || !db) throw new Error("Feedback persistence was not initialized");
    const read = await db.$transaction(async (transaction) => {
      const snapshotRead = () => transaction.contentOpportunity.findMany({
        where: { id: ids.opportunity1, projectId: ids.project1 },
        select: {
          feedback: {
            where: { userId: ids.user1, isCurrent: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 2,
            select: { id: true, action: true, reason: true, createdAt: true, isCurrent: true },
          },
        },
      });
      const before = await snapshotRead();
      const replacement = await service.record(
        ids.user1, ids.project1, ids.opportunity1, { action: "dismissed", reason: "too_minor" }, "task38-db-snapshot-replacement",
      );
      const after = await snapshotRead();
      return { before, after, replacement };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    expect(read.before).toHaveLength(1);
    expect(read.before[0]?.feedback).toHaveLength(1);
    expect(read.after).toEqual(read.before);
    expect(read.replacement.isCurrent).toBe(true);
    const committed = await pool.query('SELECT "id","action","isCurrent" FROM public."OpportunityFeedback" WHERE "userId"=$1 AND "opportunityId"=$2 AND "isCurrent"=true',
      [ids.user1, ids.opportunity1]);
    expect(committed.rows).toHaveLength(1);
    expect(committed.rows[0]?.id).toBe(read.replacement.id);
    expect(committed.rows[0]?.action).toBe("dismissed");
    const foreign = await db.contentOpportunity.findMany({
      where: { id: ids.opportunity1, projectId: ids.project1 },
      select: { feedback: { where: { userId: ids.user2, isCurrent: true }, take: 2, select: { id: true } } },
    });
    expect(foreign[0]?.feedback).toEqual([]);
    const replacement = await db.contentOpportunity.findMany({
      where: { id: ids.opportunity4, projectId: ids.project1 },
      select: { feedback: { where: { userId: ids.user1, isCurrent: true }, take: 2, select: { id: true } } },
    });
    expect(replacement[0]?.feedback).toEqual([]);
  }, 30_000);

  it("enforces live idempotency scope, exact replay, conflicts, and hash-only storage", async () => {
    const service = feedbackService;
    if (!service) throw new Error("Feedback service was not initialized");
    const rawKey = "task38-live-raw-key-must-not-persist";
    const first = await service.record(ids.user1, ids.project3, ids.opportunity3, { action: "accepted" }, rawKey);
    const stored = await pool.query('SELECT "id","action","reason","isCurrent","idempotencyKeyHash","requestFingerprint","createdAt" FROM public."OpportunityFeedback" WHERE "userId"=$1 AND "idempotencyKeyHash"=$2',
      [ids.user1, hash(rawKey)]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({ id: first.id, action: "accepted", reason: null, isCurrent: true, idempotencyKeyHash: hash(rawKey) });
    expect(stored.rows[0].requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored.rows)).not.toContain(rawKey);
    const replay = await service.record(ids.user1, ids.project3, ids.opportunity3, { action: "accepted" }, rawKey);
    expect(replay.id).toBe(first.id);
    expect(await pool.query('SELECT "id","action","reason","isCurrent","idempotencyKeyHash","requestFingerprint","createdAt" FROM public."OpportunityFeedback" WHERE "userId"=$1 AND "idempotencyKeyHash"=$2',
      [ids.user1, hash(rawKey)])).toMatchObject({ rows: stored.rows });

    const expectConflictWithoutMutation = async (key: string, request: () => Promise<unknown>) => {
      const before = await pool.query('SELECT * FROM public."OpportunityFeedback" WHERE "userId"=$1 AND "idempotencyKeyHash"=$2',
        [ids.user1, hash(key)]);
      expect(before.rows).toHaveLength(1);
      await expect(request()).rejects.toMatchObject({
        status: 409, response: expect.objectContaining({ code: "FEEDBACK_IDEMPOTENCY_CONFLICT" }),
      });
      const after = await pool.query('SELECT * FROM public."OpportunityFeedback" WHERE "userId"=$1 AND "idempotencyKeyHash"=$2',
        [ids.user1, hash(key)]);
      expect(after.rows).toEqual(before.rows);
    };

    await expectConflictWithoutMutation(rawKey, () =>
      service.record(ids.user1, ids.project3, ids.opportunity3, { action: "dismissed" }, rawKey));

    const reasonKey = "task38-live-reason-conflict";
    await service.record(ids.user1, ids.project3, ids.opportunity3, { action: "dismissed", reason: "repetitive" }, reasonKey);
    await expectConflictWithoutMutation(reasonKey, () =>
      service.record(ids.user1, ids.project3, ids.opportunity3, { action: "dismissed", reason: "sensitive" }, reasonKey));

    const opportunityKey = "task38-live-opportunity-conflict";
    await service.record(ids.user1, ids.project1, ids.opportunity1, { action: "accepted" }, opportunityKey);
    await expectConflictWithoutMutation(opportunityKey, () =>
      service.record(ids.user1, ids.project1, ids.opportunity4, { action: "accepted" }, opportunityKey));

    const projectKey = "task38-live-project-conflict";
    await service.record(ids.user1, ids.project1, ids.opportunity1, { action: "accepted" }, projectKey);
    await expectConflictWithoutMutation(projectKey, () =>
      service.record(ids.user1, ids.project3, ids.opportunity3, { action: "accepted" }, projectKey));
  }, 30_000);

  it("enforces owner, exact-project, and actionability predicates against live rows", async () => {
    const service = feedbackService;
    if (!service) throw new Error("Feedback service was not initialized");
    await expect(service.record(ids.user1, ids.project2, ids.opportunity2, { action: "accepted" }, "task38-live-foreign-project"))
      .rejects.toMatchObject({ status: 404 });
    await expect(service.record(ids.user1, ids.project1, ids.opportunity2, { action: "accepted" }, "task38-live-wrong-project"))
      .rejects.toMatchObject({ status: 404 });
    await expect(service.record(ids.user1, ids.project1, "f3800000-0000-4000-8000-000000000299", { action: "accepted" }, "task38-live-missing-opportunity"))
      .rejects.toMatchObject({ status: 404 });
    await expect(service.record(ids.user1, ids.project3, ids.opportunity4, { action: "accepted" }, "task38-live-other-owned-project"))
      .rejects.toMatchObject({ status: 404 });

    const suppressed = await pool.query('SELECT "status","shouldPost","isCurrent","expiredAt" FROM public."ContentOpportunity" WHERE "id"=$1',
      [ids.opportunity5]);
    expect(suppressed.rows[0]).toMatchObject({ status: "suppressed", shouldPost: false, isCurrent: true, expiredAt: null });
    await expect(service.record(ids.user1, ids.project1, ids.opportunity5, { action: "accepted" }, "task38-live-suppressed"))
      .rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: "FEEDBACK_NOT_ACTIONABLE" }) });

    const initial = await pool.query('SELECT "status","shouldPost","isCurrent","expiredAt" FROM public."ContentOpportunity" WHERE "id"=$1',
      [ids.opportunity4]);
    const row = initial.rows[0] as { status: string; shouldPost: boolean; isCurrent: boolean; expiredAt: Date | null };
    try {
      await pool.query('UPDATE public."ContentOpportunity" SET "status"=$2::"ContentOpportunityStatus","isCurrent"=false,"expiredAt"=$3 WHERE "id"=$1',
        [ids.opportunity4, "expired", boundary]);
      await expect(service.record(ids.user1, ids.project1, ids.opportunity4, { action: "accepted" }, "task38-live-expired"))
        .rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: "FEEDBACK_NOT_ACTIONABLE" }) });
    } finally {
      await pool.query('UPDATE public."ContentOpportunity" SET "status"=$2::"ContentOpportunityStatus","isCurrent"=$3,"expiredAt"=$4 WHERE "id"=$1',
        [ids.opportunity4, row.status, row.isCurrent, row.expiredAt]);
    }
  }, 30_000);

  it("retains accept/dismiss/re-accept and dismissal-reason changes as ordered audit history", async () => {
    const service = feedbackService;
    if (!service) throw new Error("Feedback service was not initialized");
    const keys = [
      "task38-live-history-accept-1",
      "task38-live-history-dismiss-repetitive",
      "task38-live-history-accept-2",
      "task38-live-history-dismiss-repetitive-2",
      "task38-live-history-dismiss-sensitive",
    ];
    const results = [
      await service.record(ids.user2, ids.project2, ids.opportunity2, { action: "accepted" }, keys[0]!),
      await service.record(ids.user2, ids.project2, ids.opportunity2, { action: "dismissed", reason: "repetitive" }, keys[1]!),
      await service.record(ids.user2, ids.project2, ids.opportunity2, { action: "accepted" }, keys[2]!),
      await service.record(ids.user2, ids.project2, ids.opportunity2, { action: "dismissed", reason: "repetitive" }, keys[3]!),
      await service.record(ids.user2, ids.project2, ids.opportunity2, { action: "dismissed", reason: "sensitive" }, keys[4]!),
    ];
    const rows = await pool.query('SELECT "id","action","reason","isCurrent","supersededAt","idempotencyKeyHash","requestFingerprint","createdAt" FROM public."OpportunityFeedback" WHERE "id"=ANY($1::uuid[])',
      [results.map((result) => result.id)]);
    expect(rows.rows).toHaveLength(5);
    const byId = new Map(rows.rows.map((row) => [row.id as string, row]));
    const expected = [
      ["accepted", null], ["dismissed", "repetitive"], ["accepted", null],
      ["dismissed", "repetitive"], ["dismissed", "sensitive"],
    ];
    for (const [index, result] of results.entries()) {
      const row = byId.get(result.id);
      expect(row).toMatchObject({
        action: expected[index]?.[0],
        reason: expected[index]?.[1],
        isCurrent: index === 4,
        idempotencyKeyHash: hash(keys[index]!),
      });
      expect(row?.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect((row?.createdAt as Date).toISOString()).toBe(result.createdAt);
      if (index < 4) {
        expect(row?.supersededAt).toBeInstanceOf(Date);
        expect((row?.supersededAt as Date).getTime()).toBeGreaterThanOrEqual((row?.createdAt as Date).getTime());
      } else {
        expect(row?.supersededAt).toBeNull();
      }
    }
    expect(rows.rows.filter((row) => row.isCurrent).map((row) => row.id)).toEqual([results[4]?.id]);
  }, 30_000);

  it("replays the original request after expiry, rejects a new key, and retains its feedback row", async () => {
    const service = feedbackService;
    if (!service) throw new Error("Feedback service was not initialized");
    const key = "task38-live-replay-after-expiry";
    const first = await service.record(ids.user1, ids.project1, ids.opportunity4, { action: "accepted" }, key);
    const initial = await pool.query('SELECT "status","shouldPost","isCurrent","expiredAt" FROM public."ContentOpportunity" WHERE "id"=$1',
      [ids.opportunity4]);
    const row = initial.rows[0] as { status: string; shouldPost: boolean; isCurrent: boolean; expiredAt: Date | null };
    try {
      await pool.query('UPDATE public."ContentOpportunity" SET "status"=$2::"ContentOpportunityStatus","isCurrent"=false,"expiredAt"=$3 WHERE "id"=$1',
        [ids.opportunity4, "expired", boundary]);
      const replay = await service.record(ids.user1, ids.project1, ids.opportunity4, { action: "accepted" }, key);
      expect(replay.id).toBe(first.id);
      expect(replay.isCurrent).toBe(true);
      await expect(service.record(ids.user1, ids.project1, ids.opportunity4, { action: "accepted" }, "task38-live-new-key-after-expiry"))
        .rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: "FEEDBACK_NOT_ACTIONABLE" }) });
      const persisted = await pool.query('SELECT count(*)::int AS count FROM public."OpportunityFeedback" WHERE "idempotencyKeyHash"=$1',
        [hash(key)]);
      expect(persisted.rows[0].count).toBe(1);
    } finally {
      await pool.query('UPDATE public."ContentOpportunity" SET "status"=$2::"ContentOpportunityStatus","isCurrent"=$3,"expiredAt"=$4 WHERE "id"=$1',
        [ids.opportunity4, row.status, row.isCurrent, row.expiredAt]);
    }
  }, 30_000);
});
