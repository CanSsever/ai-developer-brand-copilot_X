import { describe, expect, it } from "vitest";

import {
  parseAuthorizedRepositories,
  parseConnectionProjects,
  parseGitHubConnections,
  ResponseValidationError,
} from "./response-parsers";

describe("GitHub connection response parsers", () => {
  it("accepts the safe disconnected-local state", () => {
    expect(
      parseConnectionProjects([
        {
          id: "323e4567-e89b-42d3-a456-426614174000",
          timezone: "Europe/Berlin",
          connectedRepository: null,
        },
      ])
    ).toEqual([
      {
        id: "323e4567-e89b-42d3-a456-426614174000",
        timezone: "Europe/Berlin",
      },
    ]);
    expect(parseGitHubConnections([])).toEqual([]);
  });

  it("accepts safe connected-installation and repository summaries", () => {
    expect(
      parseGitHubConnections([
        {
          id: "423e4567-e89b-42d3-a456-426614174000",
          accountLogin: "safe-account",
          accountType: "User",
          status: "active",
        },
      ])
    ).toHaveLength(1);
    expect(
      parseAuthorizedRepositories([
        {
          id: "99",
          owner: "safe-owner",
          name: "safe-repository",
          fullName: "safe-owner/safe-repository",
          defaultBranch: "main",
          isPrivate: true,
        },
      ])
    ).toHaveLength(1);
  });

  it("rejects malformed payloads instead of trusting TypeScript casts", () => {
    expect(() => parseConnectionProjects({ projects: [] })).toThrow();
    expect(() =>
      parseGitHubConnections([{ id: "id", status: "unexpected" }])
    ).toThrow();
    expect(() =>
      parseAuthorizedRepositories([{ id: "99", isPrivate: "yes" }])
    ).toThrow();
  });

  it("classifies validation failures without including rejected values", () => {
    let failure: unknown;
    try {
      parseConnectionProjects([{ id: "safe-id", timezone: null }]);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ResponseValidationError);
    expect(failure).toMatchObject({
      actual: "null",
      expected: "non-empty string",
      parser: "projects",
      path: "$[0].timezone",
    });
    expect(JSON.stringify(failure)).not.toContain("safe-id");
  });
});
