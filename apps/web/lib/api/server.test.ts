import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("../supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("../public-config", () => ({
  getPublicWebConfig: () => ({
    NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:4101",
  }),
}));

import { createAuthenticatedApiRequester } from "./server";

describe("createAuthenticatedApiRequester", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "synthetic-access-token" } },
      error: null,
    });
    mocks.createClient.mockResolvedValue({
      auth: { getSession: mocks.getSession },
    });
  });

  it("resolves one server session for multiple API requests", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "project" }])))
      .mockResolvedValueOnce(new Response(JSON.stringify([])));

    const request = await createAuthenticatedApiRequester();
    await Promise.all([
      request<unknown>("/projects"),
      request<unknown>("/github/connections"),
    ]);

    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
