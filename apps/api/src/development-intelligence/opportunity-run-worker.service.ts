import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { StructuredLogger } from "../observability/structured-logger";
import { OPPORTUNITY_RUN_CLOCK, OPPORTUNITY_RUN_WORKER_OPTIONS } from "./opportunity-run.tokens";
import { OpportunityRunService } from "./opportunity-run.service";

export interface OpportunityRunWorkerOptions {
  readonly heartbeatIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly maxAttempts: number;
  readonly retryBaseDelayMs: number;
}
export const defaultOpportunityRunWorkerOptions: OpportunityRunWorkerOptions = {
  heartbeatIntervalMs: 30_000,
  leaseDurationMs: 15 * 60_000,
  maxAttempts: 3,
  retryBaseDelayMs: 60_000,
};
interface ClaimedRun {
  readonly opportunityRunId: string;
  readonly attemptCount: number;
  readonly leaseToken: string;
  readonly recovered: boolean;
}

@Injectable()
export class OpportunityRunWorkerService implements OnApplicationShutdown {
  private activeTick: Promise<boolean> | null = null;
  private stopping = false;

  constructor(
    private readonly runs: OpportunityRunService,
    private readonly logger: StructuredLogger,
    @Inject(OPPORTUNITY_RUN_CLOCK) private readonly clock: () => Date,
    @Inject(OPPORTUNITY_RUN_WORKER_OPTIONS) private readonly options: OpportunityRunWorkerOptions
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.activeTick;
  }

  async runOnce(): Promise<boolean> {
    if (this.stopping || this.activeTick) return false;
    const tick = this.executeTick();
    this.activeTick = tick;
    try { return await tick; }
    finally { this.activeTick = null; }
  }

  private async executeTick(): Promise<boolean> {
    const now = this.clock();
    await this.runs.terminalizeExhausted(now);
    await this.runs.terminalizeStaleActiveRuns();
    await this.runs.terminalizeStaleInputs();
    await this.runs.requeueEligible(now);
    const queued = await this.runs.enqueueEligibleIntelligenceCompletion();
    if (this.stopping) return queued > 0;
    const claimed = await this.runs.claimNext(now, this.options.leaseDurationMs) as ClaimedRun | null;
    if (!claimed) return queued > 0;
    if (claimed.recovered) this.logger.warnEvent("opportunity_run_recovered", { opportunityRunId: claimed.opportunityRunId });
    this.logger.info("opportunity_run_claimed", { opportunityRunId: claimed.opportunityRunId, attemptCount: claimed.attemptCount });

    const heartbeat = setInterval(() => {
      void this.runs.extendLease(claimed.opportunityRunId, claimed.leaseToken, this.clock(), this.options.leaseDurationMs)
        .catch(() => this.logger.errorEvent("opportunity_run_heartbeat_failed", {
          opportunityRunId: claimed.opportunityRunId, failureCode: "OPPORTUNITY_LEASE_LOST",
        }));
    }, this.options.heartbeatIntervalMs);
    try {
      await this.runs.executeClaimed(claimed.opportunityRunId, claimed.leaseToken);
      this.logger.info("opportunity_run_worker_completed", { opportunityRunId: claimed.opportunityRunId });
    } catch (error) {
      await this.runs.failClaimed({ id: claimed.opportunityRunId, leaseToken: claimed.leaseToken, attemptCount: claimed.attemptCount }, error, this.clock());
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
}
