import { randomUUID } from "node:crypto";

import {
  Inject,
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";
import { StructuredLogger } from "../observability/structured-logger";
import {
  GitHubCommitSyncConflictError,
  GitHubCommitSyncError,
  GitHubCommitSyncService,
} from "./github-commit-sync.service";
import {
  GITHUB_SYNC_CLOCK,
  GITHUB_SYNC_WORKER_OPTIONS,
} from "./github.tokens";

export interface GitHubSyncWorkerOptions {
  readonly heartbeatIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly maxAttempts: number;
  readonly pollIntervalMs: number;
  readonly retryBaseDelayMs: number;
  readonly scheduleBatchSize: number;
  readonly scheduleCadenceMs: number;
  readonly scheduleCheckIntervalMs: number;
}

export const defaultGitHubSyncWorkerOptions: GitHubSyncWorkerOptions = {
  heartbeatIntervalMs: 30_000,
  leaseDurationMs: 15 * 60_000,
  maxAttempts: 3,
  pollIntervalMs: 5_000,
  retryBaseDelayMs: 60_000,
  scheduleBatchSize: 25,
  scheduleCadenceMs: 60 * 60_000,
  scheduleCheckIntervalMs: 60_000,
};

interface ClaimedSyncRun {
  readonly recovered: boolean;
  readonly syncRunId: string;
  readonly workerAttemptCount: number;
}

@Injectable()
export class GitHubSyncWorkerService
  implements OnModuleInit, OnApplicationShutdown
{
  private activeTick: Promise<boolean> | null = null;
  private lastScheduleCheckAt: Date | null = null;
  private stopping = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: GitHubCommitSyncService,
    private readonly logger: StructuredLogger,
    @Inject(GITHUB_SYNC_CLOCK) private readonly clock: () => Date,
    @Inject(GITHUB_SYNC_WORKER_OPTIONS)
    private readonly options: GitHubSyncWorkerOptions
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.logger.info("sync_worker_started");
    this.schedulePoll(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.activeTick;
  }

  async runOnce(): Promise<boolean> {
    if (this.stopping || this.activeTick) return false;
    const tick = this.executeTick();
    this.activeTick = tick;
    try {
      return await tick;
    } finally {
      this.activeTick = null;
    }
  }

  private schedulePoll(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runOnce()
        .catch(() => {
          this.logger.errorEvent("sync_worker_failure", {
            failureCode: "SYNC_INTERNAL_ERROR",
          });
        })
        .finally(() => {
          this.schedulePoll(this.options.pollIntervalMs);
        });
    }, delayMs);
  }

  private async executeTick(): Promise<boolean> {
    const now = this.clock();
    await this.cancelUnavailableRuns(now);
    await this.cancelSupersededRetryableRuns(now);
    await this.terminalizeExhaustedRuns(now);
    await this.requeueEligibleRuns(now);
    await this.enqueueScheduledRuns(now);

    if (this.stopping) return false;
    const claimed = await this.claimNext(now);
    if (!claimed) return false;

    if (claimed.recovered) {
      this.logger.warnEvent("sync_run_recovered", {
        syncRunId: claimed.syncRunId,
      });
    }
    this.logger.info("sync_run_claimed", {
      syncRunId: claimed.syncRunId,
      workerAttemptCount: claimed.workerAttemptCount,
    });

    const heartbeat = setInterval(() => {
      void this.extendLease(claimed).catch(() => {
        this.logger.errorEvent("sync_worker_heartbeat_failed", {
          failureCode: "SYNC_INTERNAL_ERROR",
          syncRunId: claimed.syncRunId,
        });
      });
    }, this.options.heartbeatIntervalMs);

    try {
      await this.sync.executeClaimed(
        claimed.syncRunId,
        this.claimToken(claimed)
      );
      this.logger.info("sync_worker_completed", {
        syncRunId: claimed.syncRunId,
      });
    } catch (error) {
      await this.deferRetry(claimed, error, this.clock());
      this.logger.errorEvent("sync_worker_failure", {
        failureCode:
          error instanceof GitHubCommitSyncError
            ? error.failureCode
            : "SYNC_INTERNAL_ERROR",
        syncRunId: claimed.syncRunId,
      });
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }

  private async claimNext(now: Date): Promise<
    (ClaimedSyncRun & { readonly leaseToken: string }) | null
  > {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(
      now.getTime() + this.options.leaseDurationMs
    );
    const rows = await this.prisma.$queryRaw<
      Array<ClaimedSyncRun & { readonly leaseToken: string }>
    >`
      WITH candidate AS (
        SELECT
          sync_run."id",
          (sync_run."status" = 'running') AS "recovered"
        FROM "SyncRun" AS sync_run
        INNER JOIN "ConnectedRepository" AS repository
          ON repository."id" = sync_run."connectedRepositoryId"
        INNER JOIN "GitHubConnection" AS connection
          ON connection."id" = repository."gitHubConnectionId"
        WHERE (
          sync_run."status" = 'queued'
          OR (
            sync_run."status" = 'running'
            AND sync_run."leaseExpiresAt" <= ${now}
          )
        )
          AND sync_run."workerAttemptCount" < ${this.options.maxAttempts}
          AND repository."status" = 'active'
          AND connection."status" = 'active'
        ORDER BY
          CASE WHEN sync_run."status" = 'running' THEN 0 ELSE 1 END,
          sync_run."createdAt" ASC
        FOR UPDATE OF sync_run SKIP LOCKED
        LIMIT 1
      )
      UPDATE "SyncRun" AS sync_run
      SET
        "status" = 'running',
        "startedAt" = COALESCE(sync_run."startedAt", ${now}),
        "finishedAt" = NULL,
        "failureCode" = NULL,
        "retryAfterAt" = NULL,
        "workerAttemptCount" = sync_run."workerAttemptCount" + 1,
        "leaseToken" = ${leaseToken}::uuid,
        "leaseExpiresAt" = ${leaseExpiresAt},
        "updatedAt" = ${now}
      FROM candidate
      WHERE sync_run."id" = candidate."id"
      RETURNING
        sync_run."id" AS "syncRunId",
        sync_run."workerAttemptCount",
        sync_run."leaseToken"::text AS "leaseToken",
        candidate."recovered"
    `;
    return rows[0] ?? null;
  }

  private claimToken(
    claimed: ClaimedSyncRun & { readonly leaseToken?: string }
  ): string {
    if (!claimed.leaseToken) {
      throw new Error("Claimed SyncRun is missing its lease token");
    }
    return claimed.leaseToken;
  }

  private async extendLease(
    claimed: ClaimedSyncRun & { readonly leaseToken?: string }
  ): Promise<void> {
    const now = this.clock();
    const result = await this.prisma.syncRun.updateMany({
      where: {
        id: claimed.syncRunId,
        status: "running",
        leaseToken: this.claimToken(claimed),
      },
      data: {
        leaseExpiresAt: new Date(
          now.getTime() + this.options.leaseDurationMs
        ),
      },
    });
    if (result.count !== 1) {
      throw new Error("SyncRun lease is no longer owned");
    }
  }

  private async deferRetry(
    claimed: ClaimedSyncRun,
    error: unknown,
    now: Date
  ): Promise<void> {
    if (claimed.workerAttemptCount >= this.options.maxAttempts) {
      await this.prisma.syncRun.updateMany({
        where: {
          id: claimed.syncRunId,
          status: "failed_retryable",
        },
        data: {
          status: "failed_terminal",
          retryAfterAt: null,
        },
      });
      return;
    }

    const localRetryAt = new Date(
      now.getTime() +
        this.options.retryBaseDelayMs *
          2 ** Math.max(0, claimed.workerAttemptCount - 1)
    );
    const providerRetryAt =
      error instanceof GitHubCommitSyncError
        ? error.retryAfterAt
        : null;
    const retryAfterAt =
      providerRetryAt && providerRetryAt > localRetryAt
        ? providerRetryAt
        : localRetryAt;
    await this.prisma.syncRun.updateMany({
      where: {
        id: claimed.syncRunId,
        status: "failed_retryable",
      },
      data: { retryAfterAt },
    });
  }

  private async cancelUnavailableRuns(now: Date): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "SyncRun" AS sync_run
      SET
        "status" = 'cancelled',
        "finishedAt" = ${now},
        "failureCode" = NULL,
        "retryAfterAt" = NULL,
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "updatedAt" = ${now}
      FROM "ConnectedRepository" AS repository
      INNER JOIN "GitHubConnection" AS connection
        ON connection."id" = repository."gitHubConnectionId"
      WHERE sync_run."connectedRepositoryId" = repository."id"
        AND sync_run."status" IN ('queued', 'running')
        AND (
          repository."status" <> 'active'
          OR connection."status" <> 'active'
        )
    `;
  }

  private async terminalizeExhaustedRuns(now: Date): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "SyncRun"
      SET
        "status" = 'failed_terminal',
        "startedAt" = COALESCE("startedAt", ${now}),
        "finishedAt" = COALESCE("finishedAt", ${now}),
        "failureCode" = COALESCE("failureCode", 'SYNC_RETRY_EXHAUSTED'),
        "retryAfterAt" = NULL,
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "updatedAt" = ${now}
      WHERE "workerAttemptCount" >= ${this.options.maxAttempts}
        AND (
          "status" = 'failed_retryable'
          OR (
            "status" = 'running'
            AND "leaseExpiresAt" <= ${now}
          )
        )
    `;
  }

  private async cancelSupersededRetryableRuns(now: Date): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "SyncRun" AS retryable
      SET
        "status" = 'cancelled',
        "finishedAt" = COALESCE(retryable."finishedAt", ${now}),
        "failureCode" = NULL,
        "retryAfterAt" = NULL,
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "updatedAt" = ${now}
      WHERE retryable."status" = 'failed_retryable'
        AND EXISTS (
          SELECT 1
          FROM "SyncRun" AS newer
          WHERE newer."connectedRepositoryId" =
            retryable."connectedRepositoryId"
            AND newer."createdAt" > retryable."createdAt"
        )
    `;
  }

  private async requeueEligibleRuns(now: Date): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "SyncRun" AS sync_run
      SET
        "status" = 'queued',
        "startedAt" = NULL,
        "finishedAt" = NULL,
        "failureCode" = NULL,
        "retryAfterAt" = NULL,
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "updatedAt" = ${now}
      FROM "ConnectedRepository" AS repository
      INNER JOIN "GitHubConnection" AS connection
        ON connection."id" = repository."gitHubConnectionId"
      WHERE sync_run."connectedRepositoryId" = repository."id"
        AND sync_run."status" = 'failed_retryable'
        AND sync_run."workerAttemptCount" < ${this.options.maxAttempts}
        AND COALESCE(
          sync_run."retryAfterAt",
          sync_run."finishedAt",
          sync_run."createdAt"
        ) <= ${now}
        AND repository."status" = 'active'
        AND connection."status" = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM "SyncRun" AS newer
          WHERE newer."connectedRepositoryId" =
            sync_run."connectedRepositoryId"
            AND newer."createdAt" > sync_run."createdAt"
        )
    `;
  }

  private async enqueueScheduledRuns(now: Date): Promise<void> {
    if (
      this.lastScheduleCheckAt &&
      now.getTime() - this.lastScheduleCheckAt.getTime() <
        this.options.scheduleCheckIntervalMs
    ) {
      return;
    }
    this.lastScheduleCheckAt = now;
    const cutoff = new Date(
      now.getTime() - this.options.scheduleCadenceMs
    );
    const repositories = await this.prisma.connectedRepository.findMany({
      where: {
        status: "active",
        gitHubConnection: { status: "active" },
        syncRuns: {
          none: {
            OR: [
              { createdAt: { gt: cutoff } },
              {
                status: {
                  in: [
                    "queued",
                    "running",
                    "failed_retryable",
                    "failed_terminal",
                  ],
                },
              },
            ],
          },
        },
      },
      orderBy: { id: "asc" },
      take: this.options.scheduleBatchSize,
      select: { id: true },
    });
    const windowEnd = new Date(
      Math.floor(now.getTime() / this.options.scheduleCadenceMs) *
        this.options.scheduleCadenceMs
    );

    for (const repository of repositories) {
      if (this.stopping) return;
      try {
        await this.sync.enqueue(repository.id, windowEnd);
      } catch (error) {
        if (!(error instanceof GitHubCommitSyncConflictError)) {
          this.logger.errorEvent("sync_schedule_enqueue_failed", {
            failureCode: "SYNC_INTERNAL_ERROR",
          });
        }
      }
    }
  }
}
