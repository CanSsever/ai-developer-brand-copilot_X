import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";
import { StructuredLogger } from "../observability/structured-logger";
import {
  evidenceGroupingVersion,
  type CandidateEvidenceGroup,
  type EvidenceGroupingReason,
  type EvidenceGroupingRequest,
  type StructuralCommitEvidence,
  type StructuralEvidenceSet,
  type StructuralPullRequestEvidence,
} from "./evidence-grouping.types";

const maximumEvidenceRecordsPerKind = 500;
const maximumSourceWindowMs = 30 * 24 * 60 * 60 * 1_000;
const standaloneAdjacencyMs = 24 * 60 * 60 * 1_000;

export class EvidenceGroupingInputError extends Error {
  constructor() {
    super("Evidence grouping input is invalid");
    this.name = "EvidenceGroupingInputError";
  }
}

export class EvidenceGroupingScopeError extends Error {
  constructor() {
    super("Evidence grouping scope is not available");
    this.name = "EvidenceGroupingScopeError";
  }
}

export class EvidenceSelectionLimitError extends Error {
  constructor() {
    super("Evidence grouping selection limit exceeded");
    this.name = "EvidenceSelectionLimitError";
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCommits(
  left: StructuralCommitEvidence,
  right: StructuralCommitEvidence
): number {
  return (
    left.committedAt.getTime() - right.committedAt.getTime() ||
    compareText(left.sha, right.sha) ||
    compareText(left.id, right.id)
  );
}

function comparePullRequests(
  left: StructuralPullRequestEvidence,
  right: StructuralPullRequestEvidence
): number {
  return (
    left.mergedAt.getTime() - right.mergedAt.getTime() ||
    (left.providerPullRequestId < right.providerPullRequestId
      ? -1
      : left.providerPullRequestId > right.providerPullRequestId
        ? 1
        : compareText(left.id, right.id))
  );
}

function normalizedPaths(commit: StructuralCommitEvidence): ReadonlySet<string> {
  return new Set(
    commit.filePaths.map((path) =>
      path.split(String.fromCharCode(92)).join("/").toLowerCase()
    )
  );
}

function pathsOverlap(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  for (const path of left) {
    if (right.has(path)) return true;
  }
  return false;
}

function areStandaloneNeighbors(
  left: StructuralCommitEvidence,
  right: StructuralCommitEvidence,
  pathsBySha: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  if (
    Math.abs(left.committedAt.getTime() - right.committedAt.getTime()) >
    standaloneAdjacencyMs
  ) {
    return false;
  }

  const parentLinked =
    left.parentShas.includes(right.sha) || right.parentShas.includes(left.sha);
  if (!parentLinked) return false;

  return pathsOverlap(
    pathsBySha.get(left.sha) ?? new Set<string>(),
    pathsBySha.get(right.sha) ?? new Set<string>()
  );
}

function groupKey(
  evidence: StructuralEvidenceSet,
  commits: readonly StructuralCommitEvidence[],
  pullRequests: readonly StructuralPullRequestEvidence[],
  groupingVersion: string
): string {
  const identities = [
    `version:${groupingVersion}`,
    `project:${evidence.projectId}`,
    `repository:${evidence.connectedRepositoryId}`,
    ...commits.map((commit) => `commit:${commit.sha}`).sort(compareText),
    ...pullRequests
      .map((pullRequest) => `pr:${pullRequest.providerPullRequestId.toString()}`)
      .sort(compareText),
  ];
  return createHash("sha256").update(identities.join("\0")).digest("hex");
}

function candidateGroup(
  evidence: StructuralEvidenceSet,
  commits: readonly StructuralCommitEvidence[],
  pullRequests: readonly StructuralPullRequestEvidence[],
  reason: EvidenceGroupingReason,
  groupingVersion: string
): CandidateEvidenceGroup {
  const orderedCommits = [...commits].sort(compareCommits);
  const orderedPullRequests = [...pullRequests].sort(comparePullRequests);
  const timestamps = [
    ...orderedCommits.map((commit) => commit.committedAt.getTime()),
    ...orderedPullRequests.map((pullRequest) => pullRequest.mergedAt.getTime()),
  ];

  return {
    commitEvidenceIds: orderedCommits.map((commit) => commit.id),
    connectedRepositoryId: evidence.connectedRepositoryId,
    evidenceFrom: new Date(Math.min(...timestamps)),
    evidenceTo: new Date(Math.max(...timestamps)),
    groupKey: groupKey(
      evidence,
      orderedCommits,
      orderedPullRequests,
      groupingVersion
    ),
    groupingVersion,
    projectId: evidence.projectId,
    pullRequestEvidenceIds: orderedPullRequests.map(
      (pullRequest) => pullRequest.id
    ),
    reason,
  };
}

@Injectable()
export class EvidenceGroupingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLogger
  ) {}

  async selectAndGroup(
    request: EvidenceGroupingRequest
  ): Promise<readonly CandidateEvidenceGroup[]> {
    this.validateRequest(request);
    const evidence = await this.selectEvidence(request);
    const groups = this.groupEvidence(evidence);
    this.logger.info("development_evidence_grouping_completed", {
      commitCount: evidence.commits.length,
      groupCount: groups.length,
      groupingVersion: evidenceGroupingVersion,
      projectId: evidence.projectId,
      pullRequestCount: evidence.pullRequests.length,
    });
    return groups;
  }

  groupEvidence(
    evidence: StructuralEvidenceSet,
    groupingVersion = evidenceGroupingVersion
  ): readonly CandidateEvidenceGroup[] {
    if (groupingVersion.length === 0) throw new EvidenceGroupingInputError();

    const commits = [...evidence.commits].sort(compareCommits);
    const pullRequests = [...evidence.pullRequests].sort(comparePullRequests);
    const commitsBySha = new Map(commits.map((commit) => [commit.sha, commit]));
    const claimedByPullRequest = new Set<string>();
    const groups: CandidateEvidenceGroup[] = [];

    for (const pullRequest of pullRequests) {
      const relatedShas = new Set(pullRequest.linkedCommitShas);
      if (pullRequest.mergeCommitSha) relatedShas.add(pullRequest.mergeCommitSha);
      const relatedCommits = [...relatedShas]
        .map((sha) => commitsBySha.get(sha))
        .filter((commit): commit is StructuralCommitEvidence => Boolean(commit));
      for (const commit of relatedCommits) claimedByPullRequest.add(commit.sha);
      groups.push(
        candidateGroup(
          evidence,
          relatedCommits,
          [pullRequest],
          "merged_pull_request",
          groupingVersion
        )
      );
    }

    const unclaimed = commits.filter(
      (commit) => !claimedByPullRequest.has(commit.sha)
    );
    const unclaimedShas = new Set(unclaimed.map((commit) => commit.sha));
    const standalone = unclaimed.filter(
      (commit) =>
        commit.parentShas.length < 2 ||
        !commit.parentShas.some((parentSha) => unclaimedShas.has(parentSha))
    );
    const pathsBySha = new Map(
      standalone.map((commit) => [commit.sha, normalizedPaths(commit)])
    );
    const visited = new Set<string>();

    for (const root of standalone) {
      if (visited.has(root.sha)) continue;
      const component: StructuralCommitEvidence[] = [];
      const pending = [root];
      visited.add(root.sha);
      while (pending.length > 0) {
        const current = pending.shift();
        if (!current) break;
        component.push(current);
        for (const candidate of standalone) {
          if (
            !visited.has(candidate.sha) &&
            areStandaloneNeighbors(current, candidate, pathsBySha)
          ) {
            visited.add(candidate.sha);
            pending.push(candidate);
          }
        }
      }
      groups.push(
        candidateGroup(
          evidence,
          component,
          [],
          "standalone_commit_chain",
          groupingVersion
        )
      );
    }

    return groups.sort(
      (left, right) =>
        left.evidenceFrom.getTime() - right.evidenceFrom.getTime() ||
        left.evidenceTo.getTime() - right.evidenceTo.getTime() ||
        compareText(left.groupKey, right.groupKey)
    );
  }

  private validateRequest(request: EvidenceGroupingRequest): void {
    const from = request.sourceWindowStart.getTime();
    const to = request.evaluationBoundary.getTime();
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from > to ||
      to - from > maximumSourceWindowMs
    ) {
      throw new EvidenceGroupingInputError();
    }
  }

  private async selectEvidence(
    request: EvidenceGroupingRequest
  ): Promise<StructuralEvidenceSet> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: request.projectId,
        userId: request.userId,
        connectedRepository: {
          is: {
            status: "active",
            gitHubConnection: { status: "active" },
          },
        },
      },
      select: {
        id: true,
        connectedRepository: {
          select: {
            id: true,
            commits: {
              where: {
                committedAt: {
                  gte: request.sourceWindowStart,
                  lte: request.evaluationBoundary,
                },
                orphanedAt: null,
                OR: [
                  { authorLogin: null },
                  {
                    NOT: {
                      authorLogin: {
                        endsWith: "[bot]",
                        mode: "insensitive",
                      },
                    },
                  },
                ],
              },
              orderBy: [{ committedAt: "asc" }, { sha: "asc" }],
              take: maximumEvidenceRecordsPerKind + 1,
              select: {
                committedAt: true,
                files: { select: { path: true } },
                id: true,
                parentShas: true,
                sha: true,
              },
            },
            pullRequests: {
              where: {
                state: "closed",
                mergedAt: {
                  gte: request.sourceWindowStart,
                  lte: request.evaluationBoundary,
                },
              },
              orderBy: [
                { mergedAt: "asc" },
                { providerPullRequestId: "asc" },
              ],
              take: maximumEvidenceRecordsPerKind + 1,
              select: {
                id: true,
                linkedCommits: { select: { sha: true } },
                mergeCommitSha: true,
                mergedAt: true,
                providerPullRequestId: true,
              },
            },
          },
        },
      },
    });
    if (!project?.connectedRepository) throw new EvidenceGroupingScopeError();
    if (
      project.connectedRepository.commits.length > maximumEvidenceRecordsPerKind ||
      project.connectedRepository.pullRequests.length >
        maximumEvidenceRecordsPerKind
    ) {
      throw new EvidenceSelectionLimitError();
    }

    return {
      commits: project.connectedRepository.commits.map((commit) => ({
        committedAt: commit.committedAt,
        filePaths: commit.files.map((file) => file.path),
        id: commit.id,
        parentShas: commit.parentShas,
        sha: commit.sha,
      })),
      connectedRepositoryId: project.connectedRepository.id,
      projectId: project.id,
      pullRequests: project.connectedRepository.pullRequests.map(
        (pullRequest) => ({
          id: pullRequest.id,
          linkedCommitShas: pullRequest.linkedCommits.map(
            (commit) => commit.sha
          ),
          mergeCommitSha: pullRequest.mergeCommitSha,
          mergedAt: pullRequest.mergedAt,
          providerPullRequestId: pullRequest.providerPullRequestId,
        })
      ),
    };
  }
}
