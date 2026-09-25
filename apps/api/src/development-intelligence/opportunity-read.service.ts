import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import type {
  ContentOpportunityCard, ContentOpportunityListRequest, ContentOpportunityListResponse,
  ContentOpportunityReasonSignalRead, OpportunityProcessingStatus, OpportunityProcessingSummary,
} from "@developer-brand-copilot/contracts";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../database/prisma.service";
import { StructuredLogger } from "../observability/structured-logger";
import { OpportunityRunService } from "./opportunity-run.service";

export const opportunityListDefaultLimit = 10;
export const opportunityListMaximumLimit = 25;
export const opportunityCursorVersion = 1;
export const opportunityProvenanceMaximum = 20;
export const opportunityReasonSignalMaximum = 11;
const cursorMaximumCharacters = 1_024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const candidateKeyPattern = /^[0-9a-f]{64}$/;

interface OpportunityCursor {
  readonly version: 1;
  readonly projectId: string;
  readonly priorityScore: number;
  readonly confidence: number;
  readonly noveltyScore: number;
  readonly candidateKey: string;
  readonly id: string;
}

function invalidCursor(): never { throw new BadRequestException("Invalid cursor"); }
function validScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 &&
    Math.abs(value * 1_000 - Math.round(value * 1_000)) < 1e-8;
}
function encodeCursor(cursor: OpportunityCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}
function decodeCursor(value: unknown, projectId: string): OpportunityCursor | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > cursorMaximumCharacters || !/^[A-Za-z0-9_-]+$/.test(value)) return invalidCursor();
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return invalidCursor();
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return invalidCursor();
    const record = parsed as Record<string, unknown>;
    const keys = ["version", "projectId", "priorityScore", "confidence", "noveltyScore", "candidateKey", "id"];
    if (Object.keys(record).join("|") !== keys.join("|") || record.version !== opportunityCursorVersion || record.projectId !== projectId ||
      !validScore(record.priorityScore) || !validScore(record.confidence) || !validScore(record.noveltyScore) ||
      typeof record.candidateKey !== "string" || !candidateKeyPattern.test(record.candidateKey) ||
      typeof record.id !== "string" || !uuidPattern.test(record.id)) return invalidCursor();
    const cursor: OpportunityCursor = {
      version: 1, projectId: record.projectId, priorityScore: record.priorityScore,
      confidence: record.confidence, noveltyScore: record.noveltyScore, candidateKey: record.candidateKey, id: record.id,
    };
    if (JSON.stringify(cursor) !== json) return invalidCursor();
    return cursor;
  } catch { return invalidCursor(); }
}
function opportunityStatusMessage(status: OpportunityProcessingStatus): string {
  switch (status) {
    case "queued": return "Content opportunity analysis is queued.";
    case "running": return "Content opportunity analysis is in progress.";
    case "succeeded": return "Content opportunity analysis is up to date.";
    case "failed_retryable": return "Content opportunity analysis is temporarily delayed and will retry automatically.";
    case "failed_terminal": return "Content opportunities could not be updated.";
  }
}
function safeProcessing(run: {
  readonly status: OpportunityProcessingStatus; readonly queuedAt: Date; readonly startedAt: Date | null;
  readonly finishedAt: Date | null; readonly retryAfterAt: Date | null; readonly processingVersion: string;
  readonly candidateCount: number; readonly recommendedCount: number; readonly suppressedCount: number;
} | null): OpportunityProcessingSummary | null {
  if (!run) return null;
  return {
    status: run.status, statusMessage: opportunityStatusMessage(run.status), queuedAt: run.queuedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null, finishedAt: run.finishedAt?.toISOString() ?? null,
    retryAfterAt: run.retryAfterAt?.toISOString() ?? null, processingVersion: run.processingVersion,
    candidateCount: run.candidateCount, recommendedCount: run.recommendedCount, suppressedCount: run.suppressedCount,
  };
}
function invalidPersistedOpportunity(): never {
  throw new InternalServerErrorException("Content opportunities are temporarily unavailable.");
}

@Injectable()
export class OpportunityReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: OpportunityRunService,
    private readonly logger: StructuredLogger
  ) {}

  async listForProject(userId: string, projectId: string, request: ContentOpportunityListRequest = {}): Promise<ContentOpportunityListResponse> {
    if (!uuidPattern.test(projectId)) throw new NotFoundException("Project not found");
    const limit = request.limit ?? opportunityListDefaultLimit;
    if (!Number.isInteger(limit) || limit < 1 || limit > opportunityListMaximumLimit) throw new BadRequestException("Invalid pagination limit");
    const project = await this.prisma.project.findFirst({ where: { id: projectId, userId }, select: { id: true } });
    if (!project) throw new NotFoundException("Project not found");
    const cursor = decodeCursor(request.cursor, project.id);
    const cursorWhere: Prisma.ContentOpportunityWhereInput | undefined = cursor ? {
      OR: [
        { priorityScore: { lt: cursor.priorityScore } },
        { priorityScore: cursor.priorityScore, confidence: { lt: cursor.confidence } },
        { priorityScore: cursor.priorityScore, confidence: cursor.confidence, noveltyScore: { lt: cursor.noveltyScore } },
        { priorityScore: cursor.priorityScore, confidence: cursor.confidence, noveltyScore: cursor.noveltyScore, candidateKey: { gt: cursor.candidateKey } },
        { priorityScore: cursor.priorityScore, confidence: cursor.confidence, noveltyScore: cursor.noveltyScore, candidateKey: cursor.candidateKey, id: { gt: cursor.id } },
      ],
    } : undefined;

    const [rows, run] = await Promise.all([
      this.prisma.contentOpportunity.findMany({
        where: { projectId: project.id, isCurrent: true, status: "recommended", shouldPost: true, expiredAt: null, ...(cursorWhere ?? {}) },
        orderBy: [
          { priorityScore: "desc" }, { confidence: "desc" }, { noveltyScore: "desc" },
          { candidateKey: "asc" }, { id: "asc" },
        ],
        take: limit + 1,
        select: {
          candidateKey: true, confidence: true, createdAt: true, id: true, noveltyScore: true,
          opportunityType: true, priorityScore: true, recommendedFormat: true, scoringVersion: true, title: true,
          developmentEvents: {
            orderBy: { developmentEventId: "asc" }, take: opportunityProvenanceMaximum + 1,
            select: { developmentEvent: { select: { id: true, projectId: true, occurredAt: true, title: true, type: true } } },
          },
          reasonSignals: {
            orderBy: { position: "asc" }, take: opportunityReasonSignalMaximum + 1,
            select: {
              code: true, effect: true, position: true, value: true,
              developmentEvents: {
                orderBy: { developmentEventId: "asc" }, take: opportunityProvenanceMaximum + 1,
                select: { developmentEvent: { select: { id: true, projectId: true } } },
              },
            },
          },
        },
      }),
      this.prisma.opportunityRun.findFirst({
        where: { projectId: project.id, processingVersion: this.runs.processingIdentity.processingVersion },
        orderBy: [{ queuedAt: "desc" }, { id: "desc" }],
        select: {
          status: true, queuedAt: true, startedAt: true, finishedAt: true, retryAfterAt: true,
          processingVersion: true, candidateCount: true, recommendedCount: true, suppressedCount: true,
        },
      }),
    ]);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map((row): ContentOpportunityCard => {
      if (row.developmentEvents.length < 1 || row.developmentEvents.length > opportunityProvenanceMaximum || row.reasonSignals.length > opportunityReasonSignalMaximum) return invalidPersistedOpportunity();
      const developmentEvents = row.developmentEvents.map(({ developmentEvent }) => {
        if (developmentEvent.projectId !== project.id) return invalidPersistedOpportunity();
        return {
          developmentEventId: developmentEvent.id, type: developmentEvent.type,
          title: developmentEvent.title, occurredAt: developmentEvent.occurredAt.toISOString(),
        };
      });
      const provenanceIds = new Set(developmentEvents.map((event) => event.developmentEventId));
      if (provenanceIds.size !== developmentEvents.length) return invalidPersistedOpportunity();
      const reasonSignals: ContentOpportunityReasonSignalRead[] = row.reasonSignals.slice()
        .sort((left, right) => left.position - right.position).map((signal) => {
          if (signal.developmentEvents.length > opportunityProvenanceMaximum) return invalidPersistedOpportunity();
          const developmentEventIds = signal.developmentEvents.map(({ developmentEvent }) => {
            if (developmentEvent.projectId !== project.id || !provenanceIds.has(developmentEvent.id)) return invalidPersistedOpportunity();
            return developmentEvent.id;
          });
          if (new Set(developmentEventIds).size !== developmentEventIds.length) return invalidPersistedOpportunity();
          return { code: signal.code, effect: signal.effect, value: signal.value === null ? null : Number(signal.value), developmentEventIds };
        });
      return {
        id: row.id, title: row.title, opportunityType: row.opportunityType, recommendedFormat: row.recommendedFormat,
        priorityScore: Number(row.priorityScore), noveltyScore: Number(row.noveltyScore), confidence: Number(row.confidence),
        scoringVersion: row.scoringVersion, createdAt: row.createdAt.toISOString(), reasonSignals, developmentEvents,
      };
    });
    const last = hasMore ? page.at(-1) : undefined;
    const nextCursor = last ? encodeCursor({
      version: 1, projectId: project.id, priorityScore: Number(last.priorityScore), confidence: Number(last.confidence),
      noveltyScore: Number(last.noveltyScore), candidateKey: last.candidateKey, id: last.id,
    }) : null;
    const response: ContentOpportunityListResponse = { projectId: project.id, items, nextCursor, processing: safeProcessing(run) };
    this.logger.info("content_opportunities_read", {
      opportunityCount: response.items.length, processingStatus: response.processing?.status ?? "not_started",
      projectId: response.projectId,
    });
    return response;
  }
}
