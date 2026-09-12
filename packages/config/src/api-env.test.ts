import { describe, expect, it } from "vitest";

import { parseApiEnv } from "./api-env";
import { EnvironmentValidationError } from "./environment-validation";

describe("parseApiEnv", () => {
  it("parses valid API configuration into typed values", () => {
    expect(parseApiEnv({
      NODE_ENV: "test",
      PORT: "3001",
      DATABASE_URL: "postgresql://user:password@localhost:5432/app",
      DIRECT_URL: "postgresql://user:password@localhost:5432/app",
    })).toEqual({
      NODE_ENV: "test",
      PORT: 3001,
      DATABASE_URL: "postgresql://user:password@localhost:5432/app",
      DIRECT_URL: "postgresql://user:password@localhost:5432/app",
    });
  });

  it.each(["abc", "0", "70000"])("rejects invalid PORT=%s", (PORT) => {
    expect(() =>
      parseApiEnv({
        PORT,
        DATABASE_URL: "postgresql://user:password@localhost:5432/app",
        DIRECT_URL: "postgresql://user:password@localhost:5432/app",
      })
    ).toThrow(EnvironmentValidationError);
  });

  it("rejects an unsupported NODE_ENV", () => {
    expect(() =>
      parseApiEnv({
        NODE_ENV: "staging",
        DATABASE_URL: "postgresql://user:password@localhost:5432/app",
        DIRECT_URL: "postgresql://user:password@localhost:5432/app",
      })
    ).toThrow(EnvironmentValidationError);
  });

  it("requires both database URLs and rejects non-PostgreSQL URLs", () => {
    expect(() => parseApiEnv({})).toThrow(EnvironmentValidationError);
    expect(() =>
      parseApiEnv({
        DATABASE_URL: "https://example.com/database",
        DIRECT_URL: "postgresql://user:password@localhost:5432/app",
      })
    ).toThrow(EnvironmentValidationError);
  });
});
