import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../app.module";
import { AuthIdentityService } from "../auth/auth-identity.service";
import { UserIdentityService } from "../auth/user-identity.service";
import { PrismaService } from "../database/prisma.service";
import { IntelligenceReadService } from "./intelligence-read.service";
import { DailyDevelopmentSummaryService } from "./daily-development-summary.service";

const testConfig = {
  NODE_ENV: "test" as const,
  PORT: 3001,
  DATABASE_URL: "postgresql://user:password@localhost:5432/app",
  DIRECT_URL: "postgresql://user:password@localhost:5432/app",
  SUPABASE_URL: "https://project-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_safe_example_key",
  GITHUB_APP_CLIENT_ID: "Iv1.safe-test-client",
  GITHUB_APP_CLIENT_SECRET: "safe_test_client_secret_value",
  GITHUB_APP_SLUG: "developer-brand-copilot-test",
  GITHUB_APP_PRIVATE_KEY:
    "-----BEGIN PRIVATE KEY-----\nsafe-test-key-material\n-----END PRIVATE KEY-----",
  GITHUB_APP_CALLBACK_URL: "http://localhost:3000/github/callback",
  OPENAI_API_KEY: "synthetic_openai_api_key_for_tests",
  OPENAI_INTERPRETATION_MODEL: "configured-test-model",
  OPENAI_DAILY_ATTEMPT_LIMIT: 100,
};

describe("intelligence read endpoint", () => {
  let app: INestApplication;
  const userId = "123e4567-e89b-42d3-a456-426614174000";
  const projectId = "323e4567-e89b-42d3-a456-426614174000";
  const getProjectIntelligence = vi.fn();
  const getToday = vi.fn();

  beforeEach(async () => {
    getProjectIntelligence.mockReset().mockResolvedValue({
      currentState: null,
      eventLimit: 20,
      events: [],
      processing: null,
      projectId,
    });
    getToday.mockReset().mockResolvedValue({
      confidence: null,
      counts: { commits: 0, excludedActivities: 0, meaningfulEvents: 0 },
      developerDay: "2026-09-23",
      generationVersion: "daily-development-summary-v1",
      items: [], projectId, projectStateVersion: null,
      status: "no_activity",
      statusMessage: "No repository activity was recorded for this developer day.",
      timezone: "Europe/Berlin", version: 1,
    });
    const module = await Test.createTestingModule({
      imports: [AppModule.register(testConfig)],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthIdentityService)
      .useValue({ authenticate: vi.fn().mockResolvedValue({ subject: userId }) })
      .overrideProvider(UserIdentityService)
      .useValue({ resolve: vi.fn().mockResolvedValue({ id: userId }) })
      .overrideProvider(IntelligenceReadService)
      .useValue({ getProjectIntelligence })
      .overrideProvider(DailyDevelopmentSummaryService)
      .useValue({ getToday })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it("denies unauthenticated reads before the service is called", async () => {
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/intelligence`)
      .expect(401);
    expect(getProjectIntelligence).not.toHaveBeenCalled();
  });

  it("returns the authenticated owner-scoped safe read model", async () => {
    const response = await request(app.getHttpServer())
      .get(`/projects/${projectId}/intelligence`)
      .set("Authorization", "Bearer synthetic-test-access-token")
      .expect(200);
    expect(response.body).toEqual({
      currentState: null,
      eventLimit: 20,
      events: [],
      processing: null,
      projectId,
    });
    expect(getProjectIntelligence).toHaveBeenCalledWith(userId, projectId);
  });

  it("denies unauthenticated daily-summary reads", async () => {
    await request(app.getHttpServer()).get(`/projects/${projectId}/daily-summaries/today`).expect(401);
    expect(getToday).not.toHaveBeenCalled();
  });

  it("returns the authenticated owner-scoped daily summary", async () => {
    const response = await request(app.getHttpServer())
      .get(`/projects/${projectId}/daily-summaries/today`)
      .set("Authorization", "Bearer synthetic-test-access-token")
      .expect(200);
    expect(response.body.status).toBe("no_activity");
    expect(getToday).toHaveBeenCalledWith(userId, projectId);
  });
});
