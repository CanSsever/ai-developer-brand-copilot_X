import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller";
import { AuthIdentityService } from "./auth-identity.service";
import { AUTH_CLAIMS_VERIFIER, SUPABASE_AUTH_CONFIG } from "./auth.tokens";
import type { SupabaseAuthConfig } from "./auth.types";
import { BearerAuthGuard } from "./bearer-auth.guard";
import { SupabaseClaimsVerifier } from "./supabase-claims.verifier";
import { UserIdentityService } from "./user-identity.service";

@Module({})
export class AuthModule {
  static register(config: SupabaseAuthConfig): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        {
          provide: SUPABASE_AUTH_CONFIG,
          useValue: config,
        },
        {
          provide: AUTH_CLAIMS_VERIFIER,
          useClass: SupabaseClaimsVerifier,
        },
        AuthIdentityService,
        UserIdentityService,
        BearerAuthGuard,
      ],
    };
  }
}
