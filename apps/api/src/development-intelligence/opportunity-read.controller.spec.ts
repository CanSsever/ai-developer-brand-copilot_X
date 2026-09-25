import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module";
import { AuthIdentityService } from "../auth/auth-identity.service";
import { UserIdentityService } from "../auth/user-identity.service";
import { PrismaService } from "../database/prisma.service";
import { OpportunityReadService } from "./opportunity-read.service";

const testConfig = {
  NODE_ENV: "test" as const, PORT: 3001,
  DATABASE_URL: "postgresql://user:password@localhost:5432/app",
  DIRECT_URL: "postgresql://user:password@localhost:5432/app",
  SUPABASE_URL: "https://project-ref.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_safe_example_key",
  GITHUB_APP_CLIENT_ID: "Iv1.safe-test-client", GITHUB_APP_CLIENT_SECRET: "safe_test_client_secret_value",
  GITHUB_APP_SLUG: "developer-brand-copilot-test",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nsafe-test-key-material\n-----END PRIVATE KEY-----",
  GITHUB_APP_CALLBACK_URL: "http://localhost:3000/github/callback",
  OPENAI_API_KEY: "synthetic_openai_api_key_for_tests",
  OPENAI_INTERPRETATION_MODEL: "configured-test-model", OPENAI_DAILY_ATTEMPT_LIMIT: 100,
};

describe("opportunity read endpoint", () => {
  let app: INestApplication;
  const userId = "123e4567-e89b-42d3-a456-426614174000";
  const projectId = "323e4567-e89b-42d3-a456-426614174000";
  const listForProject = vi.fn();

  beforeEach(async () => {
    listForProject.mockReset().mockResolvedValue({ projectId, items: [], nextCursor: null, processing: null });
    const module = await Test.createTestingModule({ imports: [AppModule.register(testConfig)] })
      .overrideProvider(PrismaService).useValue({})
      .overrideProvider(AuthIdentityService).useValue({ authenticate: vi.fn().mockResolvedValue({ subject: userId }) })
      .overrideProvider(UserIdentityService).useValue({ resolve: vi.fn().mockResolvedValue({ id: userId }) })
      .overrideProvider(OpportunityReadService).useValue({ listForProject })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it("requires authentication before calling the read service", async () => {
    await request(app.getHttpServer()).get(`/projects/${projectId}/opportunities`).expect(401);
    expect(listForProject).not.toHaveBeenCalled();
  });

  it("returns the owner-scoped read model through the existing versioned API base path", async () => {
    const response = await request(app.getHttpServer())
      .get(`/projects/${projectId}/opportunities?limit=7&cursor=opaque-token`)
      .set("Authorization", "Bearer synthetic-test-access-token")
      .expect(200);
    expect(response.body).toEqual({ projectId, items: [], nextCursor: null, processing: null });
    expect(listForProject).toHaveBeenCalledWith(userId, projectId, { limit: 7, cursor: "opaque-token" });
  });

  it("rejects malformed page-size query values without reaching the read service", async () => {
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/opportunities?limit=1&limit=2`)
      .set("Authorization", "Bearer synthetic-test-access-token")
      .expect(400);
    expect(listForProject).not.toHaveBeenCalled();
  });
});
