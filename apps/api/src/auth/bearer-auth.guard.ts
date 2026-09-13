import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

import { AuthIdentityService } from "./auth-identity.service";
import type { AuthenticatedRequest } from "./auth.types";
import { UserIdentityService } from "./user-identity.service";

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(
    private readonly authIdentity: AuthIdentityService,
    private readonly userIdentity: UserIdentityService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException("Authentication required");
    }

    const identity = await this.authIdentity.authenticate(token);
    request.authenticatedUser = await this.userIdentity.resolve(identity.subject);

    return true;
  }

  private extractBearerToken(header: string | string[] | undefined): string | null {
    if (typeof header !== "string") {
      return null;
    }

    const match = /^Bearer ([^\s]+)$/i.exec(header);

    return match?.[1] ?? null;
  }
}
