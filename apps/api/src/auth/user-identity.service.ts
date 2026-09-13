import { Injectable } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";
import type { AuthenticatedUser } from "./auth.types";

@Injectable()
export class UserIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(subject: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.upsert({
      where: { id: subject },
      create: { id: subject },
      update: {},
      select: { id: true },
    });

    return { id: user.id };
  }
}
