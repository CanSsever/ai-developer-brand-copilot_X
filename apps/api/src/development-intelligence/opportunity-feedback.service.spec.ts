import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../database/prisma.service";
import {
  opportunityFeedbackContractVersion,
  opportunityFeedbackTransactionAttempts,
  OpportunityFeedbackService,
  parseOpportunityFeedbackRequest,
  opportunityFeedbackIdempotencyHash,
  opportunityFeedbackRequestFingerprint,
  validateOpportunityFeedbackIdempotencyKey,
} from "./opportunity-feedback.service";

const userId = "123e4567-e89b-42d3-a456-426614174000";
const projectId = "323e4567-e89b-42d3-a456-426614174000";
const otherProjectId = "423e4567-e89b-42d3-a456-426614174000";
const opportunityId = "523e4567-e89b-42d3-a456-426614174000";
const otherOpportunityId = "623e4567-e89b-42d3-a456-426614174000";
const thirdOpportunityId = "723e4567-e89b-42d3-a456-426614174000";
const rawKey = "task-38-safe-retry-key";

interface FeedbackRow {
  id: string;
  userId: string;
  opportunityId: string;
  action: "accepted" | "dismissed";
  reason: "not_relevant" | "repetitive" | "too_minor" | "sensitive" | "other" | null;
  isCurrent: boolean;
  supersededAt: Date | null;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  createdAt: Date;
}

function harness() {
  const rows: FeedbackRow[] = [];
  const opportunityProjects = new Map([
    [opportunityId, projectId],
    [otherOpportunityId, otherProjectId],
    [thirdOpportunityId, projectId],
  ]);
  const projectFindFirst = vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
    where.userId === userId && [projectId, otherProjectId].includes(where.id) ? { id: where.id } : null);
  let actionable = true;
  let projectLockExists = true;
  const actionableFindFirst = vi.fn(async ({ where }: { where: { id: string; projectId: string } }) =>
    actionable && opportunityProjects.get(where.id) === where.projectId ? { id: where.id } : null);
  const feedbackFindFirst = vi.fn(async ({ where }: { where: { userId: string; idempotencyKeyHash: string } }) =>
    rows.find((row) => row.userId === where.userId && row.idempotencyKeyHash === where.idempotencyKeyHash) ?? null);
  const feedbackFindMany = vi.fn(async ({ where }: { where: { userId: string; opportunityId: string; isCurrent: boolean } }) =>
    rows.filter((row) => row.userId === where.userId && row.opportunityId === where.opportunityId && row.isCurrent)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, 2).map(({ id }) => ({ id })));
  let nextId = 0;
  const feedbackUpdateMany = vi.fn(async ({ where, data }: { where: { id: string }; data: { isCurrent: false; supersededAt: Date } }) => {
    const row = rows.find((candidate) => candidate.id === where.id && candidate.isCurrent);
    if (!row) return { count: 0 };
    row.isCurrent = data.isCurrent;
    row.supersededAt = data.supersededAt;
    return { count: 1 };
  });
  const feedbackCreate = vi.fn(async ({ data }: { data: Omit<FeedbackRow, "id" | "createdAt" | "supersededAt"> }) => {
    if (rows.some((row) => row.userId === data.userId && row.idempotencyKeyHash === data.idempotencyKeyHash)) {
      throw Object.assign(new Error("unique"), { code: "P2002" });
    }
    const row: FeedbackRow = {
      ...data,
      id: `feedback-${++nextId}`,
      createdAt: new Date(`2026-09-25T10:00:0${nextId}.000Z`),
      supersededAt: null,
    };
    rows.push(row);
    return row;
  });

  let transactionTail = Promise.resolve();
  const transaction = {
    project: { findFirst: projectFindFirst },
    contentOpportunity: { findFirst: actionableFindFirst },
    opportunityFeedback: {
      findFirst: feedbackFindFirst,
      findMany: feedbackFindMany,
      updateMany: feedbackUpdateMany,
      create: feedbackCreate,
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(" ");
      if (sql.includes('FROM public."Project"')) {
        return projectLockExists ? [{ id: String(values[0]) }] : [];
      }
      if (sql.includes('FROM public."ContentOpportunity"')) {
        const targetOpportunity = String(values[0]);
        const targetProject = String(values[1]);
        return opportunityProjects.get(targetOpportunity) === targetProject ? [{ id: targetOpportunity }] : [];
      }
      return [{ id: String(values[0]) }];
    }),
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await callback(transaction); } finally { release(); }
    }),
    opportunityFeedback: { findFirst: feedbackFindFirst },
  };
  const service = new OpportunityFeedbackService(prisma as unknown as PrismaService);
  return {
    actionableFindFirst,
    setActionable: (value: boolean) => { actionable = value; },
    setProjectLockExists: (value: boolean) => { projectLockExists = value; },
    feedbackCreate, feedbackFindFirst, feedbackUpdateMany, prisma, projectFindFirst, rows, service, transaction,
  };
}

describe("OpportunityFeedback validation and identity", () => {
  it("accepts only the exact action/reason taxonomy and normalizes absent reason", () => {
    expect(parseOpportunityFeedbackRequest({ action: "accepted" })).toEqual({ action: "accepted", reason: null });
    expect(parseOpportunityFeedbackRequest({ action: "dismissed" })).toEqual({ action: "dismissed", reason: null });
    for (const reason of ["not_relevant", "repetitive", "too_minor", "sensitive", "other"] as const) {
      expect(parseOpportunityFeedbackRequest({ action: "dismissed", reason })).toEqual({ action: "dismissed", reason });
    }
  });

  it.each([
    ["unknown action", { action: "ignored" }],
    ["unknown reason", { action: "dismissed", reason: "free text" }],
    ["accepted with a reason", { action: "accepted", reason: "other" }],
    ["extra fields", { action: "accepted", projectId }],
    ["array body", []],
  ])("rejects %s", (_label, body) => {
    expect(() => parseOpportunityFeedbackRequest(body)).toThrow(BadRequestException);
  });

  it("bounds idempotency keys, rejects controls and hashes without retaining the raw key", () => {
    expect(validateOpportunityFeedbackIdempotencyKey(rawKey)).toBe(rawKey);
    expect(() => validateOpportunityFeedbackIdempotencyKey(undefined)).toThrow(BadRequestException);
    expect(() => validateOpportunityFeedbackIdempotencyKey(" " + String.fromCharCode(9) + " ")).toThrow(BadRequestException);
    expect(() => validateOpportunityFeedbackIdempotencyKey("line" + String.fromCharCode(10) + "break")).toThrow(BadRequestException);
    expect(() => validateOpportunityFeedbackIdempotencyKey("k".repeat(129))).toThrow(BadRequestException);
    expect(opportunityFeedbackIdempotencyHash(rawKey)).toBe(createHash("sha256").update(rawKey).digest("hex"));
    expect(opportunityFeedbackIdempotencyHash(rawKey)).not.toContain(rawKey);
  });

  it("versions canonical semantic fingerprints and excludes the idempotency key", () => {
    const request = { action: "dismissed" as const, reason: "repetitive" as const };
    const first = opportunityFeedbackRequestFingerprint(userId, projectId, opportunityId, request);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(opportunityFeedbackRequestFingerprint(userId.toUpperCase(), projectId.toUpperCase(), opportunityId.toUpperCase(), request));
    expect(first).not.toBe(opportunityFeedbackRequestFingerprint(userId, projectId, opportunityId, { ...request, reason: "sensitive" }));
    expect(opportunityFeedbackContractVersion).toBe("phase3-opportunity-feedback-v1");
  });
});

describe("OpportunityFeedbackService", () => {
  let test: ReturnType<typeof harness>;
  beforeEach(() => { test = harness(); });

  it.each([
    ["accepted", { action: "accepted" as const }],
    ["dismissed", { action: "dismissed" as const, reason: "repetitive" as const }],
  ])("records an owner-scoped actionable %s decision with only a key hash", async (_label, request) => {
    const result = await test.service.record(userId, projectId, opportunityId, request, rawKey);
    expect(result).toMatchObject({ opportunityId, action: request.action, isCurrent: true });
    expect(test.projectFindFirst).toHaveBeenCalledWith({ where: { id: projectId, userId }, select: { id: true } });
    expect(test.actionableFindFirst).toHaveBeenCalledWith({
      where: { id: opportunityId, projectId, isCurrent: true, status: "recommended", shouldPost: true, expiredAt: null },
      select: { id: true },
    });
    expect(test.rows).toHaveLength(1);
    expect(test.rows[0]?.idempotencyKeyHash).toBe(opportunityFeedbackIdempotencyHash(rawKey));
    expect(JSON.stringify(test.rows)).not.toContain(rawKey);
  });

  it("uses safe not-found for foreign Projects, nonexistent Projects, and mismatched opportunity ownership", async () => {
    await expect(test.service.record("923e4567-e89b-42d3-a456-426614174000", projectId, opportunityId, { action: "accepted" }, rawKey))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(test.prisma.$transaction).toHaveBeenCalledTimes(1);
    await expect(test.service.record(userId, "923e4567-e89b-42d3-a456-426614174000", opportunityId, { action: "accepted" }, "another-key"))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(test.service.record(userId, otherProjectId, opportunityId, { action: "accepted" }, "mismatch-key"))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(test.actionableFindFirst).not.toHaveBeenCalled();
  });

  it("does not create feedback for a stale/suppressed/non-current/no-post opportunity", async () => {
    test.setActionable(false);
    await expect(test.service.record(userId, projectId, opportunityId, { action: "accepted" }, rawKey))
      .rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: "FEEDBACK_NOT_ACTIONABLE" }) });
    expect(test.feedbackCreate).not.toHaveBeenCalled();
  });

  it("fails closed if Project ownership changes between lookup and lock acquisition", async () => {
    test.setProjectLockExists(false);
    await expect(test.service.record(userId, projectId, opportunityId, { action: "accepted" }, rawKey))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(test.actionableFindFirst).not.toHaveBeenCalled();
    expect(test.feedbackCreate).not.toHaveBeenCalled();
  });

  it("retries transient serialization failures within the configured bound", async () => {
    const serializationFailure = Object.assign(new Error("serialization conflict"), { code: "P2034" });
    test.prisma.$transaction.mockRejectedValueOnce(serializationFailure);
    const success = await test.service.record(userId, projectId, opportunityId, { action: "accepted" }, "retry-once");
    expect(success.isCurrent).toBe(true);
    expect(test.prisma.$transaction).toHaveBeenCalledTimes(2);

    const exhausted = harness();
    exhausted.prisma.$transaction.mockRejectedValue(serializationFailure);
    await expect(exhausted.service.record(userId, projectId, opportunityId, { action: "accepted" }, "retry-exhausted"))
      .rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: "FEEDBACK_CONCURRENT_CONFLICT" }) });
    expect(exhausted.prisma.$transaction).toHaveBeenCalledTimes(opportunityFeedbackTransactionAttempts);
    expect(opportunityFeedbackTransactionAttempts).toBe(3);
    expect(exhausted.rows).toHaveLength(0);
  });

  it("returns the original row on exact replay without a second insert or supersession", async () => {
    const first = await test.service.record(userId, projectId, opportunityId, { action: "accepted" }, rawKey);
    const replay = await test.service.record(userId, projectId, opportunityId, { action: "accepted" }, rawKey);
    expect(replay.id).toBe(first.id);
    expect(test.rows).toHaveLength(1);
    expect(test.feedbackCreate).toHaveBeenCalledTimes(1);
    expect(test.feedbackUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["action", projectId, opportunityId, { action: "accepted" as const }, { action: "dismissed" as const }],
    ["reason", projectId, opportunityId, { action: "dismissed" as const, reason: "repetitive" as const }, { action: "dismissed" as const, reason: "sensitive" as const }],
    ["opportunity", projectId, thirdOpportunityId, { action: "accepted" as const }, { action: "accepted" as const }],
    ["project", otherProjectId, otherOpportunityId, { action: "accepted" as const }, { action: "accepted" as const }],
  ] as const)("conflicts when an idempotency key is replayed with a different %s", async (_label, targetProject, targetOpportunity, original, request) => {
    await test.service.record(userId, projectId, opportunityId, original, rawKey);
    await expect(test.service.record(userId, targetProject, targetOpportunity, request, rawKey))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it("replays an exact successful request after expiry but rejects a new key against it", async () => {
    const first = await test.service.record(userId, projectId, opportunityId, { action: "accepted" }, rawKey);
    test.setActionable(false);
    expect(await test.service.record(userId, projectId, opportunityId, { action: "accepted" }, rawKey)).toEqual(first);
    await expect(test.service.record(userId, projectId, opportunityId, { action: "accepted" }, "new-key"))
      .rejects.toBeInstanceOf(ConflictException);
    expect(test.rows).toHaveLength(1);
  });

  it("retains semantic history while changing only supersession metadata", async () => {
    const first = await test.service.record(userId, projectId, opportunityId, { action: "accepted" }, "key-one");
    const firstStored = { ...test.rows[0] };
    const second = await test.service.record(userId, projectId, opportunityId, { action: "dismissed", reason: "repetitive" }, "key-two");
    const secondStored = { ...test.rows[1] };
    const third = await test.service.record(userId, projectId, opportunityId, { action: "accepted" }, "key-three");
    expect([first.id, second.id, third.id]).toEqual(["feedback-1", "feedback-2", "feedback-3"]);
    expect(test.rows.filter((row) => row.isCurrent)).toHaveLength(1);
    expect(test.rows[2]?.isCurrent).toBe(true);
    expect(test.rows[0]).toMatchObject({
      userId: firstStored.userId, opportunityId: firstStored.opportunityId, action: firstStored.action,
      reason: firstStored.reason, idempotencyKeyHash: firstStored.idempotencyKeyHash,
      requestFingerprint: firstStored.requestFingerprint, createdAt: firstStored.createdAt,
    });
    expect(test.rows[1]).toMatchObject({
      userId: secondStored.userId, opportunityId: secondStored.opportunityId, action: secondStored.action,
      reason: secondStored.reason, idempotencyKeyHash: secondStored.idempotencyKeyHash,
      requestFingerprint: secondStored.requestFingerprint, createdAt: secondStored.createdAt,
    });
    expect(test.rows[0]?.supersededAt).toBeInstanceOf(Date);
    expect(test.rows[1]?.supersededAt).toBeInstanceOf(Date);
    expect(test.rows[2]?.supersededAt).toBeNull();
  });

  it("serializes same-key and different-decision races without duplicate current state", async () => {
    const same = await Promise.all([
      test.service.record(userId, projectId, opportunityId, { action: "accepted" }, "race-same"),
      test.service.record(userId, projectId, opportunityId, { action: "accepted" }, "race-same"),
    ]);
    expect(same[0]?.id).toBe(same[1]?.id);
    expect(test.rows).toHaveLength(1);
    await Promise.all([
      test.service.record(userId, projectId, opportunityId, { action: "accepted" }, "race-a"),
      test.service.record(userId, projectId, opportunityId, { action: "dismissed", reason: "other" }, "race-b"),
    ]);
    expect(test.rows).toHaveLength(3);
    expect(test.rows.filter((row) => row.isCurrent)).toHaveLength(1);
    expect(test.rows.map((row) => row.action).sort()).toEqual(["accepted", "accepted", "dismissed"]);
    const currentAction = test.rows.find((row) => row.isCurrent)?.action;
    expect(["accepted", "dismissed"]).toContain(currentAction);
  });

  it("takes project and opportunity row locks and has no provider/orchestration dependencies", async () => {
    await test.service.record(userId, projectId, opportunityId, { action: "accepted" }, rawKey);
    expect(test.transaction.$queryRaw).toHaveBeenCalledTimes(2);
    const lockSql = test.transaction.$queryRaw.mock.calls.map(([strings]) => strings.join(" ")).join(" ");
    expect(lockSql).toContain('FROM public."Project"');
    expect(lockSql).toContain('FROM public."ContentOpportunity"');
    expect(lockSql.match(/FOR UPDATE/g)).toHaveLength(2);
    expect(test.prisma).not.toHaveProperty("openAI");
    expect(test.prisma).not.toHaveProperty("opportunityRun");
  });
});
