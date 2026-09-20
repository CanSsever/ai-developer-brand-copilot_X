import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { StartSyncRunResponse } from "@developer-brand-copilot/contracts";

import { PrismaService } from "../database/prisma.service";
import {
  GitHubCommitSyncConflictError,
  GitHubCommitSyncError,
  GitHubCommitSyncService,
} from "./github-commit-sync.service";
import { GITHUB_SYNC_CLOCK } from "./github.tokens";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const manualSyncMinimumIntervalMs = 60 * 1_000;

function requireProjectId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new BadRequestException("projectId is invalid");
  }
  return value;
}

@Injectable()
export class GitHubManualSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: GitHubCommitSyncService,
    @Inject(GITHUB_SYNC_CLOCK) private readonly clock: () => Date
  ) {}

  async start(
    userId: string,
    projectIdValue: unknown
  ): Promise<StartSyncRunResponse> {
    const projectId = requireProjectId(projectIdValue);
    const repository = await this.prisma.connectedRepository.findFirst({
      where: {
        projectId,
        status: "active",
        project: { userId },
        gitHubConnection: { userId, status: "active" },
      },
      select: { id: true },
    });
    if (!repository) {
      throw new NotFoundException("Connected repository not found");
    }

    const latest = await this.prisma.syncRun.findFirst({
      where: { connectedRepositoryId: repository.id },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        retryAfterAt: true,
        status: true,
      },
    });
    if (latest?.status === "queued" || latest?.status === "running") {
      throw new ConflictException("GitHub synchronization is already in progress");
    }

    const now = this.clock();
    const minimumRetryAt = latest
      ? new Date(latest.createdAt.getTime() + manualSyncMinimumIntervalMs)
      : null;
    const providerRetryAt = latest?.retryAfterAt ?? null;
    if (
      (minimumRetryAt && minimumRetryAt > now) ||
      (providerRetryAt && providerRetryAt > now)
    ) {
      throw new HttpException(
        "GitHub synchronization is temporarily rate limited",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    return new Promise<StartSyncRunResponse>((resolve, reject) => {
      let queued = false;
      const completion = this.sync.synchronize(repository.id, (syncRunId) => {
        queued = true;
        resolve({ status: "queued", syncRunId });
      });

      void completion.catch((error: unknown) => {
        if (!queued) {
          reject(this.mapStartFailure(error));
        }
      });
    });
  }

  private mapStartFailure(error: unknown): HttpException {
    if (error instanceof GitHubCommitSyncConflictError) {
      return new ConflictException(
        "GitHub synchronization is already in progress"
      );
    }
    if (error instanceof GitHubCommitSyncError) {
      if (error.failureCode === "CONNECTED_REPOSITORY_NOT_AVAILABLE") {
        return new NotFoundException("Connected repository not found");
      }
      if (
        error.failureCode === "GITHUB_AUTHORIZATION_FAILED" ||
        error.failureCode === "GITHUB_RESPONSE_INVALID" ||
        error.failureCode === "GITHUB_SAFETY_LIMIT_EXCEEDED"
      ) {
        return new BadGatewayException("GitHub access needs attention");
      }
    }
    return new ServiceUnavailableException(
      "GitHub synchronization is temporarily unavailable"
    );
  }
}
