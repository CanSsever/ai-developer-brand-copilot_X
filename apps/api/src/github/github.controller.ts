import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type {
  ConnectRepositoryRequest,
  CreateProjectRequest,
  GitHubConnectionCompleteRequest,
  GitHubConnectionStartRequest,
} from "@developer-brand-copilot/contracts";

import { BearerAuthGuard } from "../auth/bearer-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { GitHubConnectionService } from "./github-connection.service";

@Controller()
@UseGuards(BearerAuthGuard)
export class GitHubController {
  constructor(private readonly connections: GitHubConnectionService) {}

  @Get("projects")
  listProjects(@CurrentUser() user: AuthenticatedUser) {
    return this.connections.listProjects(user.id);
  }

  @Post("projects")
  createProject(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Partial<CreateProjectRequest>
  ) {
    return this.connections.createProject(user.id, body?.timezone);
  }

  @Get("github/connections")
  listConnections(@CurrentUser() user: AuthenticatedUser) {
    return this.connections.listConnections(user.id);
  }

  @Post("github/connections/start")
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Partial<GitHubConnectionStartRequest>
  ) {
    return this.connections.start(user.id, body?.projectId);
  }

  @Post("github/connections/complete")
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Partial<GitHubConnectionCompleteRequest>
  ) {
    return this.connections.complete(user.id, body);
  }

  @Get("github/connections/:connectionId/repositories")
  listAuthorizedRepositories(
    @CurrentUser() user: AuthenticatedUser,
    @Param("connectionId") connectionId: string,
    @Query("projectId") projectId: string
  ) {
    return this.connections.listAuthorizedRepositories(
      user.id,
      connectionId,
      projectId
    );
  }

  @Post("github/repositories")
  connectRepository(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Partial<ConnectRepositoryRequest>
  ) {
    return this.connections.connectRepository(user.id, body);
  }

  @Delete("github/connections/:connectionId")
  disconnect(
    @CurrentUser() user: AuthenticatedUser,
    @Param("connectionId") connectionId: string
  ) {
    return this.connections.disconnectConnection(user.id, connectionId);
  }
}
