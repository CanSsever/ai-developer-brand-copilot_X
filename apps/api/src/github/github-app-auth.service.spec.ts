import { generateKeyPairSync, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import { GitHubAppAuthService } from "./github-app-auth.service";

describe("GitHubAppAuthService", () => {
  it("creates a short-lived RS256 GitHub App JWT with the configured client ID", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const service = new GitHubAppAuthService({
      callbackUrl: "http://localhost:3000/github/callback",
      clientId: "Iv1.safe-test-client",
      clientSecret: "safe-test-client-secret-value",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      slug: "safe-test-app",
    });
    const now = new Date("2026-09-15T20:00:00.000Z");
    const token = service.createAppJwt(now);
    const [headerPart, payloadPart, signaturePart] = token.split(".");
    const header = JSON.parse(Buffer.from(headerPart!, "base64url").toString());
    const payload = JSON.parse(Buffer.from(payloadPart!, "base64url").toString());

    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload).toEqual({
      iat: Math.floor(now.getTime() / 1000) - 60,
      exp: Math.floor(now.getTime() / 1000) + 9 * 60,
      iss: "Iv1.safe-test-client",
    });
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${headerPart}.${payloadPart}`),
        publicKey,
        Buffer.from(signaturePart!, "base64url")
      )
    ).toBe(true);
  });
});
