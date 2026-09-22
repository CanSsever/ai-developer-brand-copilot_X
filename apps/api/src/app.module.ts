import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";
import type { ApiEnv } from "@developer-brand-copilot/config";

import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { DevelopmentIntelligenceModule } from "./development-intelligence/development-intelligence.module";
import { GitHubModule } from "./github/github.module";
import { ObservabilityModule } from "./observability/observability.module";

@Module({})
export class AppModule {
  static register(config: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ObservabilityModule,
        DatabaseModule.register(config.DATABASE_URL),
        DevelopmentIntelligenceModule.register({
          apiKey: config.OPENAI_API_KEY,
          model: config.OPENAI_INTERPRETATION_MODEL,
          dailyAttemptLimit: config.OPENAI_DAILY_ATTEMPT_LIMIT,
        }),
        AuthModule.register({
          url: config.SUPABASE_URL,
          publishableKey: config.SUPABASE_PUBLISHABLE_KEY,
        }),
        GitHubModule.register({
          callbackUrl: config.GITHUB_APP_CALLBACK_URL,
          clientId: config.GITHUB_APP_CLIENT_ID,
          clientSecret: config.GITHUB_APP_CLIENT_SECRET,
          privateKey: config.GITHUB_APP_PRIVATE_KEY,
          slug: config.GITHUB_APP_SLUG,
        }),
      ],
      controllers: [AppController],
    };
  }
}
