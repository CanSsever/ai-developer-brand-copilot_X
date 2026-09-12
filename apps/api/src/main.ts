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
  });
  const app = await NestFactory.create(AppModule.register(config));

  await app.listen(config.PORT);
}

void bootstrap();
