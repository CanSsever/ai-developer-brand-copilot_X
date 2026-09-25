import { BadRequestException, Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import type { ContentOpportunityListRequest } from "@developer-brand-copilot/contracts";
import { BearerAuthGuard } from "../auth/bearer-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { OpportunityReadService } from "./opportunity-read.service";

function parseListRequest(query: Record<string, unknown>): ContentOpportunityListRequest {
  let limit: number | undefined;
  if (query.limit !== undefined) {
    if (typeof query.limit !== "string" || !/^\d{1,3}$/.test(query.limit)) {
      throw new BadRequestException("Invalid pagination limit");
    }
    limit = Number(query.limit);
  }
  if (query.cursor !== undefined && typeof query.cursor !== "string") {
    throw new BadRequestException("Invalid cursor");
  }
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor as string }),
  };
}

@Controller()
@UseGuards(BearerAuthGuard)
export class OpportunityReadController {
  constructor(private readonly opportunities: OpportunityReadService) {}

  @Get("projects/:projectId/opportunities")
  listProjectOpportunities(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query() query: Record<string, unknown>
  ) {
    return this.opportunities.listForProject(user.id, projectId, parseListRequest(query));
  }
}
