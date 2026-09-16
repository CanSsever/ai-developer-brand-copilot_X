import {
  Global,
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { GlobalExceptionFilter } from "./global-exception.filter";
import { RequestContextMiddleware } from "./request-context.middleware";
import { StructuredLogger } from "./structured-logger";

@Global()
@Module({
  providers: [
    StructuredLogger,
    RequestContextMiddleware,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
  exports: [StructuredLogger],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: "{*path}", method: RequestMethod.ALL });
  }
}
