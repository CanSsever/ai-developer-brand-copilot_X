import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module";
import { AuthIdentityService } from "../auth/auth-identity.service";
import { UserIdentityService } from "../auth/user-identity.service";
import { PrismaService } from "../database/prisma.service";
import { OpportunityFeedbackService } from "./opportunity-feedback.service";

const testConfig = {
  NODE_ENV: "test" as const, PORT: 3001,
  DATABASE_URL: "postgresql://user:password@localhost:5432/app",
  DIRECT_URL: "postgresql://user:password@localhost:5432/app",
  SUPABASE_URL: "https://project-ref.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_safe_example_key",
  GITHUB_APP_CLIENT_ID: "Iv1.safe-test-client", GITHUB_APP_CLIENT_SECRET: "safe_test_client_secret_value",
  GITHUB_APP_SLUG: "developer-brand-copilot-test",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nsafe-test-key-material\\n-----END PRIVATE KEY-----",
  GITHUB_APP_CALLBACK_URL: "http://localhost:3000/github/callback",
  OPENAI_API_KEY: "synthetic_openai_api_key_for_tests",
  OPENAI_INTERPRETATION_MODEL: "configured-test-model", OPENAI_DAILY_ATTEMPT_LIMIT: 100,
};

describe("opportunity feedback endpoint", () => {
  let app: INestApplication;
  const userId = "123e4567-e89b-42d3-a456-426614174000";
  const projectId = "323e4567-e89b-42d3-a456-426614174000";
  const opportunityId = "523e4567-e89b-42d3-a456-426614174000";
  const record = vi.fn();

  beforeEach(async () => {
    record.mockReset().mockResolvedValue({
      id: "feedback-id", opportunityId, action: "accepted", reason: null,
      createdAt: "2026-09-25T10:00:00.000Z", isCurrent: true,
    });
    const module = await Test.createTestingModule({ imports: [AppModule.register(testConfig)] })
      .overrideProvider(PrismaService).useValue({})
      .overrideProvider(AuthIdentityService).useValue({ authenticate: vi.fn().mockResolvedValue({ subject: userId }) })
      .overrideProvider(UserIdentityService).useValue({ resolve: vi.fn().mockResolvedValue({ id: userId }) })
      .overrideProvider(OpportunityFeedbackService).useValue({ record })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it("requires authentication and does not invoke the mutation service", async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/opportunities/${opportunityId}/feedback`)
      .send({ action: "accepted" })
      .expect(401);
    expect(record).not.toHaveBeenCalled();
  });

  it("accepts the authenticated owner-scoped route with a validated idempotency key", async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/opportunities/${opportunityId}/feedback`)
      .set("Authorization", "Bearer synthetic-test-access-token")
      .set("Idempotency-Key", "api-test-key-1")
      .send({ action: "accepted" })
      .expect(201);
    expect(response.body).toEqual({
      id: "feedback-id", opportunityId, action: "accepted", reason: null,
      createdAt: "2026-09-25T10:00:00.000Z", isCurrent: true,
    });
    expect(record).toHaveBeenCalledWith(userId, projectId, opportunityId, { action: "accepted", reason: null }, "api-test-key-1");
  });

  it.each([
    ["missing key", {}, undefined],
    ["unknown action", { action: "share" }, "bad-key"],
    ["unknown reason", { action: "dismissed", reason: "too much" }, "bad-key"],
    ["accepted reason", { action: "accepted", reason: "other" }, "bad-key"],
    ["extra body field", { action: "accepted", topic: "unbounded" }, "bad-key"],
  ])("rejects %s before calling the service", async (_label, body, key) => {
    let testRequest = request(app.getHttpServer())
      .post(`/projects/${projectId}/opportunities/${opportunityId}/feedback`)
      .set("Authorization", "Bearer synthetic-test-access-token");
    if (key !== undefined) testRequest = testRequest.set("Idempotency-Key", key);
    await testRequest.send(body).expect(400);
    expect(record).not.toHaveBeenCalled();
  });

  it("rejects oversized idempotency keys and malformed route UUIDs", async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/opportunities/${opportunityId}/feedback`)
      .set("Authorization", "Bearer synthetic-test-access-token")
      .set("Idempotency-Key", "k".repeat(129))
      .send({ action: "dismissed" })
      .expect(400);
    await request(app.getHttpServer())
      .post("/projects/not-a-project/opportunities/not-an-opportunity/feedback")
      .set("Authorization", "Bearer synthetic-test-access-token")
      .set("Idempotency-Key", "safe-key")
      .send({ action: "dismissed" })
      .expect(400);
    expect(record).not.toHaveBeenCalled();
  });
});
