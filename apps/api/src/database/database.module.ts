import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";

import { DatabaseHealthService } from "./database-health.service";
import { DATABASE_URL } from "./database-url.token";
import { PrismaService } from "./prisma.service";

@Module({})
export class DatabaseModule {
  static register(databaseUrl: string): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DATABASE_URL,
          useValue: databaseUrl,
        },
        PrismaService,
        DatabaseHealthService,
      ],
      exports: [PrismaService, DatabaseHealthService],
    };
  }
}
