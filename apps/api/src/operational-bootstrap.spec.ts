import type { ApiEnv } from "@developer-brand-copilot/config";
import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";

import { AppModule } from "./app.module";
import { GitHubModule } from "./github/github.module";
import { GITHUB_FETCH, GITHUB_SYNC_WORKER_ENABLED } from "./github/github.tokens";
import { OPENAI_INTERPRETATION_FETCH } from "./development-intelligence/development-intelligence.tokens";

const config: ApiEnv = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/app",
  DIRECT_URL: "postgresql://user:password@localhost:5432/app",
  GITHUB_APP_CALLBACK_URL: "http://localhost:3000/github/callback",
  GITHUB_APP_CLIENT_ID: "Iv1.safe-test-client",
  GITHUB_APP_CLIENT_SECRET: "safe_test_client_secret_value",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nsafe\n-----END PRIVATE KEY-----",
  GITHUB_APP_SLUG: "developer-brand-copilot-test",
  NODE_ENV: "test",
  OPENAI_API_KEY: "synthetic_openai_api_key_for_tests",
  OPENAI_DAILY_ATTEMPT_LIMIT: 100,
  OPENAI_INTERPRETATION_MODEL: "configured-test-model",
  PORT: 3001,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_safe_example_key",
  SUPABASE_URL: "https://project-ref.supabase.co",
};

function workerEnabled(module: ReturnType<typeof AppModule.register>): boolean | undefined {
  const github = module.imports?.find(
    (entry) => typeof entry === "object" && entry !== null && "module" in entry && entry.module === GitHubModule
  ) as { providers?: readonly { provide?: symbol; useValue?: boolean }[] } | undefined;
  return github?.providers?.find((provider) => provider.provide === GITHUB_SYNC_WORKER_ENABLED)?.useValue;
}

describe("operational bootstrap", () => {
  it("disables background worker startup for side-effect-free maintenance contexts", () => {
    expect(workerEnabled(AppModule.registerOperational(config))).toBe(false);
  });

  it("keeps normal application startup worker-enabled", () => {
    expect(workerEnabled(AppModule.register(config))).toBe(true);
  });

  it("boots the operational composition without invoking GitHub or OpenAI providers", async () => {
    const githubFetch = vi.fn();
    const openAiFetch = vi.fn();
    const module = await Test.createTestingModule({
      imports: [AppModule.registerOperational(config)],
    })
      .overrideProvider(GITHUB_FETCH)
      .useValue(githubFetch)
      .overrideProvider(OPENAI_INTERPRETATION_FETCH)
      .useValue(openAiFetch)
      .compile();
    await module.init();
    try {
      expect(githubFetch).not.toHaveBeenCalled();
      expect(openAiFetch).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });
});
