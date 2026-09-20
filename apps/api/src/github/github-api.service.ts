import { Inject, Injectable, Optional } from "@nestjs/common";

import { StructuredLogger } from "../observability/structured-logger";
import { GitHubAppAuthService } from "./github-app-auth.service";
import {
  GITHUB_APP_CONFIG,
  GITHUB_FETCH,
  GITHUB_RETRY_DELAY,
  GITHUB_RETRY_RANDOM,
  GITHUB_SYNC_CLOCK,
} from "./github.tokens";
import type {
  AuthorizedGitHubRepository,
  GitHubAppConfig,
  GitHubCommitDetailResult,
  GitHubCommitEvidence,
  GitHubCommitFileEvidence,
  GitHubCommitListResult,
  GitHubCommitSummary,
  GitHubCommitWindow,
  GitHubPullRequestEvidence,
  GitHubPullRequestListResult,
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
const pullRequestPageSize = 100;
const maxPullRequestItems = 500;
const maxPullRequestPages = maxPullRequestItems / pullRequestPageSize + 1;
const maxPullRequestCommitItems = 250;
const maxPullRequestCommitPages =
  Math.ceil(maxPullRequestCommitItems / commitPageSize) + 1;
const maxPullRequestBodyLength = 2_000;
const shaPattern = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
export const githubProviderRetryPolicy = Object.freeze({
  maximumAttempts: 3,
  baseDelayMs: 250,
  maximumBackoffMs: 2_000,
  maximumInlineRetryDelayMs: 5_000,
  maximumRetryAfterMs: 24 * 60 * 60 * 1_000,
});

interface ProviderAttemptTracker {
  count: number;
}

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
    readonly retryable = false,
    readonly attemptCount = 0,
    readonly retryAfterAt: Date | null = null
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

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
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

function requiredBoundedText(value: unknown, maximumLength: number): string {
  const text = optionalBoundedText(value, maximumLength);
  if (!text) {
    throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
  }
  return text;
}

function limitedBodySummary(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
  }
  return value.slice(0, maxPullRequestBodyLength);
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
    private readonly appAuth: GitHubAppAuthService,
    @Optional()
    @Inject(GITHUB_SYNC_CLOCK)
    private readonly clock: () => Date = () => new Date(),
    @Optional()
    @Inject(GITHUB_RETRY_DELAY)
    private readonly delay: (milliseconds: number) => Promise<void> = (
      milliseconds
    ) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    @Optional()
    @Inject(GITHUB_RETRY_RANDOM)
    private readonly random: () => number = Math.random,
    @Optional() private readonly logger?: StructuredLogger
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
    return this.withAttemptTracking(async (tracker) => {
      const installationToken = await this.createInstallationToken(
        installationId,
        tracker
      );
      const repository = await this.resolveRepository(
        repositoryId,
        installationToken,
        tracker
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
          installationToken,
          {},
          tracker
        );
        const body = await this.readJson(response);
        if (!Array.isArray(body) || body.length > commitPageSize) {
          throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
        }

        const pageCommits = body.map((value) =>
          this.parseCommitSummary(value)
        );
        if (commits.length + pageCommits.length > maxCommitItems) {
          throw new GitHubIntegrationError(
            "GITHUB_SAFETY_LIMIT_EXCEEDED"
          );
        }
        commits.push(...pageCommits);

        if (pageCommits.length < commitPageSize) {
          return { attemptCount: tracker.count, commits, repository };
        }
      }

      throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
    });
  }

  async getRepositoryCommitDetails(
    installationId: bigint,
    repository: AuthorizedGitHubRepository,
    shas: readonly string[]
  ): Promise<GitHubCommitDetailResult> {
    return this.withAttemptTracking(async (tracker) => {
      if (shas.length > maxCommitItems) {
        throw new GitHubIntegrationError(
          "GITHUB_SAFETY_LIMIT_EXCEEDED"
        );
      }
      if (shas.length === 0) {
        return { attemptCount: 0, commits: [] };
      }

      const installationToken = await this.createInstallationToken(
        installationId,
        tracker
      );
      const details: GitHubCommitEvidence[] = [];
      let totalFiles = 0;
      for (const sha of shas) {
        const detail = await this.getCommitDetail(
          repository,
          requireSha(sha),
          installationToken,
          tracker
        );
        totalFiles += detail.files.length;
        if (totalFiles > maxSyncFileItems) {
          throw new GitHubIntegrationError(
            "GITHUB_SAFETY_LIMIT_EXCEEDED"
          );
        }
        details.push(detail);
      }
      return { attemptCount: tracker.count, commits: details };
    });
  }

  async listMergedPullRequests(
    installationId: bigint,
    repository: AuthorizedGitHubRepository,
    window: GitHubCommitWindow
  ): Promise<GitHubPullRequestListResult> {
    return this.withAttemptTracking(async (tracker) => {
      const installationToken = await this.createInstallationToken(
        installationId,
        tracker
      );
      const numbers: number[] = [];
      const seenNumbers = new Set<number>();

      for (let page = 1; page <= maxPullRequestPages; page += 1) {
        const query = new URLSearchParams({
          order: "desc",
          page: String(page),
          per_page: String(pullRequestPageSize),
          q: [
            `repo:${repository.owner}/${repository.name}`,
            "is:pr",
            "is:merged",
            `merged:${window.since.toISOString()}..${window.until.toISOString()}`,
          ].join(" "),
          sort: "updated",
        });
        const response = await this.apiRequest(
          `/search/issues?${query.toString()}`,
          installationToken,
          {},
          tracker
        );
        const body = await this.readJson(response);
        if (
          !isRecord(body) ||
          !Array.isArray(body.items) ||
          body.items.length > pullRequestPageSize ||
          !Number.isSafeInteger(body.total_count) ||
          (body.total_count as number) < 0
        ) {
          throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
        }
        if ((body.total_count as number) > maxPullRequestItems) {
          throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
        }

        for (const item of body.items) {
          if (!isRecord(item) || !isRecord(item.pull_request)) {
            throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
          }
          const number = positiveInteger(item.number);
          if (number === null || seenNumbers.has(number)) {
            throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
          }
          seenNumbers.add(number);
          numbers.push(number);
        }

        if (
          body.items.length < pullRequestPageSize ||
          numbers.length >= (body.total_count as number)
        ) {
          break;
        }
        if (page === maxPullRequestPages) {
          throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
        }
      }

      const pullRequests: GitHubPullRequestEvidence[] = [];
      let totalFiles = 0;
      for (const number of numbers) {
        const evidence = await this.getPullRequestEvidence(
          repository,
          number,
          installationToken,
          tracker,
          window
        );
        if (!evidence) continue;
        totalFiles += evidence.files.length;
        if (totalFiles > maxSyncFileItems) {
          throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
        }
        pullRequests.push(evidence);
      }

      return { attemptCount: tracker.count, pullRequests };
    });
  }

  private async createInstallationToken(
    installationId: bigint,
    tracker: ProviderAttemptTracker = { count: 0 }
  ): Promise<string> {
    const response = await this.apiRequest(
      `/app/installations/${installationId}/access_tokens`,
      this.appAuth.createAppJwt(),
      { method: "POST" },
      tracker
    );
    const body = await this.readJson(response);
    if (!isRecord(body) || typeof body.token !== "string") {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }

    return body.token;
  }

  private async apiRequest(
    path: string,
    token: string,
    init: RequestInit = {},
    tracker: ProviderAttemptTracker = { count: 0 }
  ): Promise<Response> {
    for (
      let attempt = 1;
      attempt <= githubProviderRetryPolicy.maximumAttempts;
      attempt += 1
    ) {
      tracker.count += 1;
      let response: Response;
      try {
        response = await this.fetcher(`https://api.github.com${path}`, {
          ...init,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": apiVersion,
            ...init.headers,
          },
        });
      } catch {
        const error = new GitHubIntegrationError(
          "GITHUB_PROVIDER_UNAVAILABLE",
          true,
          tracker.count
        );
        await this.retryOrThrow(error, attempt);
        continue;
      }

      if (response.ok) {
        return response;
      }

      const error = this.providerError(response, this.clock(), tracker.count);
      await this.retryOrThrow(error, attempt);
    }

    throw new GitHubIntegrationError(
      "GITHUB_PROVIDER_UNAVAILABLE",
      true,
      tracker.count
    );
  }

  private async retryOrThrow(
    error: GitHubIntegrationError,
    attempt: number
  ): Promise<void> {
    if (!error.retryable) {
      this.logger?.warnEvent("sync_provider_failure", {
        attempt,
        failureCode: error.failureCode,
        finalStatus: "failed_terminal",
      });
      throw error;
    }

    const providerDelayMs = error.retryAfterAt
      ? Math.max(0, error.retryAfterAt.getTime() - this.clock().getTime())
      : null;
    if (
      error.failureCode === "GITHUB_RATE_LIMITED" &&
      error.retryAfterAt
    ) {
      this.logger?.warnEvent("sync_rate_limited", {
        attempt,
        failureCode: error.failureCode,
        retryAfterAt: error.retryAfterAt.toISOString(),
      });
    }

    if (
      providerDelayMs !== null &&
      providerDelayMs > githubProviderRetryPolicy.maximumInlineRetryDelayMs
    ) {
      this.logger?.warnEvent("sync_provider_failure", {
        attempt,
        failureCode: error.failureCode,
        finalStatus: "failed_retryable",
        retryAfterAt: error.retryAfterAt?.toISOString(),
      });
      throw error;
    }

    if (attempt >= githubProviderRetryPolicy.maximumAttempts) {
      this.logger?.warnEvent("sync_retry_exhausted", {
        attempt,
        failureCode: error.failureCode,
      });
      throw error;
    }

    const delayMs =
      providerDelayMs ??
      this.exponentialDelayMs(attempt);
    this.logger?.warnEvent("sync_provider_retry", {
      attempt,
      delayMs,
      failureCode: error.failureCode,
    });
    await this.delay(delayMs);
  }

  private exponentialDelayMs(attempt: number): number {
    const base = Math.min(
      githubProviderRetryPolicy.baseDelayMs * 2 ** (attempt - 1),
      githubProviderRetryPolicy.maximumBackoffMs
    );
    const random = Math.min(1, Math.max(0, this.random()));
    return Math.min(
      githubProviderRetryPolicy.maximumBackoffMs,
      Math.floor(base * (0.75 + random * 0.5))
    );
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
    installationToken: string,
    tracker: ProviderAttemptTracker
  ): Promise<AuthorizedGitHubRepository> {
    const response = await this.apiRequest(
      `/repositories/${repositoryId}`,
      installationToken,
      {},
      tracker
    );
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

  private async getPullRequestEvidence(
    repository: AuthorizedGitHubRepository,
    number: number,
    installationToken: string,
    tracker: ProviderAttemptTracker,
    window: GitHubCommitWindow
  ): Promise<GitHubPullRequestEvidence | null> {
    const basePath =
      `/repos/${encodeURIComponent(repository.owner)}/` +
      `${encodeURIComponent(repository.name)}/pulls/${number}`;
    const detailResponse = await this.apiRequest(
      basePath,
      installationToken,
      {},
      tracker
    );
    const detail = await this.readJson(detailResponse);
    if (!isRecord(detail)) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }
    if (detail.state !== "closed" || detail.merged_at === null) {
      return null;
    }

    const mergedAt = requiredDate(detail.merged_at);
    if (mergedAt < window.since || mergedAt > window.until) {
      return null;
    }

    const providerPullRequestId = positiveBigInt(detail.id);
    const providerNumber = positiveInteger(detail.number);
    const additions = nonnegativeInteger(detail.additions);
    const deletions = nonnegativeInteger(detail.deletions);
    const changedFiles = nonnegativeInteger(detail.changed_files);
    if (
      !providerPullRequestId ||
      providerNumber !== number ||
      typeof detail.title !== "string" ||
      detail.title.length === 0 ||
      detail.title.length > 1_024 ||
      !isRecord(detail.base) ||
      !isRecord(detail.head) ||
      additions === null ||
      deletions === null ||
      changedFiles === null
    ) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }

    const baseBranch = requiredBoundedText(detail.base.ref, 255);
    const headBranch = requiredBoundedText(detail.head.ref, 255);
    const providerCreatedAt = requiredDate(detail.created_at);
    const providerUpdatedAt = requiredDate(detail.updated_at);
    if (
      providerUpdatedAt < providerCreatedAt ||
      mergedAt < providerCreatedAt
    ) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }

    const files = await this.getPullRequestFiles(
      basePath,
      installationToken,
      tracker
    );
    if (files.length !== changedFiles) {
      throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
    }
    const commitShas = await this.getPullRequestCommitShas(
      basePath,
      installationToken,
      tracker
    );

    return {
      additions,
      authorLogin: isRecord(detail.user)
        ? optionalBoundedText(detail.user.login, 255)
        : null,
      baseBranch,
      bodySummary: limitedBodySummary(detail.body),
      changedFiles,
      commitShas,
      deletions,
      files,
      headBranch,
      mergeCommitSha:
        detail.merge_commit_sha === null
          ? null
          : requireSha(detail.merge_commit_sha),
      mergedAt,
      number,
      providerCreatedAt,
      providerPullRequestId,
      providerUpdatedAt,
      state: "closed",
      title: detail.title,
    };
  }

  private async getPullRequestFiles(
    basePath: string,
    installationToken: string,
    tracker: ProviderAttemptTracker
  ): Promise<GitHubPullRequestEvidence["files"]> {
    const files: GitHubPullRequestEvidence["files"][number][] = [];
    for (let page = 1; page <= maxFilePages; page += 1) {
      const query = new URLSearchParams({
        page: String(page),
        per_page: String(filePageSize),
      });
      const response = await this.apiRequest(
        `${basePath}/files?${query.toString()}`,
        installationToken,
        {},
        tracker
      );
      const body = await this.readJson(response);
      if (!Array.isArray(body) || body.length > filePageSize) {
        throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
      }
      const pageFiles = body.map((value) => this.parseCommitFile(value));
      if (files.length + pageFiles.length > maxFileItems) {
        throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
      }
      files.push(...pageFiles);
      if (pageFiles.length < filePageSize) {
        if (new Set(files.map((file) => file.path)).size !== files.length) {
          throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
        }
        return files;
      }
    }
    throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
  }

  private async getPullRequestCommitShas(
    basePath: string,
    installationToken: string,
    tracker: ProviderAttemptTracker
  ): Promise<readonly string[]> {
    const shas: string[] = [];
    for (let page = 1; page <= maxPullRequestCommitPages; page += 1) {
      const query = new URLSearchParams({
        page: String(page),
        per_page: String(commitPageSize),
      });
      const response = await this.apiRequest(
        `${basePath}/commits?${query.toString()}`,
        installationToken,
        {},
        tracker
      );
      const body = await this.readJson(response);
      if (!Array.isArray(body) || body.length > commitPageSize) {
        throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
      }
      const pageShas = body.map((value) => this.parseCommitSummary(value).sha);
      if (shas.length + pageShas.length > maxPullRequestCommitItems) {
        throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
      }
      shas.push(...pageShas);
      if (pageShas.length < commitPageSize) {
        if (new Set(shas).size !== shas.length) {
          throw new GitHubIntegrationError("GITHUB_RESPONSE_INVALID");
        }
        return shas;
      }
    }
    throw new GitHubIntegrationError("GITHUB_SAFETY_LIMIT_EXCEEDED");
  }

  private async getCommitDetail(
    repository: AuthorizedGitHubRepository,
    expectedSha: string,
    installationToken: string,
    tracker: ProviderAttemptTracker
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
        installationToken,
        {},
        tracker
      );
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

  private async withAttemptTracking<T>(
    operation: (tracker: ProviderAttemptTracker) => Promise<T>
  ): Promise<T> {
    const tracker: ProviderAttemptTracker = { count: 0 };
    try {
      return await operation(tracker);
    } catch (error) {
      if (error instanceof GitHubIntegrationError) {
        throw new GitHubIntegrationError(
          error.failureCode,
          error.retryable,
          Math.max(error.attemptCount, tracker.count),
          error.retryAfterAt
        );
      }
      throw new GitHubIntegrationError(
        "GITHUB_RESPONSE_INVALID",
        false,
        tracker.count
      );
    }
  }

  private providerError(
    response: Response,
    observedAt = this.clock(),
    attemptCount = 0
  ): GitHubIntegrationError {
    const retryAfterAt = this.retryAfterAt(response, observedAt);
    const hasRetryAfter = response.headers.has("retry-after");
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" ||
          hasRetryAfter))
    ) {
      return new GitHubIntegrationError(
        "GITHUB_RATE_LIMITED",
        true,
        attemptCount,
        retryAfterAt
      );
    }
    if (response.status >= 500) {
      return new GitHubIntegrationError(
        "GITHUB_PROVIDER_UNAVAILABLE",
        true,
        attemptCount,
        retryAfterAt
      );
    }
    return new GitHubIntegrationError(
      "GITHUB_AUTHORIZATION_FAILED",
      false,
      attemptCount
    );
  }

  private retryAfterAt(
    response: Response,
    observedAt: Date
  ): Date | null {
    const retryAfter = response.headers.get("retry-after");
    let candidateMs: number | null = null;

    if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
      const seconds = Number(retryAfter.trim());
      if (Number.isSafeInteger(seconds)) {
        candidateMs = observedAt.getTime() + seconds * 1_000;
      }
    } else if (retryAfter) {
      const parsed = Date.parse(retryAfter);
      if (Number.isFinite(parsed)) {
        candidateMs = parsed;
      }
    }

    if (candidateMs === null) {
      const reset = response.headers.get("x-ratelimit-reset");
      if (reset && /^\d+$/.test(reset.trim())) {
        const seconds = Number(reset.trim());
        if (Number.isSafeInteger(seconds)) {
          candidateMs = seconds * 1_000;
        }
      }
    }

    if (
      candidateMs === null ||
      !Number.isFinite(candidateMs) ||
      candidateMs < observedAt.getTime()
    ) {
      return null;
    }

    return new Date(
      Math.min(
        candidateMs,
        observedAt.getTime() +
          githubProviderRetryPolicy.maximumRetryAfterMs
      )
    );
  }
}
