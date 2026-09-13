import { describe, expect, it } from "vitest";

import { parseApiEnv, parseDatabaseEnv } from "./api-env";
import { EnvironmentValidationError } from "./environment-validation";

const validAuthConfig = {
  SUPABASE_URL: "https://project-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_safe_example_key",
};

describe("parseApiEnv", () => {
  it("parses valid API configuration into typed values", () => {
    expect(parseApiEnv({
      NODE_ENV: "test",
      PORT: "3001",
      DATABASE_URL: "postgresql://user:password@localhost:5432/app",
      DIRECT_URL: "postgresql://user:password@localhost:5432/app",
      ...validAuthConfig,
    })).toEqual({
      NODE_ENV: "test",
      PORT: 3001,
      DATABASE_URL: "postgresql://user:password@localhost:5432/app",
      DIRECT_URL: "postgresql://user:password@localhost:5432/app",
      ...validAuthConfig,
    });
  });

  it.each(["abc", "0", "70000"])("rejects invalid PORT=%s", (PORT) => {
    expect(() =>
      parseApiEnv({
        PORT,
        DATABASE_URL: "postgresql://user:password@localhost:5432/app",
        DIRECT_URL: "postgresql://user:password@localhost:5432/app",
        ...validAuthConfig,
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
      })
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
