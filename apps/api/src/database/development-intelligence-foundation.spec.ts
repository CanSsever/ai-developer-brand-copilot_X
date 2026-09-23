import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8"
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260921050000_add_development_intelligence_foundation/migration.sql"
  ),
  "utf8"
);

function modelBlock(modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`)
  );

  if (!match?.[1]) {
    throw new Error(`Missing Prisma model: ${modelName}`);
  }

  return match[1];
}

function enumBlock(enumName: string): string {
  const match = schema.match(
    new RegExp(`enum ${enumName} \\{([\\s\\S]*?)\\n\\}`)
  );

  if (!match?.[1]) {
    throw new Error(`Missing Prisma enum: ${enumName}`);
  }

  return match[1];
}

describe("development intelligence persistence foundation", () => {
  it("owns each DevelopmentEvent through Project", () => {
    expect(modelBlock("DevelopmentEvent")).toMatch(
      /project\s+Project\s+@relation\(fields: \[projectId\], references: \[id\], onDelete: Cascade/
    );
    expect(migration).toContain(
      'CONSTRAINT "DevelopmentEvent_projectId_fkey"'
    );
  });

  it("owns exactly one current ProjectState through Project", () => {
    const projectState = modelBlock("ProjectState");

    expect(projectState).toMatch(/projectId\s+String\s+@unique\s+@db\.Uuid/);
    expect(projectState).toMatch(
      /project\s+Project\s+@relation\(fields: \[projectId\], references: \[id\], onDelete: Cascade/
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProjectState_projectId_key"'
    );
  });

  it("links events to normalized commit evidence", () => {
    const evidence = modelBlock("DevelopmentEventCommitEvidence");

    expect(evidence).toMatch(/gitHubCommitId\s+String\?\s+@db\.Uuid/);
    expect(evidence).toMatch(/commitSha\s+String\s+@db\.VarChar\(64\)/);
    expect(evidence).toMatch(/gitHubCommit\s+GitHubCommit\?/);
  });

  it("links events to normalized merged pull-request evidence", () => {
    const evidence = modelBlock("DevelopmentEventPullRequestEvidence");

    expect(evidence).toMatch(/gitHubPullRequestId\s+String\?\s+@db\.Uuid/);
    expect(evidence).toMatch(/providerPullRequestId\s+BigInt\s+@db\.BigInt/);
    expect(evidence).toMatch(/gitHubPullRequest\s+GitHubPullRequest\?/);
  });

  it("rejects duplicate commit links within an event", () => {
    expect(modelBlock("DevelopmentEventCommitEvidence")).toContain(
      "@@unique([developmentEventId, commitSha])"
    );
    expect(migration).toContain(
      '"DevelopmentEventCommitEvidence_developmentEventId_commitSha_key"'
    );
  });

  it("rejects duplicate pull-request links within an event", () => {
    expect(modelBlock("DevelopmentEventPullRequestEvidence")).toContain(
      "@@unique([developmentEventId, providerPullRequestId])"
    );
    expect(migration).toContain(
      '"DevelopmentEventPullRequestEvidence_developmentEventId_providerPullRequestId_key"'
    );
  });

  it("permits the same raw evidence to support different events", () => {
    expect(migration).toContain(
      'ON "DevelopmentEventCommitEvidence"("developmentEventId", "commitSha")'
    );
    expect(migration).toContain(
      'ON "DevelopmentEventPullRequestEvidence"("developmentEventId", "providerPullRequestId")'
    );
    expect(migration).not.toMatch(
      /UNIQUE INDEX [^\n]+\nON "DevelopmentEventCommitEvidence"\("gitHubCommitId"\)/
    );
    expect(migration).not.toMatch(
      /UNIQUE INDEX [^\n]+\nON "DevelopmentEventPullRequestEvidence"\("gitHubPullRequestId"\)/
    );
  });

  it("rejects evidence links that cross Project ownership", () => {
    expect(migration).toContain("validate_commit_event_evidence");
    expect(migration).toContain(
      'event."projectId" = repository."projectId"'
    );
    expect(migration).toContain("validate_pull_request_event_evidence");
  });

  it("defines a durable project-scoped semantic-input idempotency boundary", () => {
    const event = modelBlock("DevelopmentEvent");

    expect(event).toContain(
      "@@unique([projectId, eventKey, extractionVersion, inputFingerprint])"
    );
    expect(migration).toContain(
      'CONSTRAINT "DevelopmentEvent_event_key_format_check"'
    );
    expect(migration).toContain(
      'CONSTRAINT "DevelopmentEvent_input_fingerprint_format_check"'
    );
  });

  it("supports the exact PDR event types and lifecycle states", () => {
    expect(enumBlock("DevelopmentEventType").trim().split(/\s+/)).toEqual([
      "feature_started",
      "feature_completed",
      "bug_fixed",
      "ui_improved",
      "architecture_decision",
      "testing_milestone",
      "performance_improvement",
      "release",
      "project_milestone",
      "refactor_completed",
    ]);
    expect(enumBlock("DevelopmentEventStatus").trim().split(/\s+/)).toEqual([
      "active",
      "superseded",
      "rejected",
    ]);
    expect(migration).toContain(
      'CONSTRAINT "DevelopmentEvent_scores_range_check"'
    );
  });

  it("keeps material reprocessing lineage within one Project", () => {
    expect(modelBlock("DevelopmentEvent")).toMatch(
      /supersedesEventId\s+String\?\s+@unique/
    );
    expect(migration).toContain("validate_development_event_supersession");
    expect(migration).toContain(
      'previous."projectId" = NEW."projectId"'
    );
  });

  it("persists versioned structured ProjectState snapshots", () => {
    const current = modelBlock("ProjectState");
    const version = modelBlock("ProjectStateVersion");

    for (const field of [
      "activeFeatures",
      "completedFeatures",
      "recentMilestones",
    ]) {
      expect(current).toMatch(new RegExp(`${field}\\s+Json`));
      expect(version).toMatch(new RegExp(`${field}\\s+Json`));
    }
    expect(version).toContain("@@unique([projectStateId, version])");
    expect(migration).toContain("ProjectState_structured_arrays_check");
    expect(migration).toContain("ProjectStateVersion_structured_arrays_check");
  });

  it("provides optimistic concurrency and replay identity fields", () => {
    const current = modelBlock("ProjectState");
    const version = modelBlock("ProjectStateVersion");

    for (const field of ["version", "sourceFingerprint", "projectionVersion"]) {
      expect(current).toContain(field);
      expect(version).toContain(field);
    }
    expect(migration).toContain('CHECK ("version" >= 1)');
    expect(version).toContain(
      "@@unique([projectStateId, sourceFingerprint, projectionVersion])"
    );
  });

  it("records applied events once and only within the same Project", () => {
    const link = modelBlock("ProjectStateVersionEvent");

    expect(link).toContain(
      "@@unique([projectStateVersionId, developmentEventId])"
    );
    expect(migration).toContain("validate_project_state_version_event");
    expect(migration).toContain(
      'state."projectId" = event."projectId"'
    );
  });

  it("makes state-version records immutable to ordinary updates", () => {
    expect(migration).toContain("prevent_project_state_version_update");
    expect(migration).toContain(
      'CREATE TRIGGER "ProjectStateVersion_append_only"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "ProjectStateVersionEvent_append_only"'
    );
  });

  it("allows authenticated reads only through owned Projects", () => {
    for (const policy of [
      "development_events_select_own",
      "development_event_commit_evidence_select_own",
      "development_event_pull_request_evidence_select_own",
      "project_states_select_own",
      "project_state_versions_select_own",
      "project_state_version_events_select_own",
    ]) {
      expect(migration).toContain(`CREATE POLICY "${policy}"`);
    }
    expect(migration.match(/"Project"\."userId" = \(SELECT auth\.uid\(\)\)/g))
      .toHaveLength(6);
  });

  it("denies authenticated direct writes without forcing RLS on the backend", () => {
    for (const table of [
      "DevelopmentEvent",
      "DevelopmentEventCommitEvidence",
      "DevelopmentEventPullRequestEvidence",
      "ProjectState",
      "ProjectStateVersion",
      "ProjectStateVersionEvent",
    ]) {
      expect(migration).toContain(
        `REVOKE ALL ON TABLE public."${table}" FROM PUBLIC, anon, authenticated`
      );
      expect(migration).toContain(
        `GRANT SELECT ON TABLE public."${table}" TO authenticated`
      );
      expect(migration).toContain(
        `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`
      );
    }
    expect(migration).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(migration).not.toContain("FORCE ROW LEVEL SECURITY");
  });

  it("cascades Project deletion through derived intelligence", () => {
    expect(migration).toMatch(
      /DevelopmentEvent_projectId_fkey[\s\S]*?ON DELETE CASCADE/
    );
    expect(migration).toMatch(
      /ProjectState_projectId_fkey[\s\S]*?ON DELETE CASCADE/
    );
  });

  it("retains derived intelligence when raw evidence is removed", () => {
    expect(migration).toMatch(
      /DevelopmentEventCommitEvidence_gitHubCommitId_fkey[\s\S]*?ON DELETE SET NULL/
    );
    expect(migration).toMatch(
      /DevelopmentEventPullRequestEvidence_gitHubPullRequestId_fkey[\s\S]*?ON DELETE SET NULL/
    );
    expect(modelBlock("DevelopmentEventCommitEvidence")).toMatch(
      /commitSha\s+String/
    );
    expect(modelBlock("DevelopmentEventPullRequestEvidence")).toMatch(
      /providerPullRequestId\s+BigInt/
    );
  });

  it("persists no raw provider content, source, patch, token, or credential", () => {
    const foundation = [
      modelBlock("DevelopmentEvent"),
      modelBlock("DevelopmentEventCommitEvidence"),
      modelBlock("DevelopmentEventPullRequestEvidence"),
      modelBlock("ProjectState"),
      modelBlock("ProjectStateVersion"),
      migration,
    ].join("\n");

    expect(foundation).not.toMatch(
      /commitMessage|pullRequestTitle|pullRequestBody|filePath|sourceCode|rawPayload|providerPayload|patch|diff|accessToken|refreshToken|installationToken|privateKey|credential/i
    );
  });
});
