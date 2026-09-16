import { randomUUID } from "node:crypto";

import { Injectable, type NestMiddleware } from "@nestjs/common";

import { runWithRequestContext } from "./request-context";
import { StructuredLogger } from "./structured-logger";

const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RequestLike {
  readonly headers: Record<string, string | readonly string[] | undefined>;
  readonly method: string;
  readonly originalUrl?: string;
  readonly url?: string;
}

interface ResponseLike {
  readonly statusCode: number;
  setHeader(name: string, value: string): void;
  once(event: "finish" | "close", listener: () => void): this;
}

export function sanitizePath(value: string | undefined): string {
  if (!value) return "/";

  try {
    return new URL(value, "http://localhost").pathname;
  } catch {
    return "/";
  }
}

export function resolveRequestId(value: unknown): string {
  return typeof value === "string" && requestIdPattern.test(value)
    ? value
    : randomUUID();
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly logger: StructuredLogger) {}

  use(request: RequestLike, response: ResponseLike, next: () => void): void {
    const requestId = resolveRequestId(request.headers["x-request-id"]);
    const startedAt = process.hrtime.bigint();
    let logged = false;

    response.setHeader("X-Request-Id", requestId);

    const logCompletion = (): void => {
      if (logged) return;
      logged = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const metadata = {
        requestId,
        method: request.method,
        path: sanitizePath(request.originalUrl ?? request.url),
        statusCode: response.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      };

      if (response.statusCode >= 400) {
        this.logger.warnEvent("http_request_completed", metadata);
      } else {
        this.logger.info("http_request_completed", metadata);
      }
    };

    response.once("finish", logCompletion);
    response.once("close", logCompletion);
    runWithRequestContext(requestId, next);
  }
}
