export interface GitHubAppConfig {
  readonly callbackUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly privateKey: string;
  readonly slug: string;
}

export interface VerifiedGitHubInstallation {
  readonly accountId: bigint;
  readonly accountLogin: string;
  readonly accountType: string;
  readonly installationId: bigint;
}

export interface AuthorizedGitHubRepository {
  readonly defaultBranch: string;
  readonly id: bigint;
  readonly isPrivate: boolean;
  readonly name: string;
  readonly owner: string;
}

export interface GitHubCommitWindow {
  readonly since: Date;
  readonly until: Date;
}

export interface GitHubCommitSummary {
  readonly sha: string;
}

export interface GitHubCommitFileEvidence {
  readonly additions: number;
  readonly changes: number;
  readonly deletions: number;
  readonly path: string;
  readonly previousPath: string | null;
  readonly status: string;
}

export interface GitHubCommitEvidence {
  readonly additions: number | null;
  readonly authorLogin: string | null;
  readonly authorName: string | null;
  readonly authoredAt: Date;
  readonly changedFiles: number | null;
  readonly committedAt: Date;
  readonly deletions: number | null;
  readonly files: readonly GitHubCommitFileEvidence[];
  readonly message: string;
  readonly parentShas: readonly string[];
  readonly sha: string;
}

export interface GitHubCommitListResult {
  readonly attemptCount: number;
  readonly commits: readonly GitHubCommitSummary[];
  readonly repository: AuthorizedGitHubRepository;
}

export interface GitHubCommitDetailResult {
  readonly attemptCount: number;
  readonly commits: readonly GitHubCommitEvidence[];
}

export interface GitHubPullRequestFileEvidence {
  readonly additions: number;
  readonly changes: number;
  readonly deletions: number;
  readonly path: string;
  readonly previousPath: string | null;
  readonly status: string;
}

export interface GitHubPullRequestEvidence {
  readonly additions: number;
  readonly authorLogin: string | null;
  readonly baseBranch: string;
  readonly bodySummary: string | null;
  readonly changedFiles: number;
  readonly commitShas: readonly string[];
  readonly deletions: number;
  readonly files: readonly GitHubPullRequestFileEvidence[];
  readonly headBranch: string;
  readonly mergeCommitSha: string | null;
  readonly mergedAt: Date;
  readonly number: number;
  readonly providerCreatedAt: Date;
  readonly providerPullRequestId: bigint;
  readonly providerUpdatedAt: Date;
  readonly state: "closed";
  readonly title: string;
}

export interface GitHubPullRequestListResult {
  readonly attemptCount: number;
  readonly pullRequests: readonly GitHubPullRequestEvidence[];
}
