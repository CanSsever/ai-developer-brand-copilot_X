import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";

import { AUTH_CLAIMS_VERIFIER, SUPABASE_AUTH_CONFIG } from "./auth.tokens";
import type {
  AuthClaimsVerifier,
  SupabaseAuthConfig,
  VerifiedAccessTokenClaims,
} from "./auth.types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthIdentityService {
  constructor(
    @Inject(AUTH_CLAIMS_VERIFIER)
    private readonly verifier: AuthClaimsVerifier,
    @Inject(SUPABASE_AUTH_CONFIG)
    private readonly config: SupabaseAuthConfig
  ) {}

  async authenticate(token: string): Promise<{ readonly subject: string }> {
    let claims: VerifiedAccessTokenClaims;

    try {
      claims = await this.verifier.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException("Authentication required");
    }

    if (!this.areClaimsValid(claims)) {
      throw new UnauthorizedException("Authentication required");
    }

    return { subject: claims.sub };
  }

  private areClaimsValid(
    claims: VerifiedAccessTokenClaims
  ): claims is VerifiedAccessTokenClaims & { readonly sub: string } {
    const expectedIssuer = `${this.config.url.replace(/\/$/, "")}/auth/v1`;
    const audience = claims.aud;
    const hasAuthenticatedAudience =
      audience === "authenticated" ||
      (Array.isArray(audience) && audience.includes("authenticated"));

    return (
      claims.iss === expectedIssuer &&
      hasAuthenticatedAudience &&
      typeof claims.exp === "number" &&
      claims.exp > Math.floor(Date.now() / 1000) &&
      typeof claims.sub === "string" &&
      uuidPattern.test(claims.sub)
    );
  }
}
