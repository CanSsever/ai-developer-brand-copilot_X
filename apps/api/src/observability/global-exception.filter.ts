import { randomUUID } from "node:crypto";

import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { ApiErrorResponse } from "@developer-brand-copilot/contracts";

import { getRequestId } from "./request-context";
import { sanitizePath } from "./request-context.middleware";
import { StructuredLogger } from "./structured-logger";

interface RequestLike {
  readonly method?: string;
  readonly originalUrl?: string;
  readonly url?: string;
}

function errorCode(statusCode: number): string {
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return "BAD_REQUEST";
    case HttpStatus.UNAUTHORIZED:
      return "UNAUTHORIZED";
    case HttpStatus.FORBIDDEN:
      return "FORBIDDEN";
    case HttpStatus.NOT_FOUND:
      return "NOT_FOUND";
    case HttpStatus.CONFLICT:
      return "CONFLICT";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "RATE_LIMITED";
    case HttpStatus.BAD_GATEWAY:
      return "UPSTREAM_FAILURE";
    case HttpStatus.SERVICE_UNAVAILABLE:
      return "SERVICE_UNAVAILABLE";
    default:
      return statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : `HTTP_${statusCode}`;
  }
}

function expectedMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === "string") return response;
  if (response && typeof response === "object" && "message" in response) {
    const message = (response as { readonly message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && typeof message[0] === "string") return message[0];
  }
  return exception.message || "Request failed";
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly logger: StructuredLogger
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestLike>();
    const response = context.getResponse<unknown>();
    const isExpected = exception instanceof HttpException;
    const statusCode = isExpected
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = getRequestId() ?? randomUUID();
    const path = sanitizePath(request.originalUrl ?? request.url);
    const body: ApiErrorResponse = {
      statusCode,
      code: errorCode(statusCode),
      message: isExpected ? expectedMessage(exception) : "Internal server error",
      requestId,
      timestamp: new Date().toISOString(),
      path,
    };

    if (!isExpected) {
      this.logger.errorEvent("unhandled_exception", {
        requestId,
        method: request.method ?? "UNKNOWN",
        path,
        statusCode,
        errorType: exception instanceof Error ? exception.name : typeof exception,
      });
    }

    const { httpAdapter } = this.adapterHost;
    httpAdapter.setHeader(response, "X-Request-Id", requestId);
    httpAdapter.reply(response, body, statusCode);
  }
}
