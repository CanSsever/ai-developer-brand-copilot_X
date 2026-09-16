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
});
