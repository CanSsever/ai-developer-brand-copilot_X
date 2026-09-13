import { describe, expect, it } from "vitest";

import { EnvironmentValidationError } from "./environment-validation";
import { parsePublicWebEnv } from "./web-env";

const validPublicConfig = {
  NEXT_PUBLIC_API_BASE_URL: "http://localhost:3001",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_safe_example_key",
};

describe("parsePublicWebEnv", () => {
  it("accepts an absolute HTTP or HTTPS URL", () => {
    expect(
      parsePublicWebEnv(validPublicConfig)
    ).toEqual(validPublicConfig);
  });

  it("rejects malformed public URLs", () => {
    expect(() =>
      parsePublicWebEnv({
        ...validPublicConfig,
        NEXT_PUBLIC_API_BASE_URL: "not-a-url",
      })
    ).toThrow(EnvironmentValidationError);
  });

  it("returns only explicitly approved browser-public fields", () => {
    const publicConfig = parsePublicWebEnv({
      ...validPublicConfig,
      SOME_SERVER_SECRET: "do-not-expose",
      SUPABASE_SERVICE_ROLE_KEY: "never-expose",
      SUPABASE_URL: "https://server-only.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "server-only-key",
      DATABASE_URL: "postgresql://never-expose",
    });

    expect(publicConfig).toEqual({
      ...validPublicConfig,
    });
    expect(publicConfig).not.toHaveProperty("SOME_SERVER_SECRET");
    expect(publicConfig).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(publicConfig).not.toHaveProperty("SUPABASE_URL");
    expect(publicConfig).not.toHaveProperty("SUPABASE_PUBLISHABLE_KEY");
    expect(publicConfig).not.toHaveProperty("DATABASE_URL");
  });
});
