import { Inject, Injectable } from "@nestjs/common";

import { GitHubAppAuthService } from "./github-app-auth.service";
import { GITHUB_APP_CONFIG, GITHUB_FETCH } from "./github.tokens";
import type {
  AuthorizedGitHubRepository,
  GitHubAppConfig,
  VerifiedGitHubInstallation,
} from "./github.types";

const apiVersion = "2026-03-10";
const maxRepositoryPages = 100;

export class GitHubIntegrationError extends Error {
  constructor() {
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
    const body = await this.readJson(response);

    if (!response.ok || !isRecord(body) || typeof body.access_token !== "string") {
      throw new GitHubIntegrationError();
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
    const appBody = await this.readJson(appResponse);

    if (!appResponse.ok || !isRecord(appBody)) {
      throw new GitHubIntegrationError();
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
      const body = await this.readJson(response);

      if (!response.ok || !isRecord(body) || !Array.isArray(body.repositories)) {
        throw new GitHubIntegrationError();
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

  private async createInstallationToken(installationId: bigint): Promise<string> {
    const response = await this.apiRequest(
      `/app/installations/${installationId}/access_tokens`,
      this.appAuth.createAppJwt(),
      { method: "POST" }
    );
    const body = await this.readJson(response);

    if (!response.ok || !isRecord(body) || typeof body.token !== "string") {
      throw new GitHubIntegrationError();
    }

    return body.token;
  }

  private apiRequest(
    path: string,
    token: string,
    init: RequestInit = {}
  ): Promise<Response> {
    return this.fetcher(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": apiVersion,
        ...init.headers,
      },
    });
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new GitHubIntegrationError();
    }
  }

  private parseRepository(value: unknown): AuthorizedGitHubRepository {
    if (!isRecord(value) || !isRecord(value.owner)) {
      throw new GitHubIntegrationError();
    }

    const id = positiveBigInt(value.id);
    if (
      !id ||
      typeof value.name !== "string" ||
      typeof value.default_branch !== "string" ||
      typeof value.private !== "boolean" ||
      typeof value.owner.login !== "string"
    ) {
      throw new GitHubIntegrationError();
    }

    return {
      id,
      name: value.name,
      owner: value.owner.login,
      defaultBranch: value.default_branch,
      isPrivate: value.private,
    };
  }
}
