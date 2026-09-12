import "dotenv/config";

import { parseApiEnv } from "@developer-brand-copilot/config";

import { PrismaService } from "./prisma.service";

async function checkDatabase(): Promise<void> {
  const config = parseApiEnv({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
  });
  const prisma = new PrismaService(config.DATABASE_URL);

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("Database connectivity check passed.");
  } finally {
    await prisma.onModuleDestroy();
  }
}

void checkDatabase().catch(() => {
  console.error("Database connectivity check failed.");
  process.exitCode = 1;
});
