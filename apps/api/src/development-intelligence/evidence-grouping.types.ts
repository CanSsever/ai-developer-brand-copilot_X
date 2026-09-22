export const evidenceGroupingVersion = "evidence-grouping-v1";

export type EvidenceGroupingReason =
  | "merged_pull_request"
  | "standalone_commit_chain";

export interface CandidateEvidenceGroup {
  readonly commitEvidenceIds: readonly string[];
  readonly connectedRepositoryId: string;
  readonly evidenceFrom: Date;
  readonly evidenceTo: Date;
  readonly groupKey: string;
  readonly groupingVersion: string;
  readonly projectId: string;
  readonly pullRequestEvidenceIds: readonly string[];
  readonly reason: EvidenceGroupingReason;
}

export interface EvidenceGroupingRequest {
  readonly evaluationBoundary: Date;
  readonly projectId: string;
  readonly sourceWindowStart: Date;
  readonly userId: string;
}

export interface StructuralCommitEvidence {
  readonly committedAt: Date;
  readonly filePaths: readonly string[];
  readonly id: string;
  readonly parentShas: readonly string[];
  readonly sha: string;
}

export interface StructuralPullRequestEvidence {
  readonly id: string;
  readonly linkedCommitShas: readonly string[];
  readonly mergeCommitSha: string | null;
  readonly mergedAt: Date;
  readonly providerPullRequestId: bigint;
}

export interface StructuralEvidenceSet {
  readonly commits: readonly StructuralCommitEvidence[];
  readonly connectedRepositoryId: string;
  readonly projectId: string;
  readonly pullRequests: readonly StructuralPullRequestEvidence[];
}
