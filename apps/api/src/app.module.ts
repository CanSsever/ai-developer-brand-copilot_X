import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";
import type { ApiEnv } from "@developer-brand-copilot/config";

import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";

@Module({})
export class AppModule {
  static register(config: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.register(config.DATABASE_URL),
        AuthModule.register({
          url: config.SUPABASE_URL,
          publishableKey: config.SUPABASE_PUBLISHABLE_KEY,
        }),
      ],
      controllers: [AppController],
    };
  }
}
