import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, redirectMock } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  redirectMock: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("../../lib/api/server", () => ({
  AuthenticatedApiError: class AuthenticatedApiError extends Error {
    constructor(readonly status: number) {
      super("Authenticated API request failed");
    }
  },
  authenticatedApiRequest: apiRequest,
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { AuthenticatedApiError } from "../../lib/api/server";
import { startManualSync } from "./actions";

const projectId = "323e4567-e89b-42d3-a456-426614174000";

function formData(): FormData {
  const value = new FormData();
  value.set("projectId", projectId);
  return value;
}

describe("startManualSync", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    redirectMock.mockClear();
  });

  it("uses the authenticated server API boundary and redirects with whitelisted success", async () => {
    apiRequest.mockResolvedValue({
      status: "queued",
      syncRunId: "523e4567-e89b-42d3-a456-426614174000",
    });

    await expect(startManualSync(formData())).rejects.toThrow(
      "REDIRECT:/dashboard?projectId=323e4567-e89b-42d3-a456-426614174000&status=sync_started"
    );
    expect(apiRequest).toHaveBeenCalledWith(
      `/projects/${projectId}/sync-runs`,
      { method: "POST" }
    );
    expect(JSON.stringify(apiRequest.mock.calls)).not.toMatch(
      /accessToken|refreshToken|authorization|cookie/i
    );
  });

  it("maps provider failure to a whitelisted safe dashboard error", async () => {
    apiRequest.mockRejectedValue(new AuthenticatedApiError(503));

    await expect(startManualSync(formData())).rejects.toThrow(
      "error=sync_temporarily_unavailable"
    );
    expect(JSON.stringify(redirectMock.mock.calls)).not.toMatch(
      /providerPayload|token|stack/i
    );
  });

  it("rejects a malformed browser-supplied Project ID before the API call", async () => {
    const value = new FormData();
    value.set("projectId", "not-a-project-id");

    await expect(startManualSync(value)).rejects.toThrow(
      "REDIRECT:/dashboard?error=sync_unavailable"
    );
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
