import { describe, expect, it, vi } from "vitest";

import { PrismaService } from "../database/prisma.service";
import { UserIdentityService } from "./user-identity.service";

describe("UserIdentityService", () => {
  it("idempotently resolves the Supabase subject without persisting secrets", async () => {
    const subject = "123e4567-e89b-42d3-a456-426614174000";
    const upsert = vi.fn().mockResolvedValue({ id: subject });
    const prisma = { user: { upsert } } as unknown as PrismaService;
    const service = new UserIdentityService(prisma);

    await expect(service.resolve(subject)).resolves.toEqual({ id: subject });
    await expect(service.resolve(subject)).resolves.toEqual({ id: subject });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith({
      where: { id: subject },
      create: { id: subject },
      update: {},
      select: { id: true },
    });
  });
});
