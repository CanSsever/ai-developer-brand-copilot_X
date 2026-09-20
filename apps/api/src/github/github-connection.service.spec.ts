import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../database/prisma.service";
import { GitHubIntegrationError } from "./github-api.service";
import type { GitHubApiService } from "./github-api.service";
import { GitHubConnectionService } from "./github-connection.service";

const userId = "123e4567-e89b-42d3-a456-426614174000";
const otherUserId = "223e4567-e89b-42d3-a456-426614174000";
const projectId = "323e4567-e89b-42d3-a456-426614174000";
const connectionId = "423e4567-e89b-42d3-a456-426614174000";

function harness() {
  const prisma = {
    $transaction: vi.fn().mockResolvedValue([]),
    project: {
      findFirst: vi.fn().mockResolvedValue({ id: projectId }),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    gitHubConnectionAttempt: {
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn(),
    },
    gitHubConnection: {
      delete: vi.fn(),
      findFirst: vi.fn().mockResolvedValue({
        id: connectionId,
        providerInstallationId: 42n,
      }),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    connectedRepository: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
  };
  const github = {
    exchangeUserCode: vi.fn().mockResolvedValue("ephemeral-user-token"),
    verifyInstallationForUser: vi.fn(),
    listInstallationRepositories: vi.fn(),
  };
  const service = new GitHubConnectionService(
    prisma as unknown as PrismaService,
    github as unknown as GitHubApiService,
    {
      callbackUrl: "http://localhost:3000/github/callback",
      clientId: "Iv1.safe-test-client",
      clientSecret: "safe-test-client-secret-value",
      privateKey: "not-used",
      slug: "safe-test-app",
    }
  );

  return { github, prisma, service };
}

describe("GitHubConnectionService", () => {
  it("lists only the authenticated user's Projects with safe repository state", async () => {
    const { prisma, service } = harness();
    prisma.project.findMany.mockResolvedValue([
      {
        id: projectId,
        timezone: "Europe/Berlin",
        connectedRepository: {
          gitHubConnectionId: connectionId,
          owner: "safe-owner",
          name: "safe-repository",
          defaultBranch: "main",
          isPrivate: true,
          status: "active",
          lastSuccessfulSyncAt: null,
          syncRuns: [],
        },
      },
    ]);

    await expect(service.listProjects(userId)).resolves.toEqual([
      {
        id: projectId,
        timezone: "Europe/Berlin",
        connectedRepository: {
          connectionId,
          defaultBranch: "main",
          fullName: "safe-owner/safe-repository",
          isPrivate: true,
          status: "active",
          sync: {
            lastSuccessfulSyncAt: null,
            latestRun: null,
          },
        },
      },
    ]);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId } })
    );
  });

  it("returns only the latest safe SyncRun summary with ISO timestamps", async () => {
    const { prisma, service } = harness();
    prisma.project.findMany.mockResolvedValue([
      {
        id: projectId,
        timezone: "Europe/Berlin",
        connectedRepository: {
          gitHubConnectionId: connectionId,
          owner: "safe-owner",
          name: "safe-repository",
          defaultBranch: "main",
          isPrivate: true,
          status: "active",
          lastSuccessfulSyncAt: new Date("2026-09-19T10:00:00.000Z"),
          syncRuns: [
            {
              id: "523e4567-e89b-42d3-a456-426614174000",
              status: "succeeded",
              startedAt: new Date("2026-09-19T09:59:00.000Z"),
              finishedAt: new Date("2026-09-19T10:00:00.000Z"),
              commitsDiscovered: 4,
              commitsInserted: 3,
              pullRequestsDiscovered: 2,
              pullRequestsInserted: 1,
              attemptCount: 7,
              retryAfterAt: null,
              failureCode: null,
            },
          ],
        },
      },
    ]);

    const result = await service.listProjects(userId);

    expect(result[0]?.connectedRepository?.sync).toEqual({
      lastSuccessfulSyncAt: "2026-09-19T10:00:00.000Z",
      latestRun: {
        syncRunId: "523e4567-e89b-42d3-a456-426614174000",
        status: "succeeded",
        startedAt: "2026-09-19T09:59:00.000Z",
        finishedAt: "2026-09-19T10:00:00.000Z",
        commitsDiscovered: 4,
        commitsInserted: 3,
        pullRequestsDiscovered: 2,
        pullRequestsInserted: 1,
        attemptCount: 7,
        retryAfterAt: null,
        failureCode: null,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /token|authorization|message|filePath|providerPayload/i
    );
  });

  it("creates a Project for the authenticated user with no repository", async () => {
    const { prisma, service } = harness();
    prisma.project.create.mockResolvedValue({
      id: projectId,
      timezone: "Etc/UTC",
    });

    await expect(service.createProject(userId, "Etc/UTC")).resolves.toEqual({
      id: projectId,
      timezone: "Etc/UTC",
      connectedRepository: null,
    });
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: { userId, timezone: "Etc/UTC" },
      select: { id: true, timezone: true },
    });
  });

  it("binds an opaque state digest to the authenticated user and owned Project", async () => {
    const { prisma, service } = harness();
    const result = await service.start(userId, projectId);
    const state = new URL(result.installationUrl).searchParams.get("state");
    const createCall = prisma.gitHubConnectionAttempt.create.mock.calls[0]![0];

    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createCall.data).toMatchObject({ userId, projectId });
    expect(createCall.data.stateDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(createCall.data.stateDigest).not.toBe(state);
  });

  it("rejects a Project not owned by the authenticated user", async () => {
    const { prisma, service } = harness();
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(service.start(otherUserId, projectId)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects expired state before exchanging a GitHub code", async () => {
    const { github, prisma, service } = harness();
    prisma.gitHubConnectionAttempt.findUnique.mockResolvedValue({
      id: "523e4567-e89b-42d3-a456-426614174000",
      userId,
      projectId,
      expiresAt: new Date(Date.now() - 1),
    });

    await expect(
      service.complete(userId, { code: "code", installationId: "42", state: "state" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(github.exchangeUserCode).not.toHaveBeenCalled();
  });

  it("rejects state bound to a different authenticated user", async () => {
    const { github, prisma, service } = harness();
    prisma.gitHubConnectionAttempt.findUnique.mockResolvedValue({
      id: "523e4567-e89b-42d3-a456-426614174000",
      userId: otherUserId,
      projectId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.complete(userId, {
        code: "code",
        installationId: "42",
        state: "opaque-state",
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(github.exchangeUserCode).not.toHaveBeenCalled();
  });

  it("consumes state once and refuses replay", async () => {
    const { github, prisma, service } = harness();
    prisma.gitHubConnectionAttempt.findUnique.mockResolvedValue({
      id: "523e4567-e89b-42d3-a456-426614174000",
      userId,
      projectId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.gitHubConnectionAttempt.delete.mockRejectedValue(new Error("already deleted"));

    await expect(
      service.complete(userId, { code: "code", installationId: "42", state: "state" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(github.exchangeUserCode).not.toHaveBeenCalled();
  });

  it("does not persist a spoofed installation ID when GitHub verification fails", async () => {
    const { github, prisma, service } = harness();
    prisma.gitHubConnectionAttempt.findUnique.mockResolvedValue({
      id: "523e4567-e89b-42d3-a456-426614174000",
      userId,
      projectId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    github.verifyInstallationForUser.mockRejectedValue(new GitHubIntegrationError());

    await expect(
      service.complete(userId, { code: "code", installationId: "42", state: "state" })
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(prisma.gitHubConnection.upsert).not.toHaveBeenCalled();
  });

  it("persists verified installation metadata without either ephemeral token", async () => {
    const { github, prisma, service } = harness();
    prisma.gitHubConnectionAttempt.findUnique.mockResolvedValue({
      id: "523e4567-e89b-42d3-a456-426614174000",
      userId,
      projectId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    github.verifyInstallationForUser.mockResolvedValue({
      installationId: 42n,
      accountId: 7n,
      accountLogin: "safe-account",
      accountType: "User",
    });
    prisma.gitHubConnection.upsert.mockResolvedValue({
      id: connectionId,
      accountLogin: "safe-account",
      accountType: "User",
      status: "active",
    });

    await expect(
      service.complete(userId, {
        code: "one-time-code",
        installationId: "42",
        state: "opaque-state",
      })
    ).resolves.toMatchObject({ projectId, connection: { id: connectionId } });
    const data = prisma.gitHubConnection.upsert.mock.calls[0]![0];
    expect(data.create).not.toHaveProperty("token");
    expect(data.create).not.toHaveProperty("accessToken");
    expect(data.create).not.toHaveProperty("refreshToken");
    expect(data.update).not.toHaveProperty("token");
  });

  it("rejects a repository ID absent from the installation-authorized list", async () => {
    const { github, prisma, service } = harness();
    github.listInstallationRepositories.mockResolvedValue([
      { id: 99n, owner: "owner", name: "repo", defaultBranch: "main", isPrivate: true },
    ]);

    await expect(
      service.connectRepository(userId, {
        projectId,
        connectionId,
        repositoryId: "100",
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.connectedRepository.upsert).not.toHaveBeenCalled();
  });

  it("connects an authorized repository idempotently to the owned Project", async () => {
    const { github, prisma, service } = harness();
    const repository = {
      id: 99n,
      owner: "owner",
      name: "repo",
      defaultBranch: "main",
      isPrivate: true,
    };
    github.listInstallationRepositories.mockResolvedValue([repository]);
    prisma.connectedRepository.upsert.mockResolvedValue({
      projectId,
      gitHubConnectionId: connectionId,
      providerRepositoryId: 99n,
      owner: "owner",
      name: "repo",
      defaultBranch: "main",
      isPrivate: true,
      status: "active",
    });

    const input = { projectId, connectionId, repositoryId: "99" };
    await expect(service.connectRepository(userId, input)).resolves.toMatchObject({
      id: "99",
      projectId,
      connectionId,
    });
    await expect(service.connectRepository(userId, input)).resolves.toMatchObject({
      id: "99",
    });
    expect(prisma.connectedRepository.upsert).toHaveBeenCalledTimes(2);
  });

  it("rejects cross-user connection access before querying GitHub", async () => {
    const { github, prisma, service } = harness();
    prisma.gitHubConnection.findFirst.mockResolvedValue(null);

    await expect(
      service.listAuthorizedRepositories(otherUserId, connectionId, projectId)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(github.listInstallationRepositories).not.toHaveBeenCalled();
  });

  it("rejects cross-user disconnect before mutating persistence", async () => {
    const { prisma, service } = harness();
    prisma.gitHubConnection.findFirst.mockResolvedValue(null);

    await expect(
      service.disconnectConnection(otherUserId, connectionId)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.gitHubConnection.delete).not.toHaveBeenCalled();
  });
});
