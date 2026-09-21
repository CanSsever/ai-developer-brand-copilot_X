import { describe, expect, it, vi } from "vitest";

import type { StructuredLogger } from "../observability/structured-logger";
import { GitHubApiService } from "./github-api.service";
import type { GitHubAppAuthService } from "./github-app-auth.service";

const config = {
  callbackUrl: "http://localhost:3000/github/callback",
  clientId: "Iv1.synthetic-client",
  clientSecret: "synthetic-client-secret",
  privateKey: "not-used",
  slug: "synthetic-app",
};
const repository = {
  id: 99n,
  owner: "synthetic-owner",
  name: "synthetic-repository",
  defaultBranch: "main",
  isPrivate: true,
};
const window = {
  since: new Date("2026-08-21T12:00:00.000Z"),
  until: new Date("2026-09-20T12:00:00.000Z"),
};
const sha = (value: number) => value.toString(16).padStart(40, "0");

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  const init: ResponseInit = headers ? { status, headers } : { status };
  return new Response(JSON.stringify(body), init);
}

function detail(number: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 10_000 + number,
    number,
    title: `Synthetic merged PR ${number}`,
    body: "Synthetic summary",
    state: "closed",
    merged_at: "2026-09-19T10:00:00.000Z",
    created_at: "2026-09-18T08:00:00.000Z",
    updated_at: "2026-09-19T10:01:00.000Z",
    user: { login: "synthetic-author" },
    base: { ref: "main" },
    head: { ref: `synthetic-${number}` },
    merge_commit_sha: sha(number),
    additions: 8,
    deletions: 3,
    changed_files: 1,
    ...overrides,
  };
}

function harness(fetcher: ReturnType<typeof vi.fn>) {
  const delay = vi.fn(async () => undefined);
  const logger = {
    info: vi.fn(),
    warnEvent: vi.fn(),
    errorEvent: vi.fn(),
  };
  const service = new GitHubApiService(
    config,
    fetcher as unknown as typeof fetch,
    { createAppJwt: vi.fn(() => "synthetic-app-jwt") } as unknown as GitHubAppAuthService,
    () => new Date("2026-09-20T12:00:00.000Z"),
    delay,
    () => 0.5,
    logger as unknown as StructuredLogger
  );
  return { delay, logger, service };
}

describe("GitHubApiService merged pull requests", () => {
  it("normalizes merged PR, bounded body, files, statistics, and linked commits", async () => {
    const token = "ephemeral-installation-value";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token }))
      .mockResolvedValueOnce(
        response({ total_count: 1, items: [{ number: 7, pull_request: {} }] })
      )
      .mockResolvedValueOnce(
        response(detail(7, { body: "b".repeat(2_100) }))
      )
      .mockResolvedValueOnce(
        response([
          {
            filename: "src/synthetic.ts",
            previous_filename: "src/previous.ts",
            status: "renamed",
            additions: 8,
            deletions: 3,
            changes: 11,
            patch: "discarded synthetic patch",
          },
        ])
      )
      .mockResolvedValueOnce(response([{ sha: sha(70) }, { sha: sha(71) }]));
    const { logger, service } = harness(fetcher);

    const result = await service.listMergedPullRequests(42n, repository, window);

    expect(result.attemptCount).toBe(5);
    expect(result.pullRequests).toEqual([
      expect.objectContaining({
        providerPullRequestId: 10_007n,
        number: 7,
        state: "closed",
        additions: 8,
        deletions: 3,
        changedFiles: 1,
        commitShas: [sha(70), sha(71)],
        files: [
          {
            path: "src/synthetic.ts",
            previousPath: "src/previous.ts",
            status: "renamed",
            additions: 8,
            deletions: 3,
            changes: 11,
          },
        ],
      }),
    ]);
    expect(result.pullRequests[0]?.bodySummary).toHaveLength(2_000);
    const serialized = JSON.stringify(result, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    );
    const logs = JSON.stringify([
      logger.info.mock.calls,
      logger.warnEvent.mock.calls,
      logger.errorEvent.mock.calls,
    ]);
    expect(serialized).not.toContain("patch");
    expect(serialized).not.toContain(token);
    expect(logs).not.toContain("Synthetic merged PR");
    expect(logs).not.toContain("src/synthetic.ts");
    expect(logs).not.toContain(token);
  });

  it("accepts an omitted optional merge commit SHA", async () => {
    const detailWithoutMergeSha = detail(12, {
      merge_commit_sha: undefined,
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: "ephemeral-value" }))
      .mockResolvedValueOnce(
        response({
          total_count: 1,
          items: [{ number: 12, pull_request: {} }],
        })
      )
      .mockResolvedValueOnce(response(detailWithoutMergeSha))
      .mockResolvedValueOnce(
        response([
          {
            filename: "src/synthetic.ts",
            status: "modified",
            additions: 8,
            deletions: 3,
            changes: 11,
          },
        ])
      )
      .mockResolvedValueOnce(response([{ sha: sha(120) }]));
    const { service } = harness(fetcher);

    await expect(
      service.listMergedPullRequests(42n, repository, window)
    ).resolves.toMatchObject({
      pullRequests: [
        expect.objectContaining({
          mergeCommitSha: null,
          commitShas: [sha(120)],
        }),
      ],
    });
  });

  it("does not accept open or closed-unmerged candidates as merged evidence", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: "ephemeral-value" }))
      .mockResolvedValueOnce(
        response({
          total_count: 2,
          items: [
            { number: 8, pull_request: {} },
            { number: 9, pull_request: {} },
          ],
        })
      )
      .mockResolvedValueOnce(response(detail(8, { state: "open" })))
      .mockResolvedValueOnce(response(detail(9, { merged_at: null })));
    const { service } = harness(fetcher);

    const result = await service.listMergedPullRequests(42n, repository, window);

    expect(result.pullRequests).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("uses the fixed mergedAt window in the provider search", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: "ephemeral-value" }))
      .mockResolvedValueOnce(response({ total_count: 0, items: [] }));
    const { service } = harness(fetcher);

    await service.listMergedPullRequests(42n, repository, window);

    const searchUrl = new URL(fetcher.mock.calls[1]?.[0] as string);
    expect(searchUrl.pathname).toBe("/search/issues");
    expect(searchUrl.searchParams.get("q")).toContain("is:merged");
    expect(searchUrl.searchParams.get("q")).toContain(
      `merged:${window.since.toISOString()}..${window.until.toISOString()}`
    );
  });
});

describe("GitHubApiService merged pull request limits and retry", () => {
  it("paginates every supported merged PR search page", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      number: index + 1,
      pull_request: {},
    }));
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/access_tokens")) {
        return response({ token: "ephemeral-value" });
      }
      if (url.includes("/search/issues")) {
        const page = new URL(url).searchParams.get("page");
        return page === "1"
          ? response({ total_count: 101, items: firstPage })
          : response({
              total_count: 101,
              items: [{ number: 101, pull_request: {} }],
            });
      }
      return response(detail(Number(url.split("/").at(-1)), { state: "open" }));
    });
    const { service } = harness(fetcher);

    const result = await service.listMergedPullRequests(42n, repository, window);

    expect(result.pullRequests).toEqual([]);
    const searchCalls = fetcher.mock.calls.filter(([url]) =>
      String(url).includes("/search/issues")
    );
    expect(searchCalls).toHaveLength(2);
  });

  it("fails closed before detail retrieval when the PR safety limit is exceeded", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: "ephemeral-value" }))
      .mockResolvedValueOnce(response({ total_count: 501, items: [] }));
    const { service } = harness(fetcher);

    await expect(
      service.listMergedPullRequests(42n, repository, window)
    ).rejects.toMatchObject({
      failureCode: "GITHUB_SAFETY_LIMIT_EXCEEDED",
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries a transient PR search failure with the shared provider policy", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: "ephemeral-value" }))
      .mockResolvedValueOnce(response({ message: "synthetic outage" }, 503))
      .mockResolvedValueOnce(response({ total_count: 0, items: [] }));
    const { delay, service } = harness(fetcher);

    await expect(
      service.listMergedPullRequests(42n, repository, window)
    ).resolves.toMatchObject({ attemptCount: 3, pullRequests: [] });
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("does not retry a terminal PR authorization failure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: "ephemeral-value" }))
      .mockResolvedValueOnce(response({ message: "synthetic denied" }, 401));
    const { delay, service } = harness(fetcher);

    await expect(
      service.listMergedPullRequests(42n, repository, window)
    ).rejects.toMatchObject({
      failureCode: "GITHUB_AUTHORIZATION_FAILED",
      retryable: false,
    });
    expect(delay).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("defers a long PR rate limit using normalized safe timing", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: "ephemeral-value" }))
      .mockResolvedValueOnce(
        response({ message: "synthetic limit" }, 429, {
          "retry-after": "60",
        })
      );
    const { delay, service } = harness(fetcher);

    await expect(
      service.listMergedPullRequests(42n, repository, window)
    ).rejects.toMatchObject({
      attemptCount: 2,
      failureCode: "GITHUB_RATE_LIMITED",
      retryable: true,
      retryAfterAt: new Date("2026-09-20T12:01:00.000Z"),
    });
    expect(delay).not.toHaveBeenCalled();
  });
});
