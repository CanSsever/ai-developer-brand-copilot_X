import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, it } from "vitest";

import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";

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

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.register(testConfig)],
    })
      .overrideProvider(PrismaService)
      .useValue({})
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
});
