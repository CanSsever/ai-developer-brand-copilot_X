import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
  api: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: pageMocks.redirect }));
vi.mock("../../lib/supabase/server", () => ({ createClient: pageMocks.createClient }));
vi.mock("../../lib/api/server", () => ({
  authenticatedApiRequest: pageMocks.api,
  AuthenticatedApiError: class AuthenticatedApiError extends Error {
    constructor(readonly status: number) {
      super("Authenticated API request failed");
      this.name = "AuthenticatedApiError";
    }
  },
}));

import { AuthenticatedApiError } from "../../lib/api/server";
import DashboardPage from "./page";

const project1 = { id: "323e4567-e89b-42d3-a456-426614174000", timezone: "Europe/Berlin", connectedRepository: null };
const project2 = { id: "423e4567-e89b-42d3-a456-426614174000", timezone: "Etc/UTC", connectedRepository: null };

function opportunityResponse(projectId: string, title: string) {
  return {
    projectId,
    items: [{
      id: "523e4567-e89b-42d3-a456-426614174000", title,
      opportunityType: "progress_update", recommendedFormat: "short_update",
      priorityScore: 0.8, noveltyScore: 0.9, confidence: 0.9,
      scoringVersion: "phase3-opportunity-scoring-v1", createdAt: "2026-09-24T10:00:00.000Z",
      reasonSignals: [],
      developmentEvents: [{
        developmentEventId: "623e4567-e89b-42d3-a456-426614174000",
        type: "feature_completed", title: "Safe selected event", occurredAt: "2026-09-24T09:00:00.000Z",
      }],
    }],
    nextCursor: null, processing: null,
  };
}

function configureApi(options: { projects?: readonly object[]; opportunityFailure?: Error; selectedTitle?: string } = {}) {
  pageMocks.api.mockImplementation(async (path: string) => {
    if (path === "/projects") return options.projects ?? [project1];
    if (path === "/github/connections") return [];
    if (path.endsWith("/intelligence")) return {
      currentState: null, eventLimit: 20, events: [], processing: null,
      projectId: path.split("/")[2],
    };
    if (path.endsWith("/daily-summaries/today")) return {
      confidence: null, counts: { commits: 0, excludedActivities: 0, meaningfulEvents: 0 },
      developerDay: "2026-09-24", generationVersion: "daily-development-summary-v1", items: [],
      projectId: path.split("/")[2], projectStateVersion: null, status: "no_activity",
      statusMessage: "No repository activity was recorded for this developer day.",
      timezone: "Europe/Berlin", version: 1,
    };
    if (path.endsWith("/opportunities")) {
      if (options.opportunityFailure) throw options.opportunityFailure;
      return opportunityResponse(path.split("/")[2]!, options.selectedTitle ?? "Project opportunity");
    }
    throw new Error(`Unexpected API path: ${path}`);
  });
}

describe("DashboardPage opportunity fetch", () => {
  beforeEach(() => {
    pageMocks.api.mockReset();
    pageMocks.redirect.mockReset().mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`);
    });
    pageMocks.createClient.mockReset().mockResolvedValue({
      auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "123e4567-e89b-42d3-a456-426614174000" } } }) },
    });
  });

  it("isolates opportunity load failure from Projects, intelligence, and daily summary", async () => {
    configureApi({ opportunityFailure: new Error("private backend failure") });
    render(await DashboardPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Development intelligence" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Content opportunities could not be loaded. Try again later.");
    expect(screen.queryByText("private backend failure")).not.toBeInTheDocument();
  });

  it("redirects to authentication when the opportunities endpoint returns 401", async () => {
    configureApi({ opportunityFailure: new AuthenticatedApiError(401) });
    await expect(DashboardPage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("redirect:/?authError=authentication_required");
    expect(pageMocks.redirect).toHaveBeenCalledWith("/?authError=authentication_required");
  });

  it("fetches and renders opportunities only for the selected Project", async () => {
    configureApi({ projects: [project1, project2], selectedTitle: "Second Project opportunity" });
    render(await DashboardPage({ searchParams: Promise.resolve({ projectId: project2.id }) }));
    expect(pageMocks.api).toHaveBeenCalledWith(`/projects/${project2.id}/opportunities`);
    expect(screen.getByText("Second Project opportunity")).toBeInTheDocument();
    expect(screen.queryByText("Project opportunity")).not.toBeInTheDocument();
  });
});
