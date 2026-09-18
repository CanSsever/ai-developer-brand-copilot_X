import { Inject, Injectable } from "@nestjs/common";

import { GitHubAppAuthService } from "./github-app-auth.service";
import { GITHUB_APP_CONFIG, GITHUB_FETCH } from "./github.tokens";
import type {
  AuthorizedGitHubRepository,
  GitHubAppConfig,
  GitHubCommitEvidence,
  GitHubCommitFileEvidence,
  GitHubCommitListResult,
  GitHubCommitSummary,
  GitHubCommitWindow,
  VerifiedGitHubInstallation,
} from "./github.types";

const apiVersion = "2026-03-10";
const maxRepositoryPages = 100;
const commitPageSize = 100;
const maxCommitItems = 500;
const maxCommitPages = maxCommitItems / commitPageSize + 1;
const filePageSize = 100;
const maxFileItems = 3_000;
const maxFilePages = maxFileItems / filePageSize + 1;
const maxSyncFileItems = 10_000;
const shaPattern = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export type GitHubIntegrationFailureCode =
  | "GITHUB_AUTHORIZATION_FAILED"
  | "GITHUB_PROVIDER_UNAVAILABLE"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_RESPONSE_INVALID"
  | "GITHUB_SAFETY_LIMIT_EXCEEDED";

export class GitHubIntegrationError extends Error {
  constructor(
    readonly failureCode: GitHubIntegrationFailureCode =
      "GITHUB_AUTHORIZATION_FAILED",
    readonly retryable = false
  ) {
    super("GitHub authorization could not be verified");
    this.name = "GitHubIntegrationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function positiveBigInt(value: unknown): bigint | null {
  if ((typeof value !== "number" && typeof value !== "string") || `${value}` === "") {
    return null;
  }

  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    return null;
  }

  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function requiredDate(value: unknown): Date {
  if (typeof value !== "string") {
    throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
  }
  return date;
}

function optionalBoundedText(value: unknown, maximumLength: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
  }
  return value === "" ? null : value;
}

function requireSha(value: unknown): string {
  if (typeof value !== "string" || !shaPattern.test(value)) {
    throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
  }
  return value;
}

@Injectable()
export class GitHubApiService {
  constructor(
    @Inject(GITHUB_APP_CONFIG) private readonly config: GitHubAppConfig,
    @Inject(GITHUB_FETCH) private readonly fetcher: typeof fetch,
    private readonly appAuth: GitHubAppAuthService
  ) {}

  async exchangeUserCode(code: string): Promise<string> {
    const response = await this.fetcher(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          redirect_uri: this.config.callbackUrl,
        }),
      }
    );
    if (!response.ok) {
      throw new GitHubIntegrationError();
    }
    const body = await this.readJson(response);
    if (!isRecord(body) || typeof body.access_token !== "string") {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }

    return body.access_token;
  }

  async verifyInstallationForUser(
    installationId: bigint,
    userAccessToken: string
  ): Promise<VerifiedGitHubInstallation> {
    const appResponse = await this.apiRequest(
      `/app/installations/${installationId}`,
      this.appAuth.createAppJwt()
    );
    if (!appResponse.ok) {
      throw this.providerError(appResponse);
    }
    const appBody = await this.readJson(appResponse);
    if (!isRecord(appBody)) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }

    const verifiedInstallationId = positiveBigInt(appBody.id);
    const account = appBody.account;
    if (
      verifiedInstallationId !== installationId ||
      !isRecord(account) ||
      typeof account.login !== "string" ||
      typeof account.type !== "string"
    ) {
      throw new GitHubIntegrationError();
    }

    const accountId = positiveBigInt(account.id);
    if (!accountId) {
      throw new GitHubIntegrationError();
    }

    const userResponse = await this.apiRequest(
      `/user/installations/${installationId}/repositories?per_page=1`,
      userAccessToken
    );

    if (!userResponse.ok) {
      throw new GitHubIntegrationError();
    }

    return {
      installationId,
      accountId,
      accountLogin: account.login,
      accountType: account.type,
    };
  }

  async listInstallationRepositories(
    installationId: bigint
  ): Promise<readonly AuthorizedGitHubRepository[]> {
    const installationToken = await this.createInstallationToken(installationId);
    const repositories: AuthorizedGitHubRepository[] = [];

    for (let page = 1; page <= maxRepositoryPages; page += 1) {
      const response = await this.apiRequest(
        `/installation/repositories?per_page=100&page=${page}`,
        installationToken
      );
      if (!response.ok) {
        throw this.providerError(response);
      }
      const body = await this.readJson(response);
      if (!isRecord(body) || !Array.isArray(body.repositories)) {
        throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
      }

      const pageRepositories = body.repositories.map((repository) =>
        this.parseRepository(repository)
      );
      repositories.push(...pageRepositories);
      const totalCount =
        typeof body.total_count === "number" ? body.total_count : repositories.length;

      if (pageRepositories.length < 100 || repositories.length >= totalCount) {
        return repositories;
      }
    }

    throw new GitHubIntegrationError();
  }

  async listRepositoryCommitSummaries(
    installationId: bigint,
    repositoryId: bigint,
    window: GitHubCommitWindow
  ): Promise<GitHubCommitListResult> {
    const installationToken = await this.createInstallationToken(installationId);
    const repository = await this.resolveRepository(
      repositoryId,
      installationToken
    );
    const commits: GitHubCommitSummary[] = [];

    for (let page = 1; page <= maxCommitPages; page += 1) {
      const query = new URLSearchParams({
        page: String(page),
        per_page: String(commitPageSize),
        sha: repository.defaultBranch,
        since: window.since.toISOString(),
        until: window.until.toISOString(),
      });
      const response = await this.apiRequest(
        `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits?${query.toString()}`,
        installationToken
      );
      if (!response.ok) {
        throw this.providerError(response);
      }
      const body = await this.readJson(response);
      if (!Array.isArray(body) || body.length > commitPageSize) {
        throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
      }

      const pageCommits = body.map((value) => this.parseCommitSummary(value));
      if (commits.length + pageCommits.length > maxCommitItems) {
        throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
      }
      commits.push(...pageCommits);

      if (pageCommits.length < commitPageSize) {
        return { commits, repository };
      }
    }

    throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
  }

  async getRepositoryCommitDetails(
    installationId: bigint,
    repository: AuthorizedGitHubRepository,
    shas: readonly string[]
  ): Promise<readonly GitHubCommitEvidence[]> {
    if (shas.length > maxCommitItems) {
      throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
    }
    if (shas.length === 0) {
      return [];
    }

    const installationToken = await this.createInstallationToken(installationId);
    const details: GitHubCommitEvidence[] = [];
    let totalFiles = 0;
    for (const sha of shas) {
      const detail = await this.getCommitDetail(
        repository,
        requireSha(sha),
        installationToken
      );
      totalFiles += detail.files.length;
      if (totalFiles > maxSyncFileItems) {
        throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
      }
      details.push(detail);
    }
    return details;
  }

  private async createInstallationToken(installationId: bigint): Promise<string> {
    const response = await this.apiRequest(
      `/app/installations/${installationId}/access_tokens`,
      this.appAuth.createAppJwt(),
      { method: "POST" }
    );
    if (!response.ok) {
      throw this.providerError(response);
    }
    const body = await this.readJson(response);
    if (!isRecord(body) || typeof body.token !== "string") {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }

    return body.token;
  }

  private async apiRequest(
    path: string,
    token: string,
    init: RequestInit = {}
  ): Promise<Response> {
    try {
      return await this.fetcher(`https://api.github.com${path}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": apiVersion,
          ...init.headers,
        },
      });
    } catch {
      throw new GitHubIntegrationError(
        "GITHUB_PROVIDER_UNAVAILABLE",
        true
      );
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }
  }

  private parseRepository(value: unknown): AuthorizedGitHubRepository {
    if (!isRecord(value) || !isRecord(value.owner)) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }

    const id = positiveBigInt(value.id);
    if (
      !id ||
      typeof value.name !== "string" ||
      typeof value.default_branch !== "string" ||
      typeof value.private !== "boolean" ||
      typeof value.owner.login !== "string"
    ) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }

    return {
      id,
      name: value.name,
      owner: value.owner.login,
      defaultBranch: value.default_branch,
      isPrivate: value.private,
    };
  }

  private async resolveRepository(
    repositoryId: bigint,
    installationToken: string
  ): Promise<AuthorizedGitHubRepository> {
    const response = await this.apiRequest(
      `/repositories/${repositoryId}`,
      installationToken
    );
    if (!response.ok) {
      throw this.providerError(response);
    }
    const body = await this.readJson(response);

    const repository = this.parseRepository(body);
    if (repository.id !== repositoryId) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }
    return repository;
  }

  private parseCommitSummary(value: unknown): GitHubCommitSummary {
    if (!isRecord(value)) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }
    return { sha: requireSha(value.sha) };
  }

  private async getCommitDetail(
    repository: AuthorizedGitHubRepository,
    expectedSha: string,
    installationToken: string
  ): Promise<GitHubCommitEvidence> {
    const files: GitHubCommitFileEvidence[] = [];
    let base: Omit<GitHubCommitEvidence, "changedFiles" | "files"> | null = null;

    for (let page = 1; page <= maxFilePages; page += 1) {
      const query = new URLSearchParams({
        page: String(page),
        per_page: String(filePageSize),
      });
      const response = await this.apiRequest(
        `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${expectedSha}?${query.toString()}`,
        installationToken
      );
      if (!response.ok) {
        throw this.providerError(response);
      }
      const body = await this.readJson(response);
      if (!isRecord(body) || !Array.isArray(body.files)) {
        throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
      }
      if (requireSha(body.sha) !== expectedSha || body.files.length > filePageSize) {
        throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
      }

      if (!base) {
        base = this.parseCommitEvidenceBase(body);
      }
      const pageFiles = body.files.map((value) => this.parseCommitFile(value));
      if (files.length + pageFiles.length > maxFileItems) {
        throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
      }
      files.push(...pageFiles);

      if (pageFiles.length < filePageSize) {
        if (!base) {
          throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
        }
        if (new Set(files.map((file) => file.path)).size !== files.length) {
          throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
        }
        return { ...base, changedFiles: files.length, files };
      }
    }

    throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
  }

  private parseCommitEvidenceBase(
    value: Record<string, unknown>
  ): Omit<GitHubCommitEvidence, "changedFiles" | "files"> {
    if (
      !isRecord(value.commit) ||
      !isRecord(value.commit.author) ||
      !isRecord(value.commit.committer) ||
      typeof value.commit.message !== "string" ||
      !Array.isArray(value.parents)
    ) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }

    const stats = isRecord(value.stats) ? value.stats : null;
    const additions = stats ? nonnegativeInteger(stats.additions) : null;
    const deletions = stats ? nonnegativeInteger(stats.deletions) : null;
    if (
      stats &&
      (additions === null || deletions === null)
    ) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }

    return {
      additions,
      authorLogin: isRecord(value.author)
        ? optionalBoundedText(value.author.login, 255)
        : null,
      authorName: optionalBoundedText(value.commit.author.name, 255),
      authoredAt: requiredDate(value.commit.author.date),
      committedAt: requiredDate(value.commit.committer.date),
      deletions,
      message: value.commit.message,
      parentShas: value.parents.map((parent) => {
        if (!isRecord(parent)) {
          throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
        }
        return requireSha(parent.sha);
      }),
      sha: requireSha(value.sha),
    };
  }

  private parseCommitFile(value: unknown): GitHubCommitFileEvidence {
    if (
      !isRecord(value) ||
      typeof value.filename !== "string" ||
      value.filename === "" ||
      typeof value.status !== "string" ||
      value.status === "" ||
      value.status.length > 32
    ) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }

    const additions = nonnegativeInteger(value.additions);
    const deletions = nonnegativeInteger(value.deletions);
    const changes = nonnegativeInteger(value.changes);
    if (additions === null || deletions === null || changes === null) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }

    return {
      additions,
      changes,
      deletions,
      path: value.filename,
      previousPath:
        typeof value.previous_filename === "string"
          ? value.previous_filename
          : null,
      status: value.status,
    };
  }

  private providerError(response: Response): GitHubIntegrationError {
    if (
      response.status === 429 ||
      (response.status === 403 &&
        response.headers.get("x-ratelimit-remaining") === "0")
    ) {
      return new GitHubIntegrationError("GITHUB_RATE_LIMITED", true);
    }
    if (response.status >= 500) {
      return new GitHubIntegrationError(
        "GITHUB_PROVIDER_UNAVAILABLE",
        true
      );
    }
    return new GitHubIntegrationError("GITHUB_AUTHORIZATION_FAILED");
  }
}
