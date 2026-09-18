import { describe, expect, it, vi } from "vitest";

import { GitHubApiService, GitHubIntegrationError } from "./github-api.service";
import type { GitHubAppAuthService } from "./github-app-auth.service";

const config = {
  callbackUrl: "http://localhost:3000/github/callback",
  clientId: "Iv1.safe-test-client",
  clientSecret: "safe-test-client-secret-value",
  privateKey: "not-used-by-mocked-auth",
  slug: "safe-test-app",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
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

    expect(result).toEqual([
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
    ]);
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
          headers: { "x-ratelimit-remaining": "0" },
        })
      );
    const service = new GitHubApiService(config, fetcher, appAuth);

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
    const fetcher = vi.fn().mockRejectedValue(new Error("socket included secrets"));
    const service = new GitHubApiService(config, fetcher, appAuth);

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
});
