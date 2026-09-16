import {
  Inject,
  Injectable,
  Optional,
  type LoggerService,
} from "@nestjs/common";

import { getRequestId } from "./request-context";
import { redact } from "./redaction";

type LogLevel = "debug" | "error" | "info" | "warn";
export type LogSink = (line: string, level: LogLevel) => void;
export const STRUCTURED_LOG_SINK = Symbol("STRUCTURED_LOG_SINK");

function defaultSink(line: string, level: LogLevel): void {
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

function safeMetadata(value: unknown): Record<string, unknown> {
  const safe = redact(value);
  return safe && typeof safe === "object" && !Array.isArray(safe)
    ? (safe as Record<string, unknown>)
    : { details: safe };
}

@Injectable()
export class StructuredLogger implements LoggerService {
  private readonly sink: LogSink;

  constructor(
    @Optional()
    @Inject(STRUCTURED_LOG_SINK)
    sink?: LogSink
  ) {
    this.sink = sink ?? defaultSink;
  }

  info(event: string, metadata: Record<string, unknown> = {}): void {
    this.emit("info", event, metadata);
  }

  warnEvent(event: string, metadata: Record<string, unknown> = {}): void {
    this.emit("warn", event, metadata);
  }

  errorEvent(event: string, metadata: Record<string, unknown> = {}): void {
    this.emit("error", event, metadata);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("info", "nest_log", { message, optionalParams });
  }

  error(message: unknown, ..._optionalParams: unknown[]): void {
    this.emit("error", "nest_error", {
      errorType: message instanceof Error ? message.name : typeof message,
    });
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("warn", "nest_warning", { message, optionalParams });
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("debug", "nest_debug", { message, optionalParams });
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("debug", "nest_verbose", { message, optionalParams });
  }

  fatal(message: unknown, ..._optionalParams: unknown[]): void {
    this.emit("error", "nest_fatal", {
      errorType: message instanceof Error ? message.name : typeof message,
    });
  }

  private emit(
    level: LogLevel,
    event: string,
    metadata: Record<string, unknown>
  ): void {
    const contextRequestId = getRequestId();
    const safe = safeMetadata(metadata);
    const entry = {
      ...safe,
      timestamp: new Date().toISOString(),
      level,
      event,
      ...(contextRequestId ? { requestId: contextRequestId } : {}),
    };

    this.sink(JSON.stringify(entry), level);
  }
}
