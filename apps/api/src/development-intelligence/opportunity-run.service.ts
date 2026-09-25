import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../database/prisma.service";
import { StructuredLogger } from "../observability/structured-logger";
import { ContentOpportunityScoringError, ContentOpportunityScoringService } from "./content-opportunity-scoring.service";
import { fingerprintPhase3OpportunityInput, phase3OpportunityInputSelectionVersion } from "./phase3-opportunity-input";
import { Phase3OpportunityInputSelectorService } from "./phase3-opportunity-input-selector.service";
import { developerDayWindow } from "./developer-day";
import { IntelligencePipelineService } from "./intelligence-pipeline.service";
import { OpportunityDetectionError, OpportunityDetectionService } from "./opportunity-detection.service";
import type { OpportunityDetectionOutcome } from "./opportunity-detection.service";
import { phase3OpportunityScoringVersion } from "./phase3-opportunity-scoring";
import { OPPORTUNITY_RUN_CLOCK } from "./opportunity-run.tokens";

export const opportunityRunOrchestrationVersion = "phase3-opportunity-orchestration-v1";
const activeStatuses = ["queued", "running", "failed_retryable"] as const;
const transientDatabaseCodes = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2034"]);
export type OpportunityRunFailureCode =
  | "OPPORTUNITY_CONFIGURATION_STALE" | "OPPORTUNITY_PROJECT_SOURCE_UNAVAILABLE" | "OPPORTUNITY_SOURCE_STALE"
  | "OPPORTUNITY_INPUT_STALE" | "OPPORTUNITY_DETECTION_RETRYABLE_FAILURE" | "OPPORTUNITY_DETECTION_TERMINAL_FAILURE"
  | "OPPORTUNITY_DETECTION_RESULT_INVALID" | "OPPORTUNITY_SCORING_RETRYABLE_FAILURE" | "OPPORTUNITY_SCORING_TERMINAL_FAILURE"
  | "OPPORTUNITY_SCORING_INVARIANT_FAILED" | "OPPORTUNITY_AI_BUDGET_DEFERRED" | "OPPORTUNITY_LEASE_LOST"
  | "OPPORTUNITY_RETRY_EXHAUSTED" | "OPPORTUNITY_RUN_ACTIVE_CONFLICT";

export class OpportunityRunError extends Error {
  constructor(readonly failureCode: OpportunityRunFailureCode, readonly retryable = false, readonly retryAfterAt: Date | null = null, options?: ErrorOptions) {
    super("Opportunity run processing failed", options); this.name = "OpportunityRunError";
  }
}
export interface OpportunityRunProcessingIdentity {
  readonly orchestrationVersion: string; readonly inputSelectionVersion: string; readonly detectorVersion: string;
  readonly extractionVersion: string; readonly modelConfigurationFingerprint: string; readonly scoringVersion: string;
  readonly processingVersion: string;
}
interface EligibleSource { readonly id: string; readonly projectId: string; readonly userId: string; readonly sourceWindowEnd: Date; readonly processingVersion: string; }
export interface EnqueuedOpportunityRun { readonly opportunityRunId: string; readonly runKey: string; readonly status: "queued" | "reused"; }
function sha256(value: unknown): string { return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex"); }
function errorCode(error: unknown): string | null { return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null; }
function isUnique(error: unknown): boolean { return errorCode(error) === "P2002"; }
function isTransientDatabase(error: unknown): boolean { const code = errorCode(error); return code !== null && transientDatabaseCodes.has(code); }

@Injectable()
export class OpportunityRunService {
  readonly processingIdentity: OpportunityRunProcessingIdentity;
  constructor(
    private readonly prisma: PrismaService,
    private readonly selector: Phase3OpportunityInputSelectorService,
    private readonly detection: OpportunityDetectionService,
    private readonly scoring: ContentOpportunityScoringService,
    private readonly intelligence: IntelligencePipelineService,
    private readonly logger: StructuredLogger,
    @Inject(OPPORTUNITY_RUN_CLOCK) private readonly clock: () => Date
  ) {
    const d = detection.getProcessingIdentity();
    const parts = {
      orchestrationVersion: opportunityRunOrchestrationVersion,
      inputSelectionVersion: phase3OpportunityInputSelectionVersion,
      detectorVersion: d.detectorVersion, extractionVersion: d.extractionVersion,
      modelConfigurationFingerprint: d.modelConfigurationFingerprint,
      promptVersion: d.promptVersion, schemaVersion: d.schemaVersion, validationVersion: d.validationVersion,
      scoringVersion: phase3OpportunityScoringVersion,
    };
    this.processingIdentity = {
      orchestrationVersion: parts.orchestrationVersion, inputSelectionVersion: parts.inputSelectionVersion,
      detectorVersion: parts.detectorVersion, extractionVersion: parts.extractionVersion,
      modelConfigurationFingerprint: parts.modelConfigurationFingerprint, scoringVersion: parts.scoringVersion,
      processingVersion: sha256(parts),
    };
  }

  async enqueueReprocessing(projectId: string, userId: string): Promise<EnqueuedOpportunityRun> {
    const source = await this.latestEligibleSource(projectId, userId);
    if (!source) throw new OpportunityRunError("OPPORTUNITY_PROJECT_SOURCE_UNAVAILABLE");
    return this.enqueueSource(source, "manual_reprocess");
  }

  async enqueueEligibleIntelligenceCompletion(limit = 25): Promise<number> {
    const sources = await this.prisma.$queryRaw<EligibleSource[]>`
      SELECT DISTINCT ON (run."projectId") run."id", run."projectId", project."userId", run."sourceWindowEnd", run."processingVersion"
      FROM "IntelligenceRun" run
      INNER JOIN "Project" project ON project."id" = run."projectId"
      INNER JOIN "ConnectedRepository" repository ON repository."projectId" = project."id"
      INNER JOIN "GitHubConnection" connection ON connection."id" = repository."gitHubConnectionId"
      WHERE run."status" = 'succeeded' AND run."processingVersion" = ${this.intelligence.versions.processingVersion}
        AND repository."status" = 'active' AND connection."status" = 'active'
        AND run."id" = (SELECT latest."id" FROM "IntelligenceRun" latest
          WHERE latest."projectId" = run."projectId" AND latest."status" = 'succeeded'
            AND latest."processingVersion" = ${this.intelligence.versions.processingVersion}
          ORDER BY latest."finishedAt" DESC NULLS LAST, latest."id" DESC LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM "OpportunityRun" active WHERE active."projectId" = run."projectId"
          AND active."status" IN ('queued', 'running', 'failed_retryable'))
      ORDER BY run."projectId", run."finishedAt" DESC NULLS LAST, run."id" DESC LIMIT ${limit}
    `;
    let count = 0;
    for (const source of sources) {
      try { if ((await this.enqueueSource(source, "intelligence_completion")).status === "queued") count += 1; }
      catch (error) {
        if (error instanceof OpportunityRunError && error.failureCode === "OPPORTUNITY_RUN_ACTIVE_CONFLICT") continue;
        if (isUnique(error)) continue;
        throw error;
      }
    }
    return count;
  }

  async terminalizeStaleActiveRuns(): Promise<number> {
    const now = this.clock();
    return this.prisma.$executeRaw`
      UPDATE "OpportunityRun" AS run
      SET "status" = 'failed_terminal', "finishedAt" = ${now},
          "failureCode" = CASE WHEN run."processingVersion" <> ${this.processingIdentity.processingVersion}
            THEN 'OPPORTUNITY_CONFIGURATION_STALE' ELSE 'OPPORTUNITY_SOURCE_STALE' END,
          "retryAfterAt" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = ${now}
      WHERE (run."status" IN ('queued', 'failed_retryable')
          OR (run."status" = 'running' AND run."leaseExpiresAt" <= ${now}))
        AND (run."processingVersion" <> ${this.processingIdentity.processingVersion}
          OR NOT EXISTS (
            SELECT 1 FROM "IntelligenceRun" source
            INNER JOIN "Project" project ON project."id" = source."projectId"
            INNER JOIN "ConnectedRepository" repository ON repository."projectId" = project."id"
            INNER JOIN "GitHubConnection" connection ON connection."id" = repository."gitHubConnectionId"
            WHERE source."id" = run."sourceIntelligenceRunId" AND source."projectId" = run."projectId"
              AND source."status" = 'succeeded'
              AND source."processingVersion" = ${this.intelligence.versions.processingVersion}
              AND repository."status" = 'active' AND connection."status" = 'active'
              AND source."id" = (SELECT latest."id" FROM "IntelligenceRun" latest
                WHERE latest."projectId" = source."projectId" AND latest."status" = 'succeeded'
                  AND latest."processingVersion" = ${this.intelligence.versions.processingVersion}
                ORDER BY latest."finishedAt" DESC NULLS LAST, latest."id" DESC LIMIT 1)
          ))
    `;
  }

  async terminalizeStaleInputs(): Promise<number> {
    const now = this.clock();
    const rows = await this.prisma.opportunityRun.findMany({
      where: { status: { in: [...activeStatuses] }, processingVersion: this.processingIdentity.processingVersion },
      select: { id: true, projectId: true, expectedInputFingerprint: true, evaluationBoundary: true, project: { select: { userId: true } } },
      orderBy: [{ projectId: "asc" }, { queuedAt: "asc" }],
    });
    let count = 0;
    for (const row of rows) {
      let stale = false;
      try { stale = (await this.selector.select(row.project.userId, row.projectId, row.evaluationBoundary)).inputFingerprint !== row.expectedInputFingerprint; }
      catch { stale = true; }
      if (!stale) continue;
      const updated = await this.prisma.opportunityRun.updateMany({
        where: { id: row.id, processingVersion: this.processingIdentity.processingVersion,
          OR: [{ status: { in: ["queued", "failed_retryable"] } }, { status: "running", leaseExpiresAt: { lte: now } }] },
        data: { status: "failed_terminal", finishedAt: now, failureCode: "OPPORTUNITY_INPUT_STALE", retryAfterAt: null, leaseToken: null, leaseExpiresAt: null },
      });
      count += updated.count;
    }
    return count;
  }

  async requeueEligible(now: Date): Promise<void> {
    await this.prisma.opportunityRun.updateMany({
      where: { status: "failed_retryable", attemptCount: { lt: 3 }, processingVersion: this.processingIdentity.processingVersion,
        OR: [{ retryAfterAt: null }, { retryAfterAt: { lte: now } }] },
      data: { status: "queued", retryAfterAt: null, failureCode: null },
    });
  }

  async executeClaimed(opportunityRunId: string, leaseToken: string): Promise<void> {
    const run = await this.prisma.opportunityRun.findFirst({
      where: { id: opportunityRunId, leaseToken, status: "running" },
      select: { id: true, projectId: true, sourceIntelligenceRunId: true, processingVersion: true,
        expectedInputFingerprint: true, evaluationBoundary: true, project: { select: { userId: true, timezone: true } } },
    });
    if (!run) throw new OpportunityRunError("OPPORTUNITY_LEASE_LOST");
    if (run.processingVersion !== this.processingIdentity.processingVersion) throw new OpportunityRunError("OPPORTUNITY_CONFIGURATION_STALE");
    if (!(await this.isEligibleSource(run.sourceIntelligenceRunId, run.projectId))) throw new OpportunityRunError("OPPORTUNITY_SOURCE_STALE");

    await this.assertLease(run.id, leaseToken);
    const selection = await this.selector.select(run.project.userId, run.projectId, run.evaluationBoundary);
    if (selection.inputFingerprint !== run.expectedInputFingerprint) throw new OpportunityRunError("OPPORTUNITY_INPUT_STALE");
    await this.assertLease(run.id, leaseToken);

    let detection: OpportunityDetectionOutcome;
    try { detection = await this.detection.detect(run.project.userId, run.projectId, run.evaluationBoundary); }
    catch (error) {
      if (error instanceof OpportunityDetectionError) {
        if (error.failureCode === "AI_BUDGET_EXHAUSTED") {
          const retryAt = developerDayWindow(this.clock(), run.project.timezone).end;
          throw new OpportunityRunError("OPPORTUNITY_AI_BUDGET_DEFERRED", true, retryAt, { cause: error });
        }
        throw new OpportunityRunError(error.retryable ? "OPPORTUNITY_DETECTION_RETRYABLE_FAILURE" : "OPPORTUNITY_DETECTION_TERMINAL_FAILURE",
          error.retryable, error.retryAfterAt, { cause: error });
      }
      throw new OpportunityRunError("OPPORTUNITY_DETECTION_TERMINAL_FAILURE", false, null, { cause: error });
    }
    if (detection.inputFingerprint !== run.expectedInputFingerprint) throw new OpportunityRunError("OPPORTUNITY_INPUT_STALE");
    await this.assertLease(run.id, leaseToken);
    if (!(await this.isEligibleSource(run.sourceIntelligenceRunId, run.projectId))) throw new OpportunityRunError("OPPORTUNITY_SOURCE_STALE");

    let scored: Awaited<ReturnType<ContentOpportunityScoringService["scoreAndPersist"]>>;
    try {
      scored = await this.scoring.scoreAndPersist({
        userId: run.project.userId,
        projectId: run.projectId,
        aiExecutionId: detection.execution.aiExecutionId,
        task33InputFingerprint: run.expectedInputFingerprint,
        input: selection.input,
        task34: {
          extractionVersion: detection.execution.extractionVersion,
          detectorVersion: detection.execution.detectorVersion,
          modelConfigurationFingerprint: detection.execution.modelConfigurationFingerprint,
          promptVersion: detection.execution.promptVersion,
          schemaVersion: detection.execution.schemaVersion,
        },
      });
    } catch (error) {
      if (error instanceof ContentOpportunityScoringError) {
        const code = error.failureCode === "OPPORTUNITY_SCORING_INVARIANT_FAILED"
          ? "OPPORTUNITY_SCORING_INVARIANT_FAILED"
          : error.failureCode === "OPPORTUNITY_DETECTION_RESULT_INVALID"
            ? "OPPORTUNITY_DETECTION_RESULT_INVALID" : "OPPORTUNITY_INPUT_STALE";
        throw new OpportunityRunError(code, false, null, { cause: error });
      }
      if (isTransientDatabase(error)) throw new OpportunityRunError("OPPORTUNITY_SCORING_RETRYABLE_FAILURE", true, null, { cause: error });
      throw new OpportunityRunError("OPPORTUNITY_SCORING_TERMINAL_FAILURE", false, null, { cause: error });
    }
    await this.assertLease(run.id, leaseToken);
    const recommendedCount = scored.decisions.filter((decision) => decision.shouldPost).length;
    const suppressedCount = scored.decisions.length - recommendedCount;
    const updated = await this.prisma.opportunityRun.updateMany({
      where: { id: run.id, status: "running", leaseToken },
      data: {
        status: "succeeded", finishedAt: this.clock(), failureCode: null, retryAfterAt: null,
        leaseToken: null, leaseExpiresAt: null, candidateCount: detection.candidates.length,
        recommendedCount, suppressedCount, createdOpportunityCount: scored.createdOpportunityIds.length,
        reusedOpportunityCount: scored.reusedOpportunityIds.length,
      },
    });
    if (updated.count !== 1) throw new OpportunityRunError("OPPORTUNITY_LEASE_LOST");
    this.logger.info("opportunity_run_completed", {
      opportunityRunId: run.id, projectId: run.projectId, sourceIntelligenceRunId: run.sourceIntelligenceRunId,
      processingVersion: run.processingVersion, candidateCount: detection.candidates.length, recommendedCount,
      suppressedCount, createdOpportunityCount: scored.createdOpportunityIds.length,
      reusedOpportunityCount: scored.reusedOpportunityIds.length,
    });
  }

  async assertLease(id: string, leaseToken: string): Promise<void> {
    const found = await this.prisma.opportunityRun.findFirst({ where: { id, status: "running", leaseToken }, select: { id: true } });
    if (!found) throw new OpportunityRunError("OPPORTUNITY_LEASE_LOST");
  }

  async extendLease(id: string, leaseToken: string, now: Date, durationMs: number): Promise<void> {
    const result = await this.prisma.opportunityRun.updateMany({
      where: { id, status: "running", leaseToken }, data: { leaseExpiresAt: new Date(now.getTime() + durationMs) },
    });
    if (result.count !== 1) throw new OpportunityRunError("OPPORTUNITY_LEASE_LOST");
  }

  async failClaimed(run: { readonly id: string; readonly leaseToken: string; readonly attemptCount: number }, error: unknown, now: Date): Promise<void> {
    const failure = error instanceof OpportunityRunError
      ? error
      : isTransientDatabase(error)
        ? new OpportunityRunError("OPPORTUNITY_SCORING_RETRYABLE_FAILURE", true, null, { cause: error })
        : new OpportunityRunError("OPPORTUNITY_SCORING_TERMINAL_FAILURE", false, null, { cause: error });
    const retryable = failure.retryable && run.attemptCount < 3;
    const delay = new Date(now.getTime() + 60_000 * 2 ** Math.max(0, run.attemptCount - 1));
    const retryAfterAt = retryable ? (failure.retryAfterAt && failure.retryAfterAt > delay ? failure.retryAfterAt : delay) : null;
    const failureCode = retryable ? failure.failureCode : run.attemptCount >= 3 ? "OPPORTUNITY_RETRY_EXHAUSTED" : failure.failureCode;
    const updated = await this.prisma.opportunityRun.updateMany({
      where: { id: run.id, status: "running", leaseToken: run.leaseToken },
      data: { status: retryable ? "failed_retryable" : "failed_terminal", finishedAt: retryable ? null : now,
        failureCode, retryAfterAt, leaseToken: null, leaseExpiresAt: null },
    });
    if (updated.count !== 1) {
      this.logger.warnEvent("opportunity_run_lease_lost", { opportunityRunId: run.id, failureCode: "OPPORTUNITY_LEASE_LOST" });
      return;
    }
    this.logger[retryable ? "warnEvent" : "errorEvent"](retryable ? "opportunity_run_deferred" : "opportunity_run_failed", {
      opportunityRunId: run.id, attemptCount: run.attemptCount, failureCode,
      ...(retryAfterAt ? { retryAfterAt: retryAfterAt.toISOString() } : {}),
    });
  }

  async terminalizeExhausted(now: Date): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "OpportunityRun" SET "status" = 'failed_terminal', "finishedAt" = COALESCE("finishedAt", ${now}),
        "failureCode" = 'OPPORTUNITY_RETRY_EXHAUSTED', "retryAfterAt" = NULL,
        "leaseToken" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = ${now}
      WHERE "attemptCount" >= 3 AND ("status" = 'failed_retryable' OR ("status" = 'running' AND "leaseExpiresAt" <= ${now}))
    `;
  }

  async claimNext(now: Date, leaseDurationMs: number): Promise<{
    readonly opportunityRunId: string; readonly attemptCount: number; readonly leaseToken: string; readonly recovered: boolean;
  } | null> {
    const leaseToken = randomUUID();
    const expires = new Date(now.getTime() + leaseDurationMs);
    const rows = await this.prisma.$queryRaw<Array<{ opportunityRunId: string; attemptCount: number; leaseToken: string; recovered: boolean }>>`
      WITH candidate AS (
        SELECT run."id", (run."status" = 'running') AS "recovered"
        FROM "OpportunityRun" run
        WHERE (run."status" = 'queued' OR (run."status" = 'running' AND run."leaseExpiresAt" <= ${now}))
          AND run."attemptCount" < 3 AND run."processingVersion" = ${this.processingIdentity.processingVersion}
        ORDER BY CASE WHEN run."status" = 'running' THEN 0 ELSE 1 END, run."queuedAt", run."id"
        FOR UPDATE OF run SKIP LOCKED LIMIT 1
      )
      UPDATE "OpportunityRun" run
      SET "status" = 'running', "startedAt" = COALESCE(run."startedAt", ${now}), "finishedAt" = NULL,
        "failureCode" = NULL, "retryAfterAt" = NULL, "attemptCount" = run."attemptCount" + 1,
        "leaseToken" = ${leaseToken}::uuid, "leaseExpiresAt" = ${expires}, "updatedAt" = ${now}
      FROM candidate WHERE run."id" = candidate."id"
      RETURNING run."id" AS "opportunityRunId", run."attemptCount", run."leaseToken"::text AS "leaseToken", candidate."recovered"
    `;
    return rows[0] ?? null;
  }

  private async latestEligibleSource(projectId?: string, userId?: string): Promise<EligibleSource | null> {
    const rows = await this.prisma.$queryRaw<EligibleSource[]>`
      SELECT run."id", run."projectId", project."userId", run."sourceWindowEnd", run."processingVersion"
      FROM "IntelligenceRun" run
      INNER JOIN "Project" project ON project."id" = run."projectId"
      INNER JOIN "ConnectedRepository" repository ON repository."projectId" = project."id"
      INNER JOIN "GitHubConnection" connection ON connection."id" = repository."gitHubConnectionId"
      WHERE run."status" = 'succeeded' AND run."processingVersion" = ${this.intelligence.versions.processingVersion}
        AND repository."status" = 'active' AND connection."status" = 'active'
        AND (${projectId ?? null}::uuid IS NULL OR run."projectId" = ${projectId ?? null}::uuid)
        AND (${userId ?? null}::uuid IS NULL OR project."userId" = ${userId ?? null}::uuid)
        AND run."id" = (SELECT latest."id" FROM "IntelligenceRun" latest
          WHERE latest."projectId" = run."projectId" AND latest."status" = 'succeeded'
            AND latest."processingVersion" = ${this.intelligence.versions.processingVersion}
          ORDER BY latest."finishedAt" DESC NULLS LAST, latest."id" DESC LIMIT 1)
      ORDER BY run."finishedAt" DESC NULLS LAST, run."id" DESC LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async enqueueSource(source: EligibleSource, trigger: "intelligence_completion" | "manual_reprocess"): Promise<EnqueuedOpportunityRun> {
    const selection = await this.selector.select(source.userId, source.projectId, source.sourceWindowEnd);
    if (selection.input.projectId !== source.projectId || fingerprintPhase3OpportunityInput(selection.input) !== selection.inputFingerprint) {
      throw new OpportunityRunError("OPPORTUNITY_INPUT_STALE");
    }
    const runKey = sha256({ projectId: source.projectId, sourceIntelligenceRunId: source.id,
      inputFingerprint: selection.inputFingerprint, processingVersion: this.processingIdentity.processingVersion });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.findFirst({
          where: { id: source.projectId, userId: source.userId,
            connectedRepository: { is: { status: "active", gitHubConnection: { is: { status: "active" } } } } },
          select: { id: true },
        });
        if (!project) throw new OpportunityRunError("OPPORTUNITY_PROJECT_SOURCE_UNAVAILABLE");
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${source.projectId}::uuid FOR UPDATE`;
        if (!(await this.isEligibleSource(source.id, source.projectId, tx))) throw new OpportunityRunError("OPPORTUNITY_SOURCE_STALE");
        const existing = await tx.opportunityRun.findUnique({
          where: { projectId_runKey: { projectId: source.projectId, runKey } }, select: { id: true, runKey: true },
        });
        if (existing) return { opportunityRunId: existing.id, runKey: existing.runKey, status: "reused" };
        const active = await tx.opportunityRun.findFirst({
          where: { projectId: source.projectId, status: { in: [...activeStatuses] } }, select: { id: true },
        });
        if (active) throw new OpportunityRunError("OPPORTUNITY_RUN_ACTIVE_CONFLICT");
        const run = await tx.opportunityRun.create({
          data: {
            projectId: source.projectId, sourceIntelligenceRunId: source.id, trigger, runKey,
            processingVersion: this.processingIdentity.processingVersion,
            orchestrationVersion: this.processingIdentity.orchestrationVersion,
            inputSelectionVersion: this.processingIdentity.inputSelectionVersion,
            detectorVersion: this.processingIdentity.detectorVersion, extractionVersion: this.processingIdentity.extractionVersion,
            modelConfigurationFingerprint: this.processingIdentity.modelConfigurationFingerprint,
            scoringVersion: this.processingIdentity.scoringVersion, expectedInputFingerprint: selection.inputFingerprint,
            evaluationBoundary: source.sourceWindowEnd,
          }, select: { id: true, runKey: true },
        });
        this.logger.info("opportunity_run_queued", { opportunityRunId: run.id, projectId: source.projectId,
          sourceIntelligenceRunId: source.id, processingVersion: this.processingIdentity.processingVersion, trigger });
        return { opportunityRunId: run.id, runKey: run.runKey, status: "queued" };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isUnique(error)) {
        const existing = await this.prisma.opportunityRun.findUnique({
          where: { projectId_runKey: { projectId: source.projectId, runKey } }, select: { id: true, runKey: true },
        });
        if (existing) return { opportunityRunId: existing.id, runKey: existing.runKey, status: "reused" };
        throw new OpportunityRunError("OPPORTUNITY_RUN_ACTIVE_CONFLICT", false, null, { cause: error });
      }
      if (error instanceof OpportunityRunError) throw error;
      if (isTransientDatabase(error)) throw new OpportunityRunError("OPPORTUNITY_SCORING_RETRYABLE_FAILURE", true, null, { cause: error });
      if (errorCode(error) === "P2003" || errorCode(error) === "P2004") throw new OpportunityRunError("OPPORTUNITY_SOURCE_STALE", false, null, { cause: error });
      throw error;
    }
  }

  private async isEligibleSource(
    sourceId: string,
    projectId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma
  ): Promise<boolean> {
    const rows = await client.$queryRaw<Array<{ readonly id: string }>>`
      SELECT source."id" FROM "IntelligenceRun" source
      INNER JOIN "Project" project ON project."id" = source."projectId"
      INNER JOIN "ConnectedRepository" repository ON repository."projectId" = project."id"
      INNER JOIN "GitHubConnection" connection ON connection."id" = repository."gitHubConnectionId"
      WHERE source."id" = ${sourceId}::uuid AND source."projectId" = ${projectId}::uuid
        AND source."status" = 'succeeded'
        AND source."processingVersion" = ${this.intelligence.versions.processingVersion}
        AND repository."status" = 'active' AND connection."status" = 'active'
        AND source."id" = (SELECT latest."id" FROM "IntelligenceRun" latest
          WHERE latest."projectId" = source."projectId" AND latest."status" = 'succeeded'
            AND latest."processingVersion" = ${this.intelligence.versions.processingVersion}
          ORDER BY latest."finishedAt" DESC NULLS LAST, latest."id" DESC LIMIT 1)
    `;
    return rows.length === 1;
  }
}
