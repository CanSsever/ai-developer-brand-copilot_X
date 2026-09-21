import { describe, expect, it, vi } from "vitest";

import type { StructuredLogger } from "../observability/structured-logger";
import { GitHubApiService, GitHubIntegrationError } from "./github-api.service";
import type { GitHubAppAuthService } from "./github-app-auth.service";

const config = {
  callbackUrl: "http://localhost:3000/github/callback",
  clientId: "Iv1.safe-test-client",
  clientSecret: "safe-test-client-secret-value",
  privateKey: "not-used-by-mocked-auth",
  slug: "safe-test-app",
};

function response(
  body: unknown,
  status = 200,
  headers?: HeadersInit
): Response {
  const init: ResponseInit = headers ? { headers, status } : { status };
  return new Response(JSON.stringify(body), init);
}

const sha = (value: number): string => value.toString(16).padStart(40, "0");

function repositoryBody() {
  return {
    id: 99,
    name: "renamed-repository",
    private: true,
    default_branch: "main",
    owner: { login: "safe-owner" },
  };
}

function commitDetail(commitSha: string, files: readonly unknown[]) {
  return {
    sha: commitSha,
    commit: {
      message: "synthetic commit message",
      author: {
        name: "Synthetic Author",
        date: "2026-09-18T10:00:00.000Z",
      },
      committer: { date: "2026-09-18T10:01:00.000Z" },
    },
    author: { login: "synthetic-author" },
    parents: [{ sha: sha(999) }],
    stats: { additions: 5, deletions: 2, total: 7 },
    files,
  };
}

function retryHarness(
  fetcher: ReturnType<typeof vi.fn>,
  now = new Date("2026-09-18T12:00:00.000Z")
) {
  const delay = vi.fn(async (_milliseconds: number) => undefined);
  const random = vi.fn(() => 0.5);
  const logger = {
    info: vi.fn(),
    warnEvent: vi.fn(),
    errorEvent: vi.fn(),
  };
  const service = new GitHubApiService(
    config,
    fetcher as unknown as typeof fetch,
    {
      createAppJwt: vi.fn(() => "signed-app-jwt"),
    } as unknown as GitHubAppAuthService,
    () => new Date(now),
    delay,
    random,
    logger as unknown as StructuredLogger
  );

  return { delay, logger, random, service };
}

describe("GitHubApiService", () => {
  const appAuth = {
    createAppJwt: vi.fn(() => "signed-app-jwt"),
  } as unknown as GitHubAppAuthService;

  it("exchanges a code server-side without placing the client secret in the URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ access_token: "ephemeral-user-token" }));
    const service = new GitHubApiService(config, fetcher, appAuth);

    await expect(service.exchangeUserCode("one-time-code")).resolves.toBe(
      "ephemeral-user-token"
    );
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(url).not.toContain(config.clientSecret);
    expect(String(init.body)).toContain("client_secret=");
  });

  it("rejects a spoofed installation ID unless the user token can access it", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          id: 42,
          account: { id: 7, login: "safe-account", type: "User" },
        })
      )
      .mockResolvedValueOnce(response({ message: "not found" }, 404));
    const service = new GitHubApiService(config, fetcher, appAuth);

    await expect(
      service.verifyInstallationForUser(42n, "ephemeral-user-token")
    ).rejects.toBeInstanceOf(GitHubIntegrationError);
  });

  it("rejects an installation that does not belong to this GitHub App", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ message: "not found" }, 404));
    const service = new GitHubApiService(config, fetcher, appAuth);

    await expect(
      service.verifyInstallationForUser(42n, "ephemeral-user-token")
    ).rejects.toMatchObject({ failureCode: "GITHUB_AUTHORIZATION_FAILED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("verifies both the app installation and user association", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          id: 42,
          account: { id: 7, login: "safe-account", type: "Organization" },
        })
      )
      .mockResolvedValueOnce(response({ total_count: 1, repositories: [] }));
    const service = new GitHubApiService(config, fetcher, appAuth);

    await expect(
      service.verifyInstallationForUser(42n, "ephemeral-user-token")
    ).resolves.toEqual({
      installationId: 42n,
      accountId: 7n,
      accountLogin: "safe-account",
      accountType: "Organization",
    });
    expect(fetcher.mock.calls[0]?.[0]).toContain("/app/installations/42");
    expect(fetcher.mock.calls[1]?.[0]).toContain(
      "/user/installations/42/repositories"
    );
  });

  it("finds and re-verifies one existing installation accessible to the user", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          total_count: 1,
          installations: [{ id: 42, app_slug: config.slug }],
        })
      )
      .mockResolvedValueOnce(
        response({
          id: 42,
          account: { id: 7, login: "safe-account", type: "User" },
        })
      )
      .mockResolvedValueOnce(response({ total_count: 1, repositories: [] }));
    const service = new GitHubApiService(config, fetcher, appAuth);

    await expect(
      service.findReusableInstallationForUser("ephemeral-user-token")
    ).resolves.toEqual({
      installationId: 42n,
      accountId: 7n,
      accountLogin: "safe-account",
      accountType: "User",
    });
    expect(fetcher.mock.calls[0]?.[0]).toContain(
      "/user/installations?per_page=100&page=1"
    );
    expect(fetcher.mock.calls[1]?.[0]).toContain("/app/installations/42");
    expect(fetcher.mock.calls[2]?.[0]).toContain(
      "/user/installations/42/repositories"
    );
  });

  it("rejects reconnect when the user has no existing installation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ total_count: 0, installations: [] }));
    const service = new GitHubApiService(config, fetcher, appAuth);

    await expect(
      service.findReusableInstallationForUser("ephemeral-user-token")
    ).rejects.toMatchObject({ failureCode: "GITHUB_AUTHORIZATION_FAILED" });
  });

  it("rejects a reconnect discovery response for another GitHub App", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        total_count: 1,
        installations: [{ id: 42, app_slug: "another-app" }],
      })
    );
    const service = new GitHubApiService(config, fetcher, appAuth);

    await expect(
      service.findReusableInstallationForUser("ephemeral-user-token")
    ).rejects.toMatchObject({ failureCode: "GITHUB_AUTHORIZATION_FAILED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("lists only installation-authorized repositories without returning the token", async () => {
    const installationToken = "ephemeral-installation-token";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: installationToken }))
      .mockResolvedValueOnce(
        response({
          total_count: 1,
          repositories: [
            {
              id: 99,
              name: "repo",
              private: true,
              default_branch: "main",
              owner: { login: "safe-owner" },
            },
          ],
        })
      );
    const service = new GitHubApiService(config, fetcher, appAuth);
    const result = await service.listInstallationRepositories(42n);

    expect(result).toEqual([
      {
        id: 99n,
        name: "repo",
        owner: "safe-owner",
        defaultBranch: "main",
        isPrivate: true,
      },
    ]);
    expect(result.every((repository) => !("token" in repository))).toBe(true);
    expect(fetcher.mock.calls[1]?.[0]).toContain("/installation/repositories");
  });

  it("lists every supported commit page inside one fixed provider window", async () => {
    const installationToken = "ephemeral-installation-token";
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      sha: sha(index + 1),
    }));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: installationToken }))
      .mockResolvedValueOnce(response(repositoryBody()))
      .mockResolvedValueOnce(response(firstPage))
      .mockResolvedValueOnce(response([{ sha: sha(101) }]));
    const service = new GitHubApiService(config, fetcher, appAuth);
    const since = new Date("2026-08-19T12:00:00.000Z");
    const until = new Date("2026-09-18T12:00:00.000Z");

    const result = await service.listRepositoryCommitSummaries(42n, 99n, {
      since,
      until,
    });

    expect(result.commits).toHaveLength(101);
    expect(result.attemptCount).toBe(4);
    expect(result.repository.id).toBe(99n);
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://api.github.com/repositories/99"
    );
    const firstListUrl = new URL(fetcher.mock.calls[2]?.[0] as string);
    expect(firstListUrl.pathname).toBe(
      "/repos/safe-owner/renamed-repository/commits"
    );
    expect(firstListUrl.searchParams.get("sha")).toBe("main");
    expect(firstListUrl.searchParams.get("since")).toBe(since.toISOString());
    expect(firstListUrl.searchParams.get("until")).toBe(until.toISOString());
    expect(firstListUrl.searchParams.get("page")).toBe("1");
    expect(
      (fetcher.mock.calls[2]?.[1] as RequestInit).headers
    ).toMatchObject({ Authorization: `Bearer ${installationToken}` });
    expect(result).not.toHaveProperty("token");
    expect(result.repository).not.toHaveProperty("token");
    expect(
      result.commits.every((commit) => !("token" in commit))
    ).toBe(true);
  });

  it("treats GitHub's explicit empty-repository response as an empty commit list", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: "ephemeral-token" }))
      .mockResolvedValueOnce(response(repositoryBody()))
      .mockResolvedValueOnce(
        response({ message: "Git Repository is empty." }, 409)
      );
    const service = new GitHubApiService(config, fetcher, appAuth);

    await expect(
      service.listRepositoryCommitSummaries(42n, 99n, {
        since: new Date("2026-08-19T12:00:00.000Z"),
        until: new Date("2026-09-18T12:00:00.000Z"),
      })
    ).resolves.toMatchObject({ attemptCount: 3, commits: [] });
  });

  it("keeps unrelated commit-list conflicts terminal", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: "ephemeral-token" }))
      .mockResolvedValueOnce(response(repositoryBody()))
      .mockResolvedValueOnce(response({ message: "synthetic conflict" }, 409));
    const service = new GitHubApiService(config, fetcher, appAuth);

    await expect(
      service.listRepositoryCommitSummaries(42n, 99n, {
        since: new Date("2026-08-19T12:00:00.000Z"),
        until: new Date("2026-09-18T12:00:00.000Z"),
      })
    ).rejects.toMatchObject({
      attemptCount: 3,
      failureCode: "GITHUB_AUTHORIZATION_FAILED",
      retryable: false,
    });
  });

  it("fails closed when commit pagination exceeds the 500-item boundary", async () => {
    const pages = Array.from({ length: 5 }, (_, page) =>
      Array.from({ length: 100 }, (_, index) => ({
        sha: sha(page * 100 + index + 1),
      }))
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: "ephemeral-token" }))
      .mockResolvedValueOnce(response(repositoryBody()));
    for (const page of pages) {
      fetcher.mockResolvedValueOnce(response(page));
    }
    fetcher.mockResolvedValueOnce(response([{ sha: sha(501) }]));
    const service = new GitHubApiService(config, fetcher, appAuth);

    await expect(
      service.listRepositoryCommitSummaries(42n, 99n, {
        since: new Date("2026-08-19T12:00:00.000Z"),
        until: new Date("2026-09-18T12:00:00.000Z"),
      })
    ).rejects.toMatchObject({
      failureCode: "GITHUB_SAFETY_LIMIT_EXCEEDED",
      retryable: false,
    });
  });

  it("fetches normalized commit detail and omits patches and tokens", async () => {
    const commitSha = sha(1);
    const installationToken = "ephemeral-installation-token";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: installationToken }))
      .mockResolvedValueOnce(
        response(
          commitDetail(commitSha, [
            {
              filename: "src/synthetic.ts",
              previous_filename: "src/old-synthetic.ts",
              status: "renamed",
              additions: 5,
              deletions: 2,
              changes: 7,
              patch: "private patch that must be discarded",
            },
          ])
        )
      );
    const service = new GitHubApiService(config, fetcher, appAuth);

    const result = await service.getRepositoryCommitDetails(
      42n,
      {
        id: 99n,
        owner: "safe-owner",
        name: "renamed-repository",
        defaultBranch: "main",
        isPrivate: true,
      },
      [commitSha]
    );

    expect(result).toEqual({
      attemptCount: 2,
      commits: [
        {
        sha: commitSha,
        message: "synthetic commit message",
        authorName: "Synthetic Author",
        authorLogin: "synthetic-author",
        authoredAt: new Date("2026-09-18T10:00:00.000Z"),
        committedAt: new Date("2026-09-18T10:01:00.000Z"),
        parentShas: [sha(999)],
        additions: 5,
        deletions: 2,
        changedFiles: 1,
        files: [
          {
            path: "src/synthetic.ts",
            previousPath: "src/old-synthetic.ts",
            status: "renamed",
            additions: 5,
            deletions: 2,
            changes: 7,
          },
        ],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("patch");
    expect(JSON.stringify(result)).not.toContain(installationToken);
  });

  it("paginates commit files and rejects duplicate file paths", async () => {
    const commitSha = sha(2);
    const firstFiles = Array.from({ length: 100 }, (_, index) => ({
      filename: `src/file-${index}.ts`,
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
    }));
    const duplicate = {
      filename: "src/file-0.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: "ephemeral-token" }))
      .mockResolvedValueOnce(response(commitDetail(commitSha, firstFiles)))
      .mockResolvedValueOnce(response(commitDetail(commitSha, [duplicate])));
    const service = new GitHubApiService(config, fetcher, appAuth);

    await expect(
      service.getRepositoryCommitDetails(
        42n,
        {
          id: 99n,
          owner: "safe-owner",
          name: "renamed-repository",
          defaultBranch: "main",
          isPrivate: true,
        },
        [commitSha]
      )
    ).rejects.toMatchObject({ failureCode: "GITHUB_RESPONSE_INVALID" });
    expect(new URL(fetcher.mock.calls[2]?.[0] as string).searchParams.get("page")).toBe(
      "2"
    );
  });

  it("classifies rate limits without exposing provider response bodies", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: "ephemeral-token" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ secret_provider_detail: "not exposed" }), {
          status: 403,
          headers: {
            "retry-after": "60",
            "x-ratelimit-remaining": "0",
          },
        })
      );
    const { service } = retryHarness(fetcher);

    await expect(
      service.listRepositoryCommitSummaries(42n, 99n, {
        since: new Date("2026-08-19T12:00:00.000Z"),
        until: new Date("2026-09-18T12:00:00.000Z"),
      })
    ).rejects.toMatchObject({
      message: "GitHub authorization could not be verified",
      failureCode: "GITHUB_RATE_LIMITED",
      retryable: true,
    });
  });

  it("classifies network failures with a safe retryable error", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error("socket included secrets"));
    const { service } = retryHarness(fetcher);

    await expect(
      service.listRepositoryCommitSummaries(42n, 99n, {
        since: new Date("2026-08-19T12:00:00.000Z"),
        until: new Date("2026-09-18T12:00:00.000Z"),
      })
    ).rejects.toMatchObject({
      message: "GitHub authorization could not be verified",
      failureCode: "GITHUB_PROVIDER_UNAVAILABLE",
      retryable: true,
    });
  });

  it("retries a transient network failure and then succeeds", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic socket failure"))
      .mockResolvedValueOnce(response({ token: "ephemeral-token" }))
      .mockResolvedValueOnce(response(repositoryBody()))
      .mockResolvedValueOnce(response([]));
    const { delay, logger, service } = retryHarness(fetcher);

    const result = await service.listRepositoryCommitSummaries(42n, 99n, {
      since: new Date("2026-08-19T12:00:00.000Z"),
      until: new Date("2026-09-18T12:00:00.000Z"),
    });

    expect(result.attemptCount).toBe(4);
    expect(delay).toHaveBeenCalledWith(250);
    expect(logger.warnEvent).toHaveBeenCalledWith("sync_provider_retry", {
      attempt: 1,
      delayMs: 250,
      failureCode: "GITHUB_PROVIDER_UNAVAILABLE",
    });
  });

  it("classifies a provider timeout as retryable and succeeds on retry", async () => {
    const timeout = new Error("synthetic timeout");
    timeout.name = "AbortError";
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(response({ token: "ephemeral-token" }))
      .mockResolvedValueOnce(response(repositoryBody()))
      .mockResolvedValueOnce(response([]));
    const { delay, service } = retryHarness(fetcher);

    await expect(
      service.listRepositoryCommitSummaries(42n, 99n, {
        since: new Date("2026-08-19T12:00:00.000Z"),
        until: new Date("2026-09-18T12:00:00.000Z"),
      })
    ).resolves.toMatchObject({ attemptCount: 4, commits: [] });
    expect(delay).toHaveBeenCalledWith(250);
  });

  it("retries GitHub 5xx and preserves one successful provider operation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ safe: "temporary" }, 503))
      .mockResolvedValueOnce(response({ token: "ephemeral-token" }))
      .mockResolvedValueOnce(response(repositoryBody()))
      .mockResolvedValueOnce(response([]));
    const { delay, service } = retryHarness(fetcher);

    await expect(
      service.listRepositoryCommitSummaries(42n, 99n, {
        since: new Date("2026-08-19T12:00:00.000Z"),
        until: new Date("2026-09-18T12:00:00.000Z"),
      })
    ).resolves.toMatchObject({ attemptCount: 4, commits: [] });
    expect(delay).toHaveBeenCalledExactlyOnceWith(250);
  });

  it("stops after the finite retry limit and returns safe attempt metadata", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error("synthetic network failure"));
    const { delay, logger, service } = retryHarness(fetcher);

    await expect(
      service.listRepositoryCommitSummaries(42n, 99n, {
        since: new Date("2026-08-19T12:00:00.000Z"),
        until: new Date("2026-09-18T12:00:00.000Z"),
      })
    ).rejects.toMatchObject({
      failureCode: "GITHUB_PROVIDER_UNAVAILABLE",
      retryable: true,
      attemptCount: 3,
      retryAfterAt: null,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      250,
      500,
    ]);
    expect(logger.warnEvent).toHaveBeenCalledWith("sync_retry_exhausted", {
      attempt: 3,
      failureCode: "GITHUB_PROVIDER_UNAVAILABLE",
    });
  });

  it("does not retry terminal authorization or repository-access failures", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ safe: "not authorized" }, 404));
    const { delay, service } = retryHarness(fetcher);

    await expect(
      service.listRepositoryCommitSummaries(42n, 99n, {
        since: new Date("2026-08-19T12:00:00.000Z"),
        until: new Date("2026-09-18T12:00:00.000Z"),
      })
    ).rejects.toMatchObject({
      failureCode: "GITHUB_AUTHORIZATION_FAILED",
      retryable: false,
      attemptCount: 1,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(delay).not.toHaveBeenCalled();
  });

  it("does not retry malformed successful provider responses", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ missing_token: "synthetic" }));
    const { delay, service } = retryHarness(fetcher);

    await expect(
      service.listRepositoryCommitSummaries(42n, 99n, {
        since: new Date("2026-08-19T12:00:00.000Z"),
        until: new Date("2026-09-18T12:00:00.000Z"),
      })
    ).rejects.toMatchObject({
      failureCode: "GITHUB_RESPONSE_INVALID",
      retryable: false,
      attemptCount: 1,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(delay).not.toHaveBeenCalled();
  });

  it("honors a short Retry-After duration without real sleeping", async () => {
    const providerToken = "ephemeral-provider-token";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          { synthetic: "rate limited" },
          429,
          { "retry-after": "1" }
        )
      )
      .mockResolvedValueOnce(response({ token: providerToken }))
      .mockResolvedValueOnce(response(repositoryBody()))
      .mockResolvedValueOnce(response([]));
    const { delay, logger, service } = retryHarness(fetcher);

    const result = await service.listRepositoryCommitSummaries(42n, 99n, {
      since: new Date("2026-08-19T12:00:00.000Z"),
      until: new Date("2026-09-18T12:00:00.000Z"),
    });

    expect(result.attemptCount).toBe(4);
    expect(delay).toHaveBeenCalledWith(1_000);
    expect(JSON.stringify(logger.warnEvent.mock.calls)).not.toContain(
      providerToken
    );
  });

  it("normalizes X-RateLimit-Reset and uses it for a bounded retry", async () => {
    const now = new Date("2026-09-18T12:00:00.000Z");
    const resetSeconds = Math.floor(now.getTime() / 1_000) + 2;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          { synthetic: "primary rate limit" },
          403,
          {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(resetSeconds),
          }
        )
      )
      .mockResolvedValueOnce(response({ token: "ephemeral-token" }))
      .mockResolvedValueOnce(response(repositoryBody()))
      .mockResolvedValueOnce(response([]));
    const { delay, service } = retryHarness(fetcher, now);

    await service.listRepositoryCommitSummaries(42n, 99n, {
      since: new Date("2026-08-19T12:00:00.000Z"),
      until: now,
    });
    expect(delay).toHaveBeenCalledWith(2_000);
  });

  it("caps and defers an unreasonable provider retry window", async () => {
    const now = new Date("2026-09-18T12:00:00.000Z");
    const fetcher = vi.fn().mockResolvedValue(
      response(
        { synthetic: "long rate limit" },
        429,
        { "retry-after": "999999" }
      )
    );
    const { delay, logger, service } = retryHarness(fetcher, now);

    await expect(
      service.listRepositoryCommitSummaries(42n, 99n, {
        since: new Date("2026-08-19T12:00:00.000Z"),
        until: now,
      })
    ).rejects.toMatchObject({
      failureCode: "GITHUB_RATE_LIMITED",
      retryable: true,
      attemptCount: 1,
      retryAfterAt: new Date("2026-09-19T12:00:00.000Z"),
    });
    expect(delay).not.toHaveBeenCalled();
    expect(logger.warnEvent).toHaveBeenCalledWith(
      "sync_provider_failure",
      expect.objectContaining({
        finalStatus: "failed_retryable",
        retryAfterAt: "2026-09-19T12:00:00.000Z",
      })
    );
  });

  it("falls back to bounded exponential delay for invalid retry timing", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          { synthetic: "invalid retry timing" },
          429,
          { "retry-after": "not-a-duration" }
        )
      )
      .mockResolvedValueOnce(response({ token: "ephemeral-token" }))
      .mockResolvedValueOnce(response(repositoryBody()))
      .mockResolvedValueOnce(response([]));
    const { delay, service } = retryHarness(fetcher);

    await service.listRepositoryCommitSummaries(42n, 99n, {
      since: new Date("2026-08-19T12:00:00.000Z"),
      until: new Date("2026-09-18T12:00:00.000Z"),
    });
    expect(delay).toHaveBeenCalledWith(250);
  });
});
