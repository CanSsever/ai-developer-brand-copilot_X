import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import type {
  DatabaseHealthResponse,
  HealthResponse,
} from "@developer-brand-copilot/contracts";

import { DatabaseHealthService } from "./database/database-health.service";

@Controller()
export class AppController {
  constructor(private readonly databaseHealth: DatabaseHealthService) {}

  @Get("health")
  getHealth(): HealthResponse {
    return { status: "ok" };
  }

  @Get("health/db")
  async getDatabaseHealth(): Promise<DatabaseHealthResponse> {
    try {
      await this.databaseHealth.check();
      return { status: "ok", database: "connected" };
    } catch {
      throw new ServiceUnavailableException("Database is unavailable");
    }
  }
}
