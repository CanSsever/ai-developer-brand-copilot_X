import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";
import { StructuredLogger } from "../observability/structured-logger";
import {
  INTELLIGENCE_PIPELINE_CLOCK,
  INTELLIGENCE_PIPELINE_WORKER_OPTIONS,
} from "./intelligence-pipeline.tokens";
import {
  IntelligencePipelineError,
  IntelligencePipelineService,
} from "./intelligence-pipeline.service";

export interface IntelligencePipelineWorkerOptions {
  readonly heartbeatIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly maxAttempts: number;
  readonly retryBaseDelayMs: number;
}

export const defaultIntelligencePipelineWorkerOptions: IntelligencePipelineWorkerOptions = {
  heartbeatIntervalMs: 30_000,
  leaseDurationMs: 15 * 60_000,
  maxAttempts: 3,
  retryBaseDelayMs: 60_000,
};

interface ClaimedIntelligenceRun {
  readonly attemptCount: number;
  readonly intelligenceRunId: string;
  readonly leaseToken: string;
  readonly recovered: boolean;
}

@Injectable()
export class IntelligencePipelineWorkerService {
  private activeTick: Promise<boolean> | null = null;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: IntelligencePipelineService,
    private readonly logger: StructuredLogger,
    @Inject(INTELLIGENCE_PIPELINE_CLOCK) private readonly clock: () => Date,
    @Inject(INTELLIGENCE_PIPELINE_WORKER_OPTIONS)
    private readonly options: IntelligencePipelineWorkerOptions
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
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

  private async executeTick(): Promise<boolean> {
    const now = this.clock();
    await this.terminalizeExhausted(now);
    await this.requeueEligible(now);
    const queued = await this.pipeline.enqueueEligibleCompletedSync();
    const claimed = await this.claimNext(now);
    if (!claimed) return queued;

    if (claimed.recovered) {
      this.logger.warnEvent("intelligence_run_recovered", {
        intelligenceRunId: claimed.intelligenceRunId,
      });
    }
    this.logger.info("intelligence_run_claimed", {
      attemptCount: claimed.attemptCount,
      intelligenceRunId: claimed.intelligenceRunId,
    });

    const heartbeat = setInterval(() => {
      void this.extendLease(claimed).catch(() => {
        this.logger.errorEvent("intelligence_worker_heartbeat_failed", {
          failureCode: "INTELLIGENCE_LEASE_LOST",
          intelligenceRunId: claimed.intelligenceRunId,
        });
      });
    }, this.options.heartbeatIntervalMs);

    try {
      await this.pipeline.executeClaimed(
        claimed.intelligenceRunId,
        claimed.leaseToken
      );
      this.logger.info("intelligence_run_completed", {
        intelligenceRunId: claimed.intelligenceRunId,
      });
    } catch (error) {
      await this.failClaimed(claimed, error, this.clock());
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }

  private async claimNext(now: Date): Promise<ClaimedIntelligenceRun | null> {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + this.options.leaseDurationMs);
    const rows = await this.prisma.$queryRaw<ClaimedIntelligenceRun[]>`
      WITH candidate AS (
        SELECT
          run."id",
          (run."status" = 'running') AS "recovered"
        FROM "IntelligenceRun" AS run
        WHERE (
          run."status" = 'queued'
          OR (
            run."status" = 'running'
            AND run."leaseExpiresAt" <= ${now}
          )
        )
          AND run."attemptCount" < ${this.options.maxAttempts}
        ORDER BY
          CASE WHEN run."status" = 'running' THEN 0 ELSE 1 END,
          run."queuedAt" ASC,
          run."id" ASC
        FOR UPDATE OF run SKIP LOCKED
        LIMIT 1
      )
      UPDATE "IntelligenceRun" AS run
      SET
        "status" = 'running',
        "startedAt" = COALESCE(run."startedAt", ${now}),
        "finishedAt" = NULL,
        "failureCode" = NULL,
        "retryAfterAt" = NULL,
        "attemptCount" = run."attemptCount" + 1,
        "leaseToken" = ${leaseToken}::uuid,
        "leaseExpiresAt" = ${leaseExpiresAt},
        "updatedAt" = ${now}
      FROM candidate
      WHERE run."id" = candidate."id"
      RETURNING
        run."id" AS "intelligenceRunId",
        run."attemptCount",
        run."leaseToken"::text AS "leaseToken",
        candidate."recovered"
    `;
    return rows[0] ?? null;
  }

  private async extendLease(claimed: ClaimedIntelligenceRun): Promise<void> {
    const updated = await this.prisma.intelligenceRun.updateMany({
      where: {
        id: claimed.intelligenceRunId,
        leaseToken: claimed.leaseToken,
        status: "running",
      },
      data: {
        leaseExpiresAt: new Date(
          this.clock().getTime() + this.options.leaseDurationMs
        ),
      },
    });
    if (updated.count !== 1) {
      throw new IntelligencePipelineError("INTELLIGENCE_LEASE_LOST");
    }
  }

  private async failClaimed(
    claimed: ClaimedIntelligenceRun,
    error: unknown,
    now: Date
  ): Promise<void> {
    const failure =
      error instanceof IntelligencePipelineError
        ? error
        : new IntelligencePipelineError(
            "INTELLIGENCE_PERSISTENCE_FAILURE",
            true
          );
    const mayRetry =
      failure.retryable && claimed.attemptCount < this.options.maxAttempts;
    const retryAfterAt = mayRetry
      ? failure.retryAfterAt ??
        new Date(
          now.getTime() +
            this.options.retryBaseDelayMs *
              2 ** Math.max(0, claimed.attemptCount - 1)
        )
      : null;
    const updated = await this.prisma.intelligenceRun.updateMany({
      where: {
        id: claimed.intelligenceRunId,
        leaseToken: claimed.leaseToken,
        status: "running",
      },
      data: {
        failureCode: failure.failureCode,
        finishedAt: mayRetry ? null : now,
        leaseExpiresAt: null,
        leaseToken: null,
        retryAfterAt,
        status: mayRetry ? "failed_retryable" : "failed_terminal",
      },
    });
    if (updated.count !== 1) return;
    this.logger[mayRetry ? "warnEvent" : "errorEvent"](
      mayRetry ? "intelligence_run_deferred" : "intelligence_run_failed",
      {
        attemptCount: claimed.attemptCount,
        failureCode: failure.failureCode,
        intelligenceRunId: claimed.intelligenceRunId,
        ...(retryAfterAt ? { retryAfterAt: retryAfterAt.toISOString() } : {}),
      }
    );
  }

  private async requeueEligible(now: Date): Promise<void> {
    await this.prisma.intelligenceRun.updateMany({
      where: {
        status: "failed_retryable",
        attemptCount: { lt: this.options.maxAttempts },
        OR: [{ retryAfterAt: null }, { retryAfterAt: { lte: now } }],
      },
      data: {
        failureCode: null,
        retryAfterAt: null,
        status: "queued",
      },
    });
  }

  private async terminalizeExhausted(now: Date): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "IntelligenceRun"
      SET
        "status" = 'failed_terminal',
        "finishedAt" = COALESCE("finishedAt", ${now}),
        "failureCode" = COALESCE(
          "failureCode",
          'INTELLIGENCE_RETRY_EXHAUSTED'
        ),
        "retryAfterAt" = NULL,
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "updatedAt" = ${now}
      WHERE "attemptCount" >= ${this.options.maxAttempts}
        AND (
          "status" = 'failed_retryable'
          OR (
            "status" = 'running'
            AND "leaseExpiresAt" <= ${now}
          )
        )
    `;
  }
}
