import {
  BadGatewayException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../database/prisma.service";
import {
  GitHubCommitSyncConflictError,
  GitHubCommitSyncError,
  type GitHubCommitSyncService,
} from "./github-commit-sync.service";
import {
  GitHubManualSyncService,
  manualSyncMinimumIntervalMs,
} from "./github-manual-sync.service";

const userId = "123e4567-e89b-42d3-a456-426614174000";
const otherUserId = "223e4567-e89b-42d3-a456-426614174000";
const projectId = "323e4567-e89b-42d3-a456-426614174000";
const repositoryId = "423e4567-e89b-42d3-a456-426614174000";
const syncRunId = "523e4567-e89b-42d3-a456-426614174000";
const now = new Date("2026-09-19T12:00:00.000Z");

function harness() {
  const prisma = {
    connectedRepository: {
      findFirst: vi.fn().mockResolvedValue({ id: repositoryId }),
    },
    syncRun: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  const sync = {
    synchronize: vi.fn().mockImplementation(
      async (
        _connectedRepositoryId: string,
        onQueued?: (id: string) => void
      ) => {
        onQueued?.(syncRunId);
        return {
          attemptCount: 3,
          commitsDiscovered: 1,
          commitsInserted: 1,
          status: "succeeded",
          syncRunId,
          windowEnd: now,
          windowStart: new Date("2026-08-20T12:00:00.000Z"),
        };
      }
    ),
  };
  const service = new GitHubManualSyncService(
    prisma as unknown as PrismaService,
    sync as unknown as GitHubCommitSyncService,
    () => new Date(now)
  );
  return { prisma, service, sync };
}

describe("GitHubManualSyncService", () => {
  it("starts one queued sync for an authenticated owner's repository", async () => {
    const { prisma, service, sync } = harness();

    await expect(service.start(userId, projectId)).resolves.toEqual({
      status: "queued",
      syncRunId,
    });
    expect(prisma.connectedRepository.findFirst).toHaveBeenCalledWith({
      where: {
        projectId,
        status: "active",
        project: { userId },
        gitHubConnection: { userId, status: "active" },
      },
      select: { id: true },
    });
    expect(sync.synchronize).toHaveBeenCalledOnce();
    expect(sync.synchronize.mock.calls[0]?.[0]).toBe(repositoryId);
  });

  it.each([
    ["another user", otherUserId],
    ["an unknown Project", userId],
  ])("returns the same not-found result for %s", async (_label, subject) => {
    const { prisma, service, sync } = harness();
    prisma.connectedRepository.findFirst.mockResolvedValue(null);

    await expect(service.start(subject, projectId)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(sync.synchronize).not.toHaveBeenCalled();
  });

  it("maps an existing queued or running SyncRun to a safe conflict", async () => {
    const { prisma, service, sync } = harness();
    prisma.syncRun.findFirst.mockResolvedValue({
      createdAt: new Date(now.getTime() - 1_000),
      retryAfterAt: null,
      status: "running",
    });

    await expect(service.start(userId, projectId)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(sync.synchronize).not.toHaveBeenCalled();
  });

  it("rate-limits rapid manual retries per owned repository", async () => {
    const { prisma, service, sync } = harness();
    prisma.syncRun.findFirst.mockResolvedValue({
      createdAt: new Date(now.getTime() - manualSyncMinimumIntervalMs + 1),
      retryAfterAt: null,
      status: "succeeded",
    });

    const failure = await service.start(userId, projectId).catch((error) => error);
    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(429);
    expect(sync.synchronize).not.toHaveBeenCalled();
  });

  it("does not retry before a provider retry-after boundary", async () => {
    const { prisma, service, sync } = harness();
    prisma.syncRun.findFirst.mockResolvedValue({
      createdAt: new Date(now.getTime() - manualSyncMinimumIntervalMs),
      retryAfterAt: new Date(now.getTime() + 60_000),
      status: "failed_retryable",
    });

    const failure = await service.start(userId, projectId).catch((error) => error);
    expect((failure as HttpException).getStatus()).toBe(429);
    expect(sync.synchronize).not.toHaveBeenCalled();
  });

  it("maps the active-run database race to a safe conflict", async () => {
    const { service, sync } = harness();
    sync.synchronize.mockRejectedValue(new GitHubCommitSyncConflictError());

    await expect(service.start(userId, projectId)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it("maps a retryable pre-queue failure without provider internals", async () => {
    const { service, sync } = harness();
    sync.synchronize.mockRejectedValue(
      new GitHubCommitSyncError("GITHUB_PROVIDER_UNAVAILABLE", 3)
    );

    await expect(service.start(userId, projectId)).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });

  it("maps a terminal pre-queue provider failure to safe access guidance", async () => {
    const { service, sync } = harness();
    sync.synchronize.mockRejectedValue(
      new GitHubCommitSyncError("GITHUB_AUTHORIZATION_FAILED", 1)
    );

    await expect(service.start(userId, projectId)).rejects.toBeInstanceOf(
      BadGatewayException
    );
  });

  it("returns only a safe queued identifier and never a token or provider payload", async () => {
    const { service } = harness();
    const result = await service.start(userId, projectId);
    const serialized = JSON.stringify(result);

    expect(serialized).toBe(
      `{"status":"queued","syncRunId":"${syncRunId}"}`
    );
    expect(serialized).not.toMatch(/token|authorization|provider|payload/i);
  });
});
