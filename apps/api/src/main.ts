import "dotenv/config";

import { NestFactory } from "@nestjs/core";
import { parseApiEnv } from "@developer-brand-copilot/config";

import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const config = parseApiEnv({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
    GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
    GITHUB_APP_CALLBACK_URL: process.env.GITHUB_APP_CALLBACK_URL,
  });
  const app = await NestFactory.create(AppModule.register(config));

  await app.listen(config.PORT);
}

void bootstrap();
