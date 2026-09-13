import "dotenv/config";

import { parseDatabaseEnv } from "@developer-brand-copilot/config";

import { PrismaService } from "./prisma.service";

async function checkDatabase(): Promise<void> {
  const config = parseDatabaseEnv({
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
