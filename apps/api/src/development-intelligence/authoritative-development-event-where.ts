import { Prisma } from "../generated/prisma/client";

export const validSupportingCommitEvidenceWhere = {
  detachedAt: null,
  role: "supporting",
  gitHubCommit: { orphanedAt: null },
} satisfies Prisma.DevelopmentEventCommitEvidenceWhereInput;

export const validSupportingPullRequestEvidenceWhere = {
  detachedAt: null,
  role: "supporting",
  gitHubPullRequestId: { not: null },
} satisfies Prisma.DevelopmentEventPullRequestEvidenceWhereInput;

/**
 * Shared Phase 2 authority predicate. Keep this aligned with the persisted
 * supporting-evidence relations; candidate evidence never establishes authority.
 */
export function authoritativeDevelopmentEventWhere(
  projectId?: string
): Prisma.DevelopmentEventWhereInput {
  return {
    ...(projectId === undefined ? {} : { projectId }),
    status: "active",
    OR: [
      { commitEvidence: { some: validSupportingCommitEvidenceWhere } },
      { pullRequestEvidence: { some: validSupportingPullRequestEvidenceWhere } },
    ],
  };
}
