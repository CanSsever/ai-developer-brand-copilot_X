import { describe, expect, it, vi } from "vitest";

import {
  ApplicationUserSyncError,
  resolveLocalApiBaseUrl,
  synchronizeApplicationUser,
} from "./application-user-sync";

const expectedSubject = "123e4567-e89b-42d3-a456-426614174000";
const otherSubject = "223e4567-e89b-42d3-a456-426614174000";
const realFormatToken = "eyJhbGciOiJIUzI1NiJ9.session-segment.signature";

function options(
  fetcher: typeof fetch,
  report = vi.fn()
): Parameters<typeof synchronizeApplicationUser>[0] {
  return {
    apiBaseUrl: "http://127.0.0.1:3001",
    expectedSubject,
    fetcher,
    report,
    stage: "RLS_SYNC_USER_A",
    token: realFormatToken,
  };
}

describe("application User synchronization request", () => {
  it("derives the loopback API URL from the configured API port", () => {
    expect(resolveLocalApiBaseUrl(4310)).toBe(
      "http://127.0.0.1:4310"
    );
  });

  it("uses the local auth URL and a real-format bearer token", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: expectedSubject }), { status: 200 })
    );
    const report = vi.fn();

    await synchronizeApplicationUser(options(fetcher, report));

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3001/auth/me");
    expect(request.headers).toEqual({
      Authorization: "Bearer " + realFormatToken,
    });
    expect(request.body).toBeUndefined();
    expect(report).toHaveBeenCalledWith("RLS_SYNC_USER_A_API_STATUS=200");
  });

  it.each([401, 500])("classifies HTTP %s without reading its body", async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("sensitive response", { status }));
    const report = vi.fn();

    await expect(
      synchronizeApplicationUser(options(fetcher, report))
    ).rejects.toMatchObject({
      reason: "http-status",
    });
    expect(report).toHaveBeenCalledWith(
      "RLS_SYNC_USER_A_API_STATUS=" + status
    );
  });

  it("classifies network failure safely", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("private network detail"));
    const report = vi.fn();

    await expect(
      synchronizeApplicationUser(options(fetcher, report))
    ).rejects.toMatchObject({ reason: "network" });
    expect(report).toHaveBeenCalledWith("RLS_SYNC_USER_A_NETWORK=failed");
  });

  it("rejects an invalid HTTP 200 response contract", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ userId: expectedSubject })));
    const report = vi.fn();

    await expect(
      synchronizeApplicationUser(options(fetcher, report))
    ).rejects.toMatchObject({
      reason: "response-validation",
    });
    expect(report).toHaveBeenCalledWith(
      "RLS_SYNC_USER_A_RESPONSE_VALIDATION=failed"
    );
  });

  it("classifies identity mismatch without logging either identity", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: otherSubject }), { status: 200 })
    );
    const report = vi.fn();

    await expect(
      synchronizeApplicationUser(options(fetcher, report))
    ).rejects.toMatchObject({
      reason: "identity-mismatch",
    });
    expect(report).toHaveBeenCalledWith(
      "RLS_SYNC_USER_A_IDENTITY_MISMATCH=failed"
    );
    expect(JSON.stringify(report.mock.calls)).not.toContain(expectedSubject);
    expect(JSON.stringify(report.mock.calls)).not.toContain(otherSubject);
  });

  it("never logs or serializes the bearer token", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(realFormatToken));
    const report = vi.fn();

    await expect(
      synchronizeApplicationUser(options(fetcher, report))
    ).rejects.toThrow(ApplicationUserSyncError);
    expect(JSON.stringify(report.mock.calls)).not.toContain(realFormatToken);
  });
});
