import {
  ConflictException,
  HttpException,
  HttpStatus,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../app.module";
import { AuthIdentityService } from "../auth/auth-identity.service";
import { UserIdentityService } from "../auth/user-identity.service";
import { PrismaService } from "../database/prisma.service";
import { GitHubManualSyncService } from "./github-manual-sync.service";

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
};

describe("GitHub connection endpoints", () => {
  let app: INestApplication;
  const userId = "123e4567-e89b-42d3-a456-426614174000";
  const projectId = "323e4567-e89b-42d3-a456-426614174000";
  const syncRunId = "523e4567-e89b-42d3-a456-426614174000";
  let manualSync: { start: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    manualSync = {
      start: vi.fn().mockResolvedValue({ status: "queued", syncRunId }),
    };
    const module = await Test.createTestingModule({
      imports: [AppModule.register(testConfig)],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthIdentityService)
      .useValue({
        authenticate: vi.fn().mockResolvedValue({ subject: userId }),
      })
      .overrideProvider(UserIdentityService)
      .useValue({
        resolve: vi.fn().mockResolvedValue({ id: userId }),
      })
      .overrideProvider(GitHubManualSyncService)
      .useValue(manualSync)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it("requires Supabase authentication before starting installation", async () => {
    await request(app.getHttpServer())
      .post("/github/connections/start")
      .send({ projectId: "323e4567-e89b-42d3-a456-426614174000" })
      .expect(401);
  });

  it("requires authentication before starting a manual synchronization", async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/sync-runs`)
      .expect(401);
    expect(manualSync.start).not.toHaveBeenCalled();
  });

  it("accepts one owned manual synchronization with a safe queued response", async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sync-runs`)
      .set("Authorization", "Bearer synthetic-test-access-token")
      .expect(202);

    expect(response.body).toEqual({ status: "queued", syncRunId });
    expect(manualSync.start).toHaveBeenCalledWith(userId, projectId);
    expect(JSON.stringify(response.body)).not.toMatch(
      /token|authorization|provider|payload/i
    );
  });

  it("maps an active synchronization to the stable safe conflict contract", async () => {
    manualSync.start.mockRejectedValue(
      new ConflictException("GitHub synchronization is already in progress")
    );

    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sync-runs`)
      .set("Authorization", "Bearer synthetic-test-access-token")
      .expect(409);

    expect(response.body).toMatchObject({
      statusCode: 409,
      code: "CONFLICT",
      message: "GitHub synchronization is already in progress",
      path: `/projects/${projectId}/sync-runs`,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/stack|constraint|token/i);
  });

  it("maps manual rate limiting to a stable safe 429 contract", async () => {
    manualSync.start.mockRejectedValue(
      new HttpException(
        "GitHub synchronization is temporarily rate limited",
        HttpStatus.TOO_MANY_REQUESTS
      )
    );

    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/sync-runs`)
      .set("Authorization", "Bearer synthetic-test-access-token")
      .expect(429);

    expect(response.body).toMatchObject({
      statusCode: 429,
      code: "RATE_LIMITED",
      message: "GitHub synchronization is temporarily rate limited",
    });
  });
});
