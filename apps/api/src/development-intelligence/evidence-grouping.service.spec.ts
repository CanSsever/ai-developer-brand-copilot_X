import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../database/prisma.service";
import type { StructuredLogger } from "../observability/structured-logger";
import {
  EvidenceGroupingInputError,
  EvidenceGroupingScopeError,
  EvidenceGroupingService,
  EvidenceSelectionLimitError,
} from "./evidence-grouping.service";
import {
  evidenceGroupingVersion,
  type StructuralCommitEvidence,
  type StructuralEvidenceSet,
  type StructuralPullRequestEvidence,
} from "./evidence-grouping.types";

const projectId = "10000000-0000-4000-8000-000000000001";
const otherProjectId = "10000000-0000-4000-8000-000000000002";
const repositoryId = "20000000-0000-4000-8000-000000000001";
const otherRepositoryId = "20000000-0000-4000-8000-000000000002";
const userId = "30000000-0000-4000-8000-000000000001";
const firstSha = "1".repeat(40);
const secondSha = "2".repeat(40);
const thirdSha = "3".repeat(40);
const mergeSha = "4".repeat(40);

function commit(
  id: string,
  sha: string,
  committedAt: string,
  options: {
    readonly filePaths?: readonly string[];
    readonly parentShas?: readonly string[];
  } = {}
): StructuralCommitEvidence {
  return {
    committedAt: new Date(committedAt),
    filePaths: options.filePaths ?? [`src/synthetic-${id}.ts`],
    id,
    parentShas: options.parentShas ?? [],
    sha,
  };
}

function pullRequest(
  id: string,
  providerPullRequestId: bigint,
  linkedCommitShas: readonly string[],
  options: {
    readonly mergeCommitSha?: string | null;
    readonly mergedAt?: string;
  } = {}
): StructuralPullRequestEvidence {
  return {
    id,
    linkedCommitShas,
    mergeCommitSha: options.mergeCommitSha ?? null,
    mergedAt: new Date(options.mergedAt ?? "2026-09-20T12:00:00.000Z"),
    providerPullRequestId,
  };
}

function evidence(
  commits: readonly StructuralCommitEvidence[] = [],
  pullRequests: readonly StructuralPullRequestEvidence[] = [],
  scope: { readonly projectId?: string; readonly repositoryId?: string } = {}
): StructuralEvidenceSet {
  return {
    commits,
    connectedRepositoryId: scope.repositoryId ?? repositoryId,
    projectId: scope.projectId ?? projectId,
    pullRequests,
  };
}

function harness(projectResult: unknown = null) {
  const prisma = {
    project: { findFirst: vi.fn().mockResolvedValue(projectResult) },
  };
  const logger = { info: vi.fn() };
  return {
    logger,
    prisma,
    service: new EvidenceGroupingService(
      prisma as unknown as PrismaService,
      logger as unknown as StructuredLogger
    ),
  };
}

describe("EvidenceGroupingService deterministic grouping", () => {
  it("forms one PR-backed group from a merged PR and its linked commit", () => {
    const { service } = harness();
    const groups = service.groupEvidence(
      evidence(
        [commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z")],
        [pullRequest("pr-1", 101n, [firstSha])]
      )
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      commitEvidenceIds: ["commit-1"],
      pullRequestEvidenceIds: ["pr-1"],
      reason: "merged_pull_request",
      groupingVersion: evidenceGroupingVersion,
    });
  });

  it("keeps multiple linked commits in one deterministically ordered PR group", () => {
    const { service } = harness();
    const groups = service.groupEvidence(
      evidence(
        [
          commit("commit-2", secondSha, "2026-09-20T11:00:00.000Z"),
          commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z"),
        ],
        [pullRequest("pr-1", 101n, [secondSha, firstSha])]
      )
    );

    expect(groups[0]?.commitEvidenceIds).toEqual(["commit-1", "commit-2"]);
  });

  it("does not duplicate PR-linked commits as standalone groups", () => {
    const { service } = harness();
    const groups = service.groupEvidence(
      evidence(
        [commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z")],
        [pullRequest("pr-1", 101n, [firstSha])]
      )
    );

    expect(groups.filter((group) => group.reason === "standalone_commit_chain"))
      .toHaveLength(0);
  });

  it("keeps one standalone commit groupable", () => {
    const { service } = harness();
    const groups = service.groupEvidence(
      evidence([commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z")])
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.commitEvidenceIds).toEqual(["commit-1"]);
  });

  it("keeps unrelated nearby standalone commits separate", () => {
    const { service } = harness();
    const groups = service.groupEvidence(
      evidence([
        commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z", {
          filePaths: ["src/one.ts"],
        }),
        commit("commit-2", secondSha, "2026-09-20T10:05:00.000Z", {
          filePaths: ["src/two.ts"],
          parentShas: [firstSha],
        }),
      ])
    );

    expect(groups).toHaveLength(2);
  });

  it("groups only adjacent standalone commits with exact file overlap inside 24 hours", () => {
    const { service } = harness();
    const groups = service.groupEvidence(
      evidence([
        commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z", {
          filePaths: ["src/shared.ts"],
        }),
        commit("commit-2", secondSha, "2026-09-20T11:00:00.000Z", {
          filePaths: ["SRC" + String.fromCharCode(92) + "shared.ts"],
          parentShas: [firstSha],
        }),
      ])
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.commitEvidenceIds).toEqual(["commit-1", "commit-2"]);
  });

  it("uses SHA and ID tie-breakers when timestamps are equal", () => {
    const { service } = harness();
    const groups = service.groupEvidence(
      evidence([
        commit("commit-2", secondSha, "2026-09-20T10:00:00.000Z"),
        commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z"),
      ])
    );

    expect(groups.map((group) => group.commitEvidenceIds[0])).toEqual([
      "commit-1",
      "commit-2",
    ]);
  });

  it("returns the same groups and keys for the same input in a different order", () => {
    const { service } = harness();
    const commits = [
      commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z"),
      commit("commit-2", secondSha, "2026-09-20T11:00:00.000Z"),
    ];
    const prs = [
      pullRequest("pr-1", 101n, [firstSha]),
      pullRequest("pr-2", 102n, [secondSha], {
        mergedAt: "2026-09-20T13:00:00.000Z",
      }),
    ];

    expect(service.groupEvidence(evidence(commits, prs))).toEqual(
      service.groupEvidence(evidence([...commits].reverse(), [...prs].reverse()))
    );
  });

  it("isolates the same SHA by repository and Project in group identity", () => {
    const { service } = harness();
    const sharedCommit = commit(
      "commit-1",
      firstSha,
      "2026-09-20T10:00:00.000Z"
    );
    const first = service.groupEvidence(evidence([sharedCommit]))[0];
    const second = service.groupEvidence(
      evidence([sharedCommit], [], {
        projectId: otherProjectId,
        repositoryId: otherRepositoryId,
      })
    )[0];

    expect(first?.projectId).toBe(projectId);
    expect(second?.projectId).toBe(otherProjectId);
    expect(first?.groupKey).not.toBe(second?.groupKey);
  });

  it("lets explicit PR relations outrank standalone structural adjacency", () => {
    const { service } = harness();
    const groups = service.groupEvidence(
      evidence(
        [
          commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z", {
            filePaths: ["src/shared.ts"],
          }),
          commit("commit-2", secondSha, "2026-09-20T11:00:00.000Z", {
            filePaths: ["src/shared.ts"],
            parentShas: [firstSha],
          }),
        ],
        [pullRequest("pr-1", 101n, [secondSha])]
      )
    );

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.reason === "merged_pull_request")?.commitEvidenceIds)
      .toEqual(["commit-2"]);
  });

  it("attaches a selected merge commit to its PR without a duplicate group", () => {
    const { service } = harness();
    const groups = service.groupEvidence(
      evidence(
        [
          commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z"),
          commit("merge", mergeSha, "2026-09-20T12:00:00.000Z", {
            parentShas: [firstSha, thirdSha],
          }),
        ],
        [
          pullRequest("pr-1", 101n, [firstSha], {
            mergeCommitSha: mergeSha,
          }),
        ]
      )
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.commitEvidenceIds).toEqual(["commit-1", "merge"]);
  });

  it("suppresses an unlinked merge commit when a constituent parent is represented", () => {
    const { service } = harness();
    const groups = service.groupEvidence(
      evidence([
        commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z"),
        commit("merge", mergeSha, "2026-09-20T12:00:00.000Z", {
          parentShas: [firstSha, thirdSha],
        }),
      ])
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.commitEvidenceIds).toEqual(["commit-1"]);
  });

  it("returns no candidate for empty evidence", () => {
    const { service } = harness();
    expect(service.groupEvidence(evidence())).toEqual([]);
  });

  it("changes the fingerprint when grouping version changes", () => {
    const { service } = harness();
    const input = evidence([
      commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z"),
    ]);
    const first = service.groupEvidence(input, "evidence-grouping-v1")[0];
    const second = service.groupEvidence(input, "evidence-grouping-v2")[0];

    expect(first?.groupKey).not.toBe(second?.groupKey);
    expect(second?.groupingVersion).toBe("evidence-grouping-v2");
  });

  it("does not destabilize an explicit PR group when unrelated evidence is added", () => {
    const { service } = harness();
    const pr = pullRequest("pr-1", 101n, [firstSha]);
    const linked = commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z");
    const initial = service.groupEvidence(evidence([linked], [pr]));
    const expanded = service.groupEvidence(
      evidence(
        [linked, commit("commit-3", thirdSha, "2026-09-20T14:00:00.000Z")],
        [pr]
      )
    );

    expect(initial[0]?.groupKey).toBe(
      expanded.find((group) => group.reason === "merged_pull_request")?.groupKey
    );
  });

  it("produces only structural contract fields and no semantic interpretation", () => {
    const { service } = harness();
    const group = service.groupEvidence(
      evidence([commit("commit-1", firstSha, "2026-09-20T10:00:00.000Z")])
    )[0];

    expect(Object.keys(group ?? {}).sort()).toEqual([
      "commitEvidenceIds",
      "connectedRepositoryId",
      "evidenceFrom",
      "evidenceTo",
      "groupKey",
      "groupingVersion",
      "projectId",
      "pullRequestEvidenceIds",
      "reason",
    ]);
    expect(group).not.toHaveProperty("summary");
    expect(group).not.toHaveProperty("type");
    expect(group).not.toHaveProperty("confidence");
  });
});

describe("EvidenceGroupingService selection boundary", () => {
  const request = {
    evaluationBoundary: new Date("2026-09-21T00:00:00.000Z"),
    projectId,
    sourceWindowStart: new Date("2026-09-01T00:00:00.000Z"),
    userId,
  };

  it("selects only owned, active, non-orphaned, non-bot, bounded evidence", async () => {
    const projectResult = {
      id: projectId,
      connectedRepository: {
        id: repositoryId,
        commits: [],
        pullRequests: [],
      },
    };
    const { prisma, service } = harness(projectResult);

    await service.selectAndGroup(request);

    expect(prisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: projectId,
          userId,
          connectedRepository: {
            is: {
              status: "active",
              gitHubConnection: { status: "active" },
            },
          },
        },
        select: expect.objectContaining({
          connectedRepository: {
            select: expect.objectContaining({
              commits: expect.objectContaining({
                take: 501,
                where: expect.objectContaining({ orphanedAt: null }),
              }),
              pullRequests: expect.objectContaining({ take: 501 }),
            }),
          },
        }),
      })
    );
  });

  it("fails closed when persisted ownership or active repository scope is absent", async () => {
    const { service } = harness(null);
    await expect(service.selectAndGroup(request)).rejects.toBeInstanceOf(
      EvidenceGroupingScopeError
    );
  });

  it("requires a fixed valid evaluation boundary within the 30-day window", async () => {
    const { prisma, service } = harness();
    await expect(
      service.selectAndGroup({
        ...request,
        sourceWindowStart: new Date("2026-08-01T00:00:00.000Z"),
      })
    ).rejects.toBeInstanceOf(EvidenceGroupingInputError);
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
  });

  it("fails rather than truncating when a selection exceeds its cap", async () => {
    const commits = Array.from({ length: 501 }, (_, index) => ({
      committedAt: new Date("2026-09-20T10:00:00.000Z"),
      files: [],
      id: `commit-${index}`,
      parentShas: [],
      sha: index.toString(16).padStart(40, "0"),
    }));
    const { service } = harness({
      id: projectId,
      connectedRepository: {
        id: repositoryId,
        commits,
        pullRequests: [],
      },
    });

    await expect(service.selectAndGroup(request)).rejects.toBeInstanceOf(
      EvidenceSelectionLimitError
    );
  });

  it("performs no provider, network, or LLM call and logs only safe metadata", async () => {
    const privatePath = "private/synthetic-secret-name.ts";
    const privateMessage = "synthetic private commit message";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { logger, service } = harness({
      id: projectId,
      connectedRepository: {
        id: repositoryId,
        commits: [
          {
            committedAt: new Date("2026-09-20T10:00:00.000Z"),
            files: [{ path: privatePath }],
            id: "commit-1",
            parentShas: [],
            sha: firstSha,
            message: privateMessage,
          },
        ],
        pullRequests: [],
      },
    });

    await service.selectAndGroup(request);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(privatePath);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(privateMessage);
    expect(logger.info).toHaveBeenCalledWith(
      "development_evidence_grouping_completed",
      expect.objectContaining({
        commitCount: 1,
        groupCount: 1,
        groupingVersion: evidenceGroupingVersion,
      })
    );
    fetchSpy.mockRestore();
  });
});
