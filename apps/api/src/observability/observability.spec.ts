import {
  BadRequestException,
  Controller,
  Get,
  type INestApplication,
  Module,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ObservabilityModule } from "./observability.module";
import { StructuredLogger } from "./structured-logger";

@Controller("observability-test")
class ObservabilityTestController {
  @Get("ok")
  ok(): { readonly status: "ok" } {
    return { status: "ok" };
  }

  @Get("expected")
  expected(): never {
    throw new BadRequestException("Safe validation message");
  }

  @Get("unexpected")
  unexpected(): never {
    throw new Error("synthetic-internal-detail");
  }
}

@Module({
  imports: [ObservabilityModule],
  controllers: [ObservabilityTestController],
})
class ObservabilityTestModule {}

describe("API observability baseline", () => {
  let app: INestApplication;
  let lines: string[];

  beforeEach(async () => {
    lines = [];
    const logger = new StructuredLogger((line) => lines.push(line));
    const moduleRef = await Test.createTestingModule({
      imports: [ObservabilityTestModule],
    })
      .overrideProvider(StructuredLogger)
      .useValue(logger)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns a generated request ID for every request", async () => {
    const response = await request(app.getHttpServer())
      .get("/observability-test/ok")
      .expect(200);

    expect(response.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("reuses a bounded valid incoming request ID and replaces invalid input", async () => {
    const validRequestId = "11111111-1111-4111-8111-111111111111";
    const valid = await request(app.getHttpServer())
      .get("/observability-test/ok")
      .set("X-Request-Id", validRequestId)
      .expect(200);
    const invalid = await request(app.getHttpServer())
      .get("/observability-test/ok")
      .set("X-Request-Id", "x".repeat(65))
      .expect(200);

    expect(valid.headers["x-request-id"]).toBe(validRequestId);
    expect(invalid.headers["x-request-id"]).not.toBe("x".repeat(65));
    expect(invalid.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("preserves expected HttpException behavior in the stable error contract", async () => {
    const response = await request(app.getHttpServer())
      .get("/observability-test/expected?code=synthetic-callback-value")
      .set("X-Request-Id", "22222222-2222-4222-8222-222222222222")
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: "BAD_REQUEST",
      message: "Safe validation message",
      requestId: "22222222-2222-4222-8222-222222222222",
      path: "/observability-test/expected",
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toContain("synthetic-callback-value");
  });

  it("converts unexpected exceptions to a safe 500 and logs only safe diagnostics", async () => {
    const response = await request(app.getHttpServer())
      .get("/observability-test/unexpected")
      .set("X-Request-Id", "33333333-3333-4333-8333-333333333333")
      .expect(500);

    expect(response.body).toMatchObject({
      statusCode: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      requestId: "33333333-3333-4333-8333-333333333333",
      path: "/observability-test/unexpected",
    });
    expect(JSON.stringify(response.body)).not.toContain("synthetic-internal-detail");
    expect(JSON.stringify(response.body)).not.toContain("stack");
    expect(lines.join("\n")).not.toContain("synthetic-internal-detail");
    expect(lines.some((line) => line.includes('"event":"unhandled_exception"'))).toBe(
      true
    );
  });

  it("logs one sanitized request-completion event with safe HTTP metadata", async () => {
    await request(app.getHttpServer())
      .get("/observability-test/ok?token=synthetic-query-token")
      .set("Authorization", "Bearer synthetic-authorization-value")
      .set("Cookie", "session=synthetic-cookie-value")
      .set("X-Request-Id", "44444444-4444-4444-8444-444444444444")
      .expect(200);

    const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const completion = entries.filter(
      (entry) => entry.event === "http_request_completed"
    );

    expect(completion).toHaveLength(1);
    expect(completion[0]).toMatchObject({
      requestId: "44444444-4444-4444-8444-444444444444",
      method: "GET",
      path: "/observability-test/ok",
      statusCode: 200,
    });
    expect(completion[0]?.durationMs).toEqual(expect.any(Number));
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("synthetic-query-token");
    expect(serialized).not.toContain("synthetic-authorization-value");
    expect(serialized).not.toContain("synthetic-cookie-value");
  });
});
