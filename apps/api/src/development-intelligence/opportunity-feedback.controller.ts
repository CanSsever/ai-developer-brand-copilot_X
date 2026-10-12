import { BadRequestException, Body, Controller, Headers, Param, Post, UseGuards } from "@nestjs/common";
import type { OpportunityFeedbackMutationRequest } from "@developer-brand-copilot/contracts";
import { BearerAuthGuard } from "../auth/bearer-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import {
  OpportunityFeedbackService,
  parseOpportunityFeedbackRequest,
  validateOpportunityFeedbackIdempotencyKey,
} from "./opportunity-feedback.service";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller()
@UseGuards(BearerAuthGuard)
export class OpportunityFeedbackController {
  constructor(private readonly feedback: OpportunityFeedbackService) {}

  @Post("projects/:projectId/opportunities/:opportunityId/feedback")
  recordFeedback(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("opportunityId") opportunityId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(projectId) || !uuidPattern.test(opportunityId)) {
      throw new BadRequestException("Invalid feedback target");
    }
    const request: OpportunityFeedbackMutationRequest = parseOpportunityFeedbackRequest(body);
    const validatedKey = validateOpportunityFeedbackIdempotencyKey(idempotencyKey);
    return this.feedback.record(user.id, projectId, opportunityId, request, validatedKey);
  }
}
