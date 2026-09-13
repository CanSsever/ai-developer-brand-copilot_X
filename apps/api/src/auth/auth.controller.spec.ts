import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { AUTH_CLAIMS_VERIFIER } from "./auth.tokens";

const subject = "123e4567-e89b-42d3-a456-426614174000";
const testConfig = {
  NODE_ENV: "test" as const,
  PORT: 3001,
  DATABASE_URL: "postgresql://user:password@localhost:5432/app",
  DIRECT_URL: "postgresql://user:password@localhost:5432/app",
  SUPABASE_URL: "https://project-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_safe_example_key",
};

describe("GET /auth/me", () => {
  let app: INestApplication;
  const verifyAccessToken = vi.fn();
  const upsert = vi.fn();

  beforeEach(async () => {
    verifyAccessToken.mockReset();
    upsert.mockReset();
    upsert.mockResolvedValue({ id: subject });

    const testingModule = await Test.createTestingModule({
      imports: [AppModule.register(testConfig)],
    })
      .overrideProvider(AUTH_CLAIMS_VERIFIER)
      .useValue({ verifyAccessToken })
      .overrideProvider(PrismaService)
      .useValue({ user: { upsert } })
      .compile();

    app = testingModule.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects a missing bearer token", async () => {
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("x-user-id", subject)
      .expect(401);

    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a token that fails cryptographic verification", async () => {
    verifyAccessToken.mockRejectedValue(new Error("invalid signature"));

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", "Bearer invalid-token")
      .expect(401)
      .expect(({ body }) => {
        expect(body).toMatchObject({ message: "Authentication required" });
      });

    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns only the resolved application identity for a valid token", async () => {
    verifyAccessToken.mockResolvedValue({
      iss: `${testConfig.SUPABASE_URL}/auth/v1`,
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 60,
      sub: subject,
    });

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", "Bearer valid-token")
      .expect(200)
      .expect({ id: subject });

    expect(verifyAccessToken).toHaveBeenCalledWith("valid-token");
    expect(upsert).toHaveBeenCalledWith({
      where: { id: subject },
      create: { id: subject },
      update: {},
      select: { id: true },
    });
  });
});
