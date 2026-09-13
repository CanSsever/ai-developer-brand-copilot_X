import { Inject, Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_AUTH_CONFIG } from "./auth.tokens";
import type {
  AuthClaimsVerifier,
  SupabaseAuthConfig,
  VerifiedAccessTokenClaims,
} from "./auth.types";

@Injectable()
export class SupabaseClaimsVerifier implements AuthClaimsVerifier {
  private readonly client: SupabaseClient;

  constructor(
    @Inject(SUPABASE_AUTH_CONFIG) config: SupabaseAuthConfig
  ) {
    this.client = createClient(config.url, config.publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }

  async verifyAccessToken(token: string): Promise<VerifiedAccessTokenClaims> {
    const { data, error } = await this.client.auth.getClaims(token);

    if (error || !data?.claims) {
      throw new Error("Access token verification failed");
    }

    return data.claims;
  }
}
