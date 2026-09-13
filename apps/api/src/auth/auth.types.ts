export interface AuthenticatedUser {
  readonly id: string;
}

export interface AuthenticatedRequest {
  readonly headers: {
    readonly authorization?: string | string[];
  };
  authenticatedUser?: AuthenticatedUser;
}

export interface VerifiedAccessTokenClaims {
  readonly aud?: unknown;
  readonly exp?: unknown;
  readonly iss?: unknown;
  readonly role?: unknown;
  readonly sub?: unknown;
}

export interface AuthClaimsVerifier {
  verifyAccessToken(token: string): Promise<VerifiedAccessTokenClaims>;
}

export interface SupabaseAuthConfig {
  readonly url: string;
  readonly publishableKey: string;
}
