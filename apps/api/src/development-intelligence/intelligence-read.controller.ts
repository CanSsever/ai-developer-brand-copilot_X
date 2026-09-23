import { Controller, Get, Param, UseGuards } from "@nestjs/common";

import { BearerAuthGuard } from "../auth/bearer-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { DailyDevelopmentSummaryService } from "./daily-development-summary.service";
import { IntelligenceReadService } from "./intelligence-read.service";

@Controller()
@UseGuards(BearerAuthGuard)
export class IntelligenceReadController {
  constructor(
    private readonly intelligence: IntelligenceReadService,
    private readonly dailySummaries: DailyDevelopmentSummaryService
  ) {}

  @Get("projects/:projectId/intelligence")
  getProjectIntelligence(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string
  ) {
    return this.intelligence.getProjectIntelligence(user.id, projectId);
  }

  @Get("projects/:projectId/daily-summaries/today")
  getTodaySummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string
  ) {
    return this.dailySummaries.getToday(user.id, projectId);
  }
}
