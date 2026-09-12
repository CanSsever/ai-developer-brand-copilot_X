import { describe, expect, it, vi } from "vitest";

import { DatabaseHealthService } from "./database-health.service";
import type { PrismaService } from "./prisma.service";

describe("DatabaseHealthService", () => {
  it("performs a minimal database query", async () => {
    const query = vi.fn().mockResolvedValue([{ "?column?": 1 }]);
    const service = new DatabaseHealthService({
      $queryRaw: query,
    } as unknown as PrismaService);

    await expect(service.check()).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledOnce();
  });

  it("propagates a database failure to the transport boundary", async () => {
    const service = new DatabaseHealthService({
      $queryRaw: vi.fn().mockRejectedValue(new Error("connection failed")),
    } as unknown as PrismaService);

    await expect(service.check()).rejects.toThrow("connection failed");
  });
});
