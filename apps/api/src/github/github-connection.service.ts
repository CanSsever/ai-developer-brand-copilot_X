import { createHash, randomBytes } from "node:crypto";

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AuthorizedRepositorySummary,
  ConnectedRepositorySummary,
  DisconnectConnectionResponse,
  GitHubConnectionCompleteResponse,
  GitHubConnectionStartResponse,
  GitHubConnectionSummary,
  ProjectSummary,
} from "@developer-brand-copilot/contracts";

import { PrismaService } from "../database/prisma.service";
import { GitHubApiService, GitHubIntegrationError } from "./github-api.service";
import type { GitHubAppConfig } from "./github.types";
import { GITHUB_APP_CONFIG } from "./github.tokens";
import { Inject } from "@nestjs/common";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const attemptLifetimeMs = 10 * 60 * 1000;

function stateDigest(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return value;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestException(`${field} is required`);
  }
  return value.trim();
}

function requireProviderId(value: unknown, field: string): bigint {
  const text = requireText(value, field);
  try {
    const id = BigInt(text);
    if (id > 0n) return id;
  } catch {
    // Converted to a safe validation error below.
  }
  throw new BadRequestException(`${field} is invalid`);
}

@Injectable()
export class GitHubConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GitHubApiService,
    @Inject(GITHUB_APP_CONFIG) private readonly config: GitHubAppConfig
  ) {}

  async listProjects(userId: string): Promise<readonly ProjectSummary[]> {
    const projects = await this.prisma.project.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        timezone: true,
        connectedRepository: {
          select: {
            gitHubConnectionId: true,
            owner: true,
            name: true,
            defaultBranch: true,
            isPrivate: true,
            status: true,
          },
        },
      },
    });

    return projects.map((project) => ({
      id: project.id,
      timezone: project.timezone,
      connectedRepository: project.connectedRepository
        ? {
            connectionId: project.connectedRepository.gitHubConnectionId,
            defaultBranch: project.connectedRepository.defaultBranch,
            fullName: `${project.connectedRepository.owner}/${project.connectedRepository.name}`,
            isPrivate: project.connectedRepository.isPrivate,
            status: project.connectedRepository.status,
          }
        : null,
    }));
  }

  async createProject(userId: string, timezoneValue: unknown): Promise<ProjectSummary> {
    const timezone = requireText(timezoneValue, "timezone");
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    } catch {
      throw new BadRequestException("timezone is invalid");
    }

    const project = await this.prisma.project.create({
      data: { userId, timezone },
      select: { id: true, timezone: true },
    });

    return { ...project, connectedRepository: null };
  }

  async start(
    userId: string,
    projectIdValue: unknown
  ): Promise<GitHubConnectionStartResponse> {
    const projectId = requireUuid(projectIdValue, "projectId");
    await this.requireOwnedProject(userId, projectId);
    const state = randomBytes(32).toString("base64url");
    const digest = stateDigest(state);

    await this.prisma.$transaction([
      this.prisma.gitHubConnectionAttempt.deleteMany({
        where: { userId, projectId },
      }),
      this.prisma.gitHubConnectionAttempt.create({
        data: {
          userId,
          projectId,
          stateDigest: digest,
          expiresAt: new Date(Date.now() + attemptLifetimeMs),
        },
      }),
    ]);

    const installationUrl = new URL(
      `https://github.com/apps/${this.config.slug}/installations/new`
    );
    installationUrl.searchParams.set("state", state);

    return { installationUrl: installationUrl.toString() };
  }

  async complete(
    userId: string,
    input: { readonly code?: unknown; readonly installationId?: unknown; readonly state?: unknown }
  ): Promise<GitHubConnectionCompleteResponse> {
    const code = requireText(input.code, "code");
    const state = requireText(input.state, "state");
    const installationId = requireProviderId(
      input.installationId,
      "installationId"
    );
    const attempt = await this.consumeAttempt(userId, state);

    try {
      const userAccessToken = await this.github.exchangeUserCode(code);
      const installation = await this.github.verifyInstallationForUser(
        installationId,
        userAccessToken
      );
      const connection = await this.prisma.gitHubConnection.upsert({
        where: {
          userId_providerInstallationId: { userId, providerInstallationId: installationId },
        },
        create: {
          userId,
          providerInstallationId: installation.installationId,
          providerAccountId: installation.accountId,
          accountLogin: installation.accountLogin,
          accountType: installation.accountType,
          status: "active",
        },
        update: {
          providerAccountId: installation.accountId,
          accountLogin: installation.accountLogin,
          accountType: installation.accountType,
          status: "active",
        },
        select: { id: true, accountLogin: true, accountType: true, status: true },
      });

      return { connection, projectId: attempt.projectId };
    } catch (error) {
      if (error instanceof GitHubIntegrationError) {
        throw new BadGatewayException("GitHub authorization could not be verified");
      }
      throw error;
    }
  }

  async listConnections(userId: string): Promise<readonly GitHubConnectionSummary[]> {
    return this.prisma.gitHubConnection.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, accountLogin: true, accountType: true, status: true },
    });
  }

  async listAuthorizedRepositories(
    userId: string,
    connectionIdValue: unknown,
    projectIdValue: unknown
  ): Promise<readonly AuthorizedRepositorySummary[]> {
    const projectId = requireUuid(projectIdValue, "projectId");
    const connectionId = requireUuid(connectionIdValue, "connectionId");
    await this.requireOwnedProject(userId, projectId);
    const connection = await this.requireOwnedConnection(userId, connectionId);

    try {
      const repositories = await this.github.listInstallationRepositories(
        connection.providerInstallationId
      );
      return repositories.map((repository) => ({
        id: repository.id.toString(),
        owner: repository.owner,
        name: repository.name,
        fullName: `${repository.owner}/${repository.name}`,
        defaultBranch: repository.defaultBranch,
        isPrivate: repository.isPrivate,
      }));
    } catch (error) {
      if (error instanceof GitHubIntegrationError) {
        throw new BadGatewayException("GitHub repository authorization failed");
      }
      throw error;
    }
  }

  async connectRepository(
    userId: string,
    input: {
      readonly connectionId?: unknown;
      readonly projectId?: unknown;
      readonly repositoryId?: unknown;
    }
  ): Promise<ConnectedRepositorySummary> {
    const projectId = requireUuid(input.projectId, "projectId");
    const connectionId = requireUuid(input.connectionId, "connectionId");
    const repositoryId = requireProviderId(input.repositoryId, "repositoryId");
    await this.requireOwnedProject(userId, projectId);
    const connection = await this.requireOwnedConnection(userId, connectionId);
    let authorized;

    try {
      const repositories = await this.github.listInstallationRepositories(
        connection.providerInstallationId
      );
      authorized = repositories.find((repository) => repository.id === repositoryId);
    } catch (error) {
      if (error instanceof GitHubIntegrationError) {
        throw new BadGatewayException("GitHub repository authorization failed");
      }
      throw error;
    }

    if (!authorized) {
      throw new ForbiddenException("Repository is not authorized for this installation");
    }

    const existingProject = await this.prisma.connectedRepository.findUnique({
      where: { projectId },
    });
    if (
      existingProject &&
      (existingProject.gitHubConnectionId !== connectionId ||
        existingProject.providerRepositoryId !== repositoryId)
    ) {
      throw new ConflictException("Project already has a different repository");
    }

    const existingRepository = await this.prisma.connectedRepository.findUnique({
      where: {
        gitHubConnectionId_providerRepositoryId: {
          gitHubConnectionId: connectionId,
          providerRepositoryId: repositoryId,
        },
      },
    });
    if (existingRepository && existingRepository.projectId !== projectId) {
      throw new ConflictException("Repository is already connected to another Project");
    }

    const result = await this.prisma.connectedRepository.upsert({
      where: { projectId },
      create: {
        projectId,
        gitHubConnectionId: connectionId,
        providerRepositoryId: authorized.id,
        owner: authorized.owner,
        name: authorized.name,
        defaultBranch: authorized.defaultBranch,
        isPrivate: authorized.isPrivate,
        status: "active",
      },
      update: {
        owner: authorized.owner,
        name: authorized.name,
        defaultBranch: authorized.defaultBranch,
        isPrivate: authorized.isPrivate,
        status: "active",
      },
    });

    return {
      id: result.providerRepositoryId.toString(),
      connectionId: result.gitHubConnectionId,
      projectId: result.projectId,
      owner: result.owner,
      name: result.name,
      fullName: `${result.owner}/${result.name}`,
      defaultBranch: result.defaultBranch,
      isPrivate: result.isPrivate,
      status: result.status,
    };
  }

  async disconnectConnection(
    userId: string,
    connectionIdValue: unknown
  ): Promise<DisconnectConnectionResponse> {
    const connectionId = requireUuid(connectionIdValue, "connectionId");
    await this.requireOwnedConnection(userId, connectionId);
    await this.prisma.gitHubConnection.delete({ where: { id: connectionId } });
    return { disconnected: true, githubInstallationUnchanged: true };
  }

  private async consumeAttempt(userId: string, state: string) {
    const attempt = await this.prisma.gitHubConnectionAttempt.findUnique({
      where: { stateDigest: stateDigest(state) },
      select: { id: true, userId: true, projectId: true, expiresAt: true },
    });

    if (!attempt || attempt.userId !== userId || attempt.expiresAt <= new Date()) {
      throw new BadRequestException("GitHub connection state is invalid or expired");
    }

    try {
      await this.prisma.gitHubConnectionAttempt.delete({ where: { id: attempt.id } });
    } catch {
      throw new BadRequestException("GitHub connection state was already used");
    }

    return attempt;
  }

  private async requireOwnedProject(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    return project;
  }

  private async requireOwnedConnection(userId: string, connectionId: string) {
    const connection = await this.prisma.gitHubConnection.findFirst({
      where: { id: connectionId, userId, status: "active" },
      select: { id: true, providerInstallationId: true },
    });
    if (!connection) throw new NotFoundException("GitHub connection not found");
    return connection;
  }
}
