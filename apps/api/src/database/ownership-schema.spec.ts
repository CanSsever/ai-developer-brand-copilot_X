import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8"
);

function modelBlock(modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));

  if (!match?.[1]) {
    throw new Error(`Missing Prisma model: ${modelName}`);
  }

  return match[1];
}

describe("core ownership Prisma schema", () => {
  it("defines User as a UUID ownership root with timestamps", () => {
    const user = modelBlock("User");

    expect(user).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)\s+@db\.Uuid/);
    expect(user).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(user).toMatch(/updatedAt\s+DateTime\s+@default\(now\(\)\)\s+@updatedAt/);
    expect(user).toMatch(/projects\s+Project\[\]/);
    expect(user).not.toMatch(/password|token|oauth|avatar|bio/i);
  });

  it("requires every Project to have one UUID owner and a timezone", () => {
    const project = modelBlock("Project");

    expect(project).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)\s+@db\.Uuid/);
    expect(project).toMatch(/userId\s+String\s+@db\.Uuid/);
    expect(project).not.toMatch(/userId\s+String\?/);
    expect(project).toMatch(/timezone\s+String/);
    expect(project).not.toMatch(/timezone\s+String\?/);
  });

  it("enforces the ownership relation, cascade delete, and owner index", () => {
    const project = modelBlock("Project");

    expect(project).toMatch(
      /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade, onUpdate: Cascade\)/
    );
    expect(project).toMatch(/@@index\(\[userId\]\)/);
  });
});
