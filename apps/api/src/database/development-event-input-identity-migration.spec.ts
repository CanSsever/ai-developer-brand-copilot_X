import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260923220000_add_development_event_input_identity/migration.sql"
  ),
  "utf8"
);

describe("DevelopmentEvent semantic input identity migration", () => {
  it("replaces the old group/version identity with the complete semantic input boundary", () => {
    expect(schema).toContain(
      "@@unique([projectId, eventKey, extractionVersion, inputFingerprint])"
    );
    expect(migration).toContain(
      'DROP INDEX "DevelopmentEvent_projectId_eventKey_extractionVersion_key"'
    );
    expect(migration).toContain(
      '"DevelopmentEvent"("projectId", "eventKey", "extractionVersion", "inputFingerprint")'
    );
  });
});
