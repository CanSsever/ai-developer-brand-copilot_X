import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "./app.module";
import { DatabaseHealthService } from "./database/database-health.service";

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

describe("GET /health", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [AppModule.register(testConfig)],
    }).compile();

    app = testingModule.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns the application health contract", async () => {
    await request(app.getHttpServer())
      .get("/health")
      .expect(200)
      .expect({ status: "ok" });
  });
});

describe("GET /health/db", () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it("returns the database health contract when the query succeeds", async () => {
    const testingModule = await Test.createTestingModule({
      imports: [AppModule.register(testConfig)],
    })
      .overrideProvider(DatabaseHealthService)
      .useValue({ check: async () => undefined })
      .compile();

    app = testingModule.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .get("/health/db")
      .expect(200)
      .expect({ status: "ok", database: "connected" });
  });

  it("returns a controlled unavailable response when the query fails", async () => {
    const testingModule = await Test.createTestingModule({
      imports: [AppModule.register(testConfig)],
    })
      .overrideProvider(DatabaseHealthService)
      .useValue({ check: async () => Promise.reject(new Error("connection failed")) })
      .compile();

    app = testingModule.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .get("/health/db")
      .set("X-Request-Id", "55555555-5555-4555-8555-555555555555")
      .expect(503);

    expect(response.body).toMatchObject({
      statusCode: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Database is unavailable",
      requestId: "55555555-5555-4555-8555-555555555555",
      path: "/health/db",
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
  });
});
