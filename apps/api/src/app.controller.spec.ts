import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, it } from "vitest";

import { AppModule } from "./app.module";
import { DatabaseHealthService } from "./database/database-health.service";

const testConfig = {
  NODE_ENV: "test" as const,
  PORT: 3001,
  DATABASE_URL: "postgresql://user:password@localhost:5432/app",
  DIRECT_URL: "postgresql://user:password@localhost:5432/app",
  SUPABASE_URL: "https://project-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_safe_example_key",
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

    await request(app.getHttpServer())
      .get("/health/db")
      .expect(503)
      .expect({
        statusCode: 503,
        message: "Database is unavailable",
        error: "Service Unavailable",
      });
  });
});
