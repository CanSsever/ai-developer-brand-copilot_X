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
