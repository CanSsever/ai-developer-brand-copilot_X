import { describe, expect, it } from "vitest";

import { EnvironmentValidationError } from "./environment-validation";
import { parsePublicWebEnv } from "./web-env";

describe("parsePublicWebEnv", () => {
  it("accepts an absolute HTTP or HTTPS URL", () => {
    expect(
      parsePublicWebEnv({
        NEXT_PUBLIC_API_BASE_URL: "http://localhost:3001",
      })
    ).toEqual({ NEXT_PUBLIC_API_BASE_URL: "http://localhost:3001" });
  });

  it("rejects malformed public URLs", () => {
    expect(() =>
      parsePublicWebEnv({ NEXT_PUBLIC_API_BASE_URL: "not-a-url" })
    ).toThrow(EnvironmentValidationError);
  });

  it("returns only explicitly approved browser-public fields", () => {
    const publicConfig = parsePublicWebEnv({
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.test",
      SOME_SERVER_SECRET: "do-not-expose",
    });

    expect(publicConfig).toEqual({
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.test",
    });
    expect(publicConfig).not.toHaveProperty("SOME_SERVER_SECRET");
  });
});
