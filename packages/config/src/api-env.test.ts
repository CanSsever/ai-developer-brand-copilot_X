import { describe, expect, it } from "vitest";

import { parseApiEnv, parseDatabaseEnv } from "./api-env";
import { EnvironmentValidationError } from "./environment-validation";

const validAuthConfig = {
  SUPABASE_URL: "https://project-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_safe_example_key",
};

const validGitHubConfig = {
  GITHUB_APP_CLIENT_ID: "Iv1.safe-test-client",
  GITHUB_APP_CLIENT_SECRET: "safe_test_client_secret_value",
  GITHUB_APP_SLUG: "developer-brand-copilot-test",
  GITHUB_APP_PRIVATE_KEY:
    "-----BEGIN PRIVATE KEY-----\\nsafe-test-key-material\\n-----END PRIVATE KEY-----",
  GITHUB_APP_CALLBACK_URL: "http://localhost:3000/github/callback",
};

describe("parseApiEnv", () => {
  it("parses valid API configuration into typed values", () => {
    expect(parseApiEnv({
      NODE_ENV: "test",
      PORT: "3001",
      DATABASE_URL: "postgresql://user:password@localhost:5432/app",
      DIRECT_URL: "postgresql://user:password@localhost:5432/app",
      ...validAuthConfig,
      ...validGitHubConfig,
    })).toEqual({
      NODE_ENV: "test",
      PORT: 3001,
      DATABASE_URL: "postgresql://user:password@localhost:5432/app",
      DIRECT_URL: "postgresql://user:password@localhost:5432/app",
      ...validAuthConfig,
      ...validGitHubConfig,
      GITHUB_APP_PRIVATE_KEY: validGitHubConfig.GITHUB_APP_PRIVATE_KEY.replace(
        /\\n/g,
        "\n"
      ),
    });
  });

  it.each(["abc", "0", "70000"])("rejects invalid PORT=%s", (PORT) => {
    expect(() =>
      parseApiEnv({
        PORT,
        DATABASE_URL: "postgresql://user:password@localhost:5432/app",
        DIRECT_URL: "postgresql://user:password@localhost:5432/app",
        ...validAuthConfig,
        ...validGitHubConfig,
      })
    ).toThrow(EnvironmentValidationError);
  });

  it("rejects an unsupported NODE_ENV", () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: "staging",
        DATABASE_URL: "postgresql://user:password@localhost:5432/app",
        DIRECT_URL: "postgresql://user:password@localhost:5432/app",
        ...validAuthConfig,
        ...validGitHubConfig,
      })
    ).toThrow(EnvironmentValidationError);
  });

  it("requires both database URLs and rejects non-PostgreSQL URLs", () => {
    expect(() => parseApiEnv({})).toThrow(EnvironmentValidationError);
    expect(() =>
      parseApiEnv({
        DATABASE_URL: "https://example.com/database",
        DIRECT_URL: "postgresql://user:password@localhost:5432/app",
        ...validAuthConfig,
      })
    ).toThrow(EnvironmentValidationError);
  });

  it("requires a safe Supabase origin and publishable key", () => {
    const databaseConfig = {
      DATABASE_URL: "postgresql://user:password@localhost:5432/app",
      DIRECT_URL: "postgresql://user:password@localhost:5432/app",
    };

    expect(() => parseApiEnv(databaseConfig)).toThrow(EnvironmentValidationError);
    expect(() =>
      parseApiEnv({
        ...databaseConfig,
        SUPABASE_URL: "http://project-ref.supabase.co/path",
        SUPABASE_PUBLISHABLE_KEY: "short",
        ...validGitHubConfig,
      })
    ).toThrow(EnvironmentValidationError);
  });

  it("requires validated server-only GitHub App configuration", () => {
    const input = {
      NODE_ENV: "test",
      PORT: "3001",
      DATABASE_URL: "postgresql://user:password@localhost:5432/app",
      DIRECT_URL: "postgresql://user:password@localhost:5432/app",
      ...validAuthConfig,
      ...validGitHubConfig,
    };

    expect(parseApiEnv(input)).toMatchObject({
      GITHUB_APP_CLIENT_ID: validGitHubConfig.GITHUB_APP_CLIENT_ID,
      GITHUB_APP_SLUG: validGitHubConfig.GITHUB_APP_SLUG,
      GITHUB_APP_CALLBACK_URL: validGitHubConfig.GITHUB_APP_CALLBACK_URL,
    });
    expect(parseApiEnv(input).GITHUB_APP_PRIVATE_KEY).toContain("\n");
    expect(() =>
      parseApiEnv({ ...input, GITHUB_APP_PRIVATE_KEY: "not-a-private-key" })
    ).toThrow(EnvironmentValidationError);
    expect(() =>
      parseApiEnv({ ...input, GITHUB_APP_CALLBACK_URL: "http://example.com/callback" })
    ).toThrow(EnvironmentValidationError);
  });
});

describe("parseDatabaseEnv", () => {
  it("validates database-only command configuration independently", () => {
    expect(
      parseDatabaseEnv({
        DATABASE_URL: "postgresql://user:password@localhost:5432/app",
        DIRECT_URL: "postgresql://user:password@localhost:5432/app",
        SUPABASE_SERVICE_ROLE_KEY: "not-exposed",
      })
    ).toEqual({
      DATABASE_URL: "postgresql://user:password@localhost:5432/app",
      DIRECT_URL: "postgresql://user:password@localhost:5432/app",
    });
  });
});
