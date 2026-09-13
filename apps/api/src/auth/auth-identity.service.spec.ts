import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AuthIdentityService } from "./auth-identity.service";
import type { AuthClaimsVerifier, VerifiedAccessTokenClaims } from "./auth.types";

const subject = "123e4567-e89b-42d3-a456-426614174000";
const config = {
  url: "https://project-ref.supabase.co",
  publishableKey: "sb_publishable_safe_example_key",
};

function createService(claims: VerifiedAccessTokenClaims) {
  const verifier: AuthClaimsVerifier = {
    verifyAccessToken: vi.fn().mockResolvedValue(claims),
  };

  return { service: new AuthIdentityService(verifier, config), verifier };
}

describe("AuthIdentityService", () => {
  it("propagates a subject only after required claims are valid", async () => {
    const { service, verifier } = createService({
      iss: `${config.url}/auth/v1`,
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 60,
      sub: subject,
    });

    await expect(service.authenticate("valid-token")).resolves.toEqual({
      subject,
    });
    expect(verifier.verifyAccessToken).toHaveBeenCalledWith("valid-token");
  });

  it.each([
    { name: "issuer", claims: { iss: "https://attacker.test/auth/v1" } },
    { name: "audience", claims: { aud: "anon" } },
    { name: "expiry", claims: { exp: 1 } },
    { name: "subject", claims: { sub: "not-a-uuid" } },
  ])("rejects an invalid $name claim", async ({ claims }) => {
    const { service } = createService({
      iss: `${config.url}/auth/v1`,
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 60,
      sub: subject,
      ...claims,
    });

    await expect(service.authenticate("invalid-token")).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it("maps cryptographic verification failures to a controlled 401", async () => {
    const verifier: AuthClaimsVerifier = {
      verifyAccessToken: vi.fn().mockRejectedValue(new Error("invalid signature")),
    };
    const service = new AuthIdentityService(verifier, config);

    await expect(service.authenticate("invalid-token")).rejects.toMatchObject({
      message: "Authentication required",
    });
  });
});
