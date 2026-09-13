import { Controller, Get, UseGuards } from "@nestjs/common";
import type { AuthenticatedUserResponse } from "@developer-brand-copilot/contracts";

import { BearerAuthGuard } from "./bearer-auth.guard";
import { CurrentUser } from "./current-user.decorator";
import type { AuthenticatedUser } from "./auth.types";

@Controller("auth")
@UseGuards(BearerAuthGuard)
export class AuthController {
  @Get("me")
  getMe(@CurrentUser() user: AuthenticatedUser): AuthenticatedUserResponse {
    return { id: user.id };
  }
}
