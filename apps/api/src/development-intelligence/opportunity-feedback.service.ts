import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  OpportunityFeedbackAction,
  OpportunityFeedbackDismissReason,
  OpportunityFeedbackMutationRequest,
  OpportunityFeedbackResponse,
} from "@developer-brand-copilot/contracts";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../database/prisma.service";

export const opportunityFeedbackContractVersion = "phase3-opportunity-feedback-v1";
export const opportunityFeedbackIdempotencyKeyMaximumLength = 128;
export const opportunityFeedbackTransactionAttempts = 3;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions = new Set<OpportunityFeedbackAction>(["accepted", "dismissed"]);
const reasons = new Set<OpportunityFeedbackDismissReason>([
  "not_relevant", "repetitive", "too_minor", "sensitive", "other",
]);

export interface NormalizedOpportunityFeedbackRequest {
  readonly action: OpportunityFeedbackAction;
  readonly reason: OpportunityFeedbackDismissReason | null;
}

export function parseOpportunityFeedbackRequest(value: unknown): NormalizedOpportunityFeedbackRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("Invalid opportunity feedback request");
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "action" && key !== "reason")) {
    throw new BadRequestException("Invalid opportunity feedback request");
  }
  if (typeof body.action !== "string" || !actions.has(body.action as OpportunityFeedbackAction)) {
    throw new BadRequestException("Invalid opportunity feedback action");
  }
  const reason = body.reason === undefined ? null : body.reason;
  if (reason !== null && (typeof reason !== "string" || !reasons.has(reason as OpportunityFeedbackDismissReason))) {
    throw new BadRequestException("Invalid opportunity feedback reason");
  }
  if (body.action === "accepted" && reason !== null) {
    throw new BadRequestException("Accepted feedback cannot include a dismissal reason");
  }
  return { action: body.action as OpportunityFeedbackAction, reason: reason as OpportunityFeedbackDismissReason | null };
}

export function validateOpportunityFeedbackIdempotencyKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > opportunityFeedbackIdempotencyKeyMaximumLength ||
    value.trim().length === 0 ||
    value.split("").some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new BadRequestException("Invalid Idempotency-Key");
  }
  return value;
}

export function opportunityFeedbackIdempotencyHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function opportunityFeedbackRequestFingerprint(
  userId: string,
  projectId: string,
  opportunityId: string,
  request: NormalizedOpportunityFeedbackRequest,
): string {
  const canonical = {
    contractVersion: opportunityFeedbackContractVersion,
    userId: userId.toLowerCase(),
    projectId: projectId.toLowerCase(),
    opportunityId: opportunityId.toLowerCase(),
    action: request.action,
    reason: request.reason,
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function knownPrismaCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function idempotencyConflict(): ConflictException {
  return new ConflictException({
    code: "FEEDBACK_IDEMPOTENCY_CONFLICT",
    message: "The idempotency key was already used for a different feedback request.",
  });
}

function notActionable(): ConflictException {
  return new ConflictException({
    code: "FEEDBACK_NOT_ACTIONABLE",
    message: "This opportunity is no longer actionable.",
  });
}

function safeResponse(row: {
  readonly id: string;
  readonly opportunityId: string;
  readonly action: OpportunityFeedbackAction;
  readonly reason: OpportunityFeedbackDismissReason | null;
  readonly createdAt: Date;
  readonly isCurrent: boolean;
}): OpportunityFeedbackResponse {
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    action: row.action,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    isCurrent: row.isCurrent,
  };
}

@Injectable()
export class OpportunityFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    authenticatedUserId: string,
    projectId: string,
    opportunityId: string,
    request: OpportunityFeedbackMutationRequest,
    rawIdempotencyKey: string,
  ): Promise<OpportunityFeedbackResponse> {
    if (!uuidPattern.test(authenticatedUserId) || !uuidPattern.test(projectId) || !uuidPattern.test(opportunityId)) {
      throw new NotFoundException("Opportunity not found");
    }
    const normalized = parseOpportunityFeedbackRequest(request);
    const idempotencyKey = validateOpportunityFeedbackIdempotencyKey(rawIdempotencyKey);
    const userId = authenticatedUserId.toLowerCase();
    const normalizedProjectId = projectId.toLowerCase();
    const normalizedOpportunityId = opportunityId.toLowerCase();
    const idempotencyKeyHash = opportunityFeedbackIdempotencyHash(idempotencyKey);
    const requestFingerprint = opportunityFeedbackRequestFingerprint(
      userId, normalizedProjectId, normalizedOpportunityId, normalized,
    );

    for (let attempt = 0; attempt < opportunityFeedbackTransactionAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (transaction) => {
          const project = await transaction.project.findFirst({
            where: { id: normalizedProjectId, userId },
            select: { id: true },
          });
          if (!project) throw new NotFoundException("Project not found");

          // Task 3.5 locks Project before expiring/replacing opportunities. Use the same
          // root lock order, then lock the exact card row so stale clicks serialize safely.
          const lockedProject = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM public."Project"
            WHERE "id" = ${normalizedProjectId}::uuid AND "userId" = ${userId}::uuid
            FOR UPDATE
          `;
          if (lockedProject.length !== 1) throw new NotFoundException("Project not found");
          const lockedOpportunity = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM public."ContentOpportunity"
            WHERE "id" = ${normalizedOpportunityId}::uuid
              AND "projectId" = ${normalizedProjectId}::uuid
            FOR UPDATE
          `;
          if (lockedOpportunity.length !== 1) throw new NotFoundException("Opportunity not found");

          const replay = await transaction.opportunityFeedback.findFirst({
            where: { userId, idempotencyKeyHash },
            select: {
              id: true, opportunityId: true, requestFingerprint: true,
              action: true, reason: true, createdAt: true, isCurrent: true,
            },
          });
          if (replay) {
            if (replay.requestFingerprint !== requestFingerprint) throw idempotencyConflict();
            return safeResponse(replay);
          }

          const actionable = await transaction.contentOpportunity.findFirst({
            where: {
              id: normalizedOpportunityId,
              projectId: normalizedProjectId,
              isCurrent: true,
              status: "recommended",
              shouldPost: true,
              expiredAt: null,
            },
            select: { id: true },
          });
          if (!actionable) throw notActionable();

          const current = await transaction.opportunityFeedback.findMany({
            where: { userId, opportunityId: normalizedOpportunityId, isCurrent: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 2,
            select: { id: true },
          });
          if (current.length > 1) {
            throw new InternalServerErrorException("Opportunity feedback is temporarily unavailable.");
          }
          if (current[0]) {
            const supersededAt = new Date();
            const update = await transaction.opportunityFeedback.updateMany({
              where: { id: current[0].id, isCurrent: true, supersededAt: null },
              data: { isCurrent: false, supersededAt },
            });
            if (update.count !== 1) throw notActionable();
          }

          const created = await transaction.opportunityFeedback.create({
            data: {
              userId,
              opportunityId: normalizedOpportunityId,
              action: normalized.action,
              reason: normalized.reason,
              isCurrent: true,
              idempotencyKeyHash,
              requestFingerprint,
            },
            select: { id: true, opportunityId: true, action: true, reason: true, createdAt: true, isCurrent: true },
          });
          return safeResponse(created);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (error instanceof ConflictException || error instanceof NotFoundException ||
          error instanceof BadRequestException || error instanceof InternalServerErrorException) {
          throw error;
        }
        const code = knownPrismaCode(error);
        if (code === "P2034" && attempt + 1 < opportunityFeedbackTransactionAttempts) continue;
        if (code === "P2002") {
          const prior = await this.prisma.opportunityFeedback.findFirst({
            where: { userId, idempotencyKeyHash },
            select: {
              id: true, opportunityId: true, requestFingerprint: true,
              action: true, reason: true, createdAt: true, isCurrent: true,
            },
          });
          if (prior) {
            if (prior.requestFingerprint !== requestFingerprint) throw idempotencyConflict();
            return safeResponse(prior);
          }
          throw new ConflictException({
            code: "FEEDBACK_CONCURRENT_CONFLICT",
            message: "The feedback decision changed concurrently. Try again.",
          });
        }
        if (code === "P2034") {
          throw new ConflictException({
            code: "FEEDBACK_CONCURRENT_CONFLICT",
            message: "The feedback decision changed concurrently. Try again.",
          });
        }
        throw error;
      }
    }
    throw new ConflictException({
      code: "FEEDBACK_CONCURRENT_CONFLICT",
      message: "The feedback decision changed concurrently. Try again.",
    });
  }
}
