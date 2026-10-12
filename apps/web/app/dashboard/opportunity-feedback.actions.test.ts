import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest, redirectMock } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  redirectMock: vi.fn((destination: string) => { throw new Error(`REDIRECT:${destination}`); }),
}));

vi.mock("../../lib/api/server", () => ({
  AuthenticatedApiError: class AuthenticatedApiError extends Error {
    constructor(readonly status: number, readonly code?: string) { super("Authenticated API request failed"); }
  },
  authenticatedApiRequest: apiRequest,
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { AuthenticatedApiError } from "../../lib/api/server";
import { submitOpportunityFeedback } from "./opportunity-feedback.actions";

const projectId = "323e4567-e89b-42d3-a456-426614174000";
const opportunityId = "523e4567-e89b-42d3-a456-426614174000";

function formData(action: string, reason = ""): FormData {
  const value = new FormData();
  value.set("projectId", projectId);
  value.set("opportunityId", opportunityId);
  value.set("action", action);
  value.set("reason", reason);
  return value;
}

describe("submitOpportunityFeedback", () => {
  beforeEach(() => {
    apiRequest.mockReset().mockResolvedValue({ id: "feedback-id", opportunityId, action: "accepted", reason: null, createdAt: "2026-09-25T10:00:00.000Z", isCurrent: true });
    redirectMock.mockClear();
  });

  it("posts Accept through the authenticated API with a fresh server-generated idempotency key", async () => {
    await expect(submitOpportunityFeedback(formData("accepted"))).rejects.toThrow(
      `REDIRECT:/dashboard?projectId=${projectId}&status=opportunity_accepted`,
    );
    const [path, init] = apiRequest.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/projects/${projectId}/opportunities/${opportunityId}/feedback`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ action: "accepted" });
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("posts a bounded dismissal reason and uses a new key for each intentional submission", async () => {
    await expect(submitOpportunityFeedback(formData("dismissed", "repetitive"))).rejects.toThrow("opportunity_dismissed");
    await expect(submitOpportunityFeedback(formData("dismissed", "sensitive"))).rejects.toThrow("opportunity_dismissed");
    const first = apiRequest.mock.calls[0]?.[1] as RequestInit;
    const second = apiRequest.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(first.body))).toEqual({ action: "dismissed", reason: "repetitive" });
    expect(JSON.parse(String(second.body))).toEqual({ action: "dismissed", reason: "sensitive" });
    expect((first.headers as Record<string, string>)["Idempotency-Key"]).not.toBe((second.headers as Record<string, string>)["Idempotency-Key"]);
  });

  it("does not call the API for malformed targets, actions, or free-text reasons", async () => {
    await expect(submitOpportunityFeedback(formData("other"))).rejects.toThrow("feedback_invalid");
    await expect(submitOpportunityFeedback(formData("dismissed", "please explain"))).rejects.toThrow("feedback_invalid");
    const malformed = formData("accepted");
    malformed.set("opportunityId", "not-a-uuid");
    await expect(submitOpportunityFeedback(malformed)).rejects.toThrow("feedback_invalid");
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["stale opportunity", new AuthenticatedApiError(409, "FEEDBACK_NOT_ACTIONABLE"), "feedback_stale"],
    ["idempotency conflict", new AuthenticatedApiError(409, "FEEDBACK_IDEMPOTENCY_CONFLICT"), "feedback_idempotency_conflict"],
    ["resource unavailable", new AuthenticatedApiError(404), "feedback_unavailable"],
    ["generic failure", new AuthenticatedApiError(503), "feedback_failed"],
  ])("maps %s to a safe dashboard status", async (_label, error, code) => {
    apiRequest.mockRejectedValue(error);
    await expect(submitOpportunityFeedback(formData("accepted"))).rejects.toThrow(`error=${code}`);
    expect(redirectMock.mock.calls[0]?.[0]).not.toMatch(/stack|provider|sql|token/i);
  });
});
