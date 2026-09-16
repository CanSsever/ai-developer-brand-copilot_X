import { describe, expect, it } from "vitest";

import { REDACTED_VALUE, redact } from "./redaction";
import { StructuredLogger } from "./structured-logger";

describe("observability redaction", () => {
  it("recursively redacts sensitive metadata without mutating the input", () => {
    const input = {
      authorization: "Bearer synthetic-authorization-value",
      nested: {
        cookie: "session=synthetic-cookie-value",
        access_token: "synthetic-access-value",
        refreshToken: "synthetic-refresh-value",
        id_token: "synthetic-id-value",
        client_secret: "synthetic-client-secret",
        private_key: "synthetic-private-key",
        password: "synthetic-password",
        DATABASE_URL: "postgresql://synthetic:credential@localhost/app",
        DIRECT_URL: "postgresql://synthetic:credential@localhost/app",
        githubOAuthCode: "synthetic-oauth-code",
        code: "synthetic-callback-code",
        installationToken: "synthetic-installation-token",
        safe: "retained",
      },
    };

    const result = redact(input) as Record<string, unknown>;
    const serialized = JSON.stringify(result);

    expect(result.authorization).toBe(REDACTED_VALUE);
    expect(serialized).not.toContain("synthetic-authorization-value");
    expect(serialized).not.toContain("synthetic-cookie-value");
    expect(serialized).not.toContain("synthetic-access-value");
    expect(serialized).not.toContain("synthetic-oauth-code");
    expect(serialized).not.toContain("synthetic-callback-code");
    expect(serialized).not.toContain("credential");
    expect(serialized).toContain("retained");
    expect(input.nested.access_token).toBe("synthetic-access-value");
  });

  it("sanitizes common secret representations embedded in log strings", () => {
    const result = redact(
      "Bearer synthetic.jwt.value postgresql://user:password@localhost/app " +
        "ghu_123456789012345678901234567890"
    );

    expect(result).not.toContain("synthetic.jwt.value");
    expect(result).not.toContain("user:password");
    expect(result).not.toContain("ghu_123456789012345678901234567890");
  });

  it("emits structured JSON without Authorization, cookie, token, or GitHub code values", () => {
    const lines: string[] = [];
    const logger = new StructuredLogger((line) => lines.push(line));

    logger.info("safe_test_event", {
      authorization: "Bearer synthetic-auth-value",
      cookie: "session=synthetic-cookie-value",
      token: "synthetic-token-value",
      githubOauthCode: "synthetic-github-code",
      safeField: "visible",
    });

    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0] ?? "")).not.toThrow();
    expect(lines[0]).not.toContain("synthetic-auth-value");
    expect(lines[0]).not.toContain("synthetic-cookie-value");
    expect(lines[0]).not.toContain("synthetic-token-value");
    expect(lines[0]).not.toContain("synthetic-github-code");
    expect(lines[0]).toContain("visible");
  });
});
