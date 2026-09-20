import type {
  GitHubConnectionSummary,
  ProjectSummary,
  RepositorySyncSummary,
} from "@developer-brand-copilot/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardView } from "./dashboard-view";

const action = async (): Promise<never> =>
  Promise.reject(new Error("not called in render tests"));

const project: ProjectSummary = {
  id: "323e4567-e89b-42d3-a456-426614174000",
  timezone: "Europe/Berlin",
  connectedRepository: null,
};

const connection: GitHubConnectionSummary = {
  id: "423e4567-e89b-42d3-a456-426614174000",
  accountLogin: "safe-account",
  accountType: "User",
  status: "active",
};

function connectedProject(sync: RepositorySyncSummary): ProjectSummary {
  return {
    ...project,
    connectedRepository: {
      connectionId: connection.id,
      defaultBranch: "main",
      fullName: "safe-owner/safe-repository",
      isPrivate: true,
      status: "active",
      sync,
    },
  };
}

function renderConnected(sync: RepositorySyncSummary) {
  const connected = connectedProject(sync);
  render(
    <DashboardView
      connections={[connection]}
      createProjectAction={action}
      loadFailed={false}
      projects={[connected]}
      selectedProjectId={connected.id}
      signOutAction={action}
      syncProjectAction={action}
    />
  );
}

describe("DashboardView", () => {
  it("renders authenticated navigation, Project creation, and the empty state", () => {
    render(
      <DashboardView
        connections={[]}
        createProjectAction={action}
        loadFailed={false}
        projects={[]}
        signOutAction={action}
        syncProjectAction={action}
      />
    );

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Authenticated session active.")).toBeInTheDocument();
    expect(screen.getByText("No Projects yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Project timezone")).toHaveValue("Etc/UTC");
    expect(screen.getByRole("button", { name: "Create Project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("represents an installed GitHub App with no connected repository", () => {
    render(
      <DashboardView
        connections={[connection]}
        createProjectAction={action}
        loadFailed={false}
        projects={[project]}
        signOutAction={action}
        syncProjectAction={action}
      />
    );

    expect(
      screen.getByText("GitHub App installed; no repository is connected to this Project.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect repository" })).toHaveAttribute(
      "href",
      expect.stringContaining("/github/connect?")
    );
    expect(
      screen.queryByRole("button", { name: "Sync GitHub activity" })
    ).not.toBeInTheDocument();
  });

  it("renders the connected repository and selected Project state", () => {
    const connected = connectedProject({
      lastSuccessfulSyncAt: null,
      latestRun: null,
    });

    render(
      <DashboardView
        connections={[connection]}
        createProjectAction={action}
        loadFailed={false}
        projects={[connected]}
        selectedProjectId={connected.id}
        signOutAction={action}
        syncProjectAction={action}
      />
    );

    expect(screen.getByText("Repository connected")).toBeInTheDocument();
    expect(screen.getByText("safe-owner/safe-repository")).toBeInTheDocument();
    expect(screen.getByText("Default branch: main · Private")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage connection" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sync GitHub activity" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("GitHub activity has not been synced yet.")
    ).toBeInTheDocument();
  });

  it("renders succeeded synchronization with a safe imported count", () => {
    renderConnected({
      lastSuccessfulSyncAt: "2026-09-19T10:00:00.000Z",
      latestRun: {
        attemptCount: 5,
        commitsDiscovered: 4,
        commitsInserted: 3,
        failureCode: null,
        finishedAt: "2026-09-19T10:00:00.000Z",
        retryAfterAt: null,
        startedAt: "2026-09-19T09:59:00.000Z",
        status: "succeeded",
        syncRunId: "523e4567-e89b-42d3-a456-426614174000",
      },
    });

    expect(screen.getByText(/Last synced:/)).toHaveTextContent(
      "3 new commits imported."
    );
  });

  it.each(["queued", "running"] as const)(
    "renders %s synchronization as progress",
    (status) => {
      renderConnected({
        lastSuccessfulSyncAt: null,
        latestRun: {
          attemptCount: 0,
          commitsDiscovered: 0,
          commitsInserted: 0,
          failureCode: null,
          finishedAt: null,
          retryAfterAt: null,
          startedAt: "2026-09-19T10:00:00.000Z",
          status,
          syncRunId: "523e4567-e89b-42d3-a456-426614174000",
        },
      });

      expect(screen.getByText("Sync in progress.")).toBeInTheDocument();
    }
  );

  it("renders retryable failure and retry timing without internal constants", () => {
    renderConnected({
      lastSuccessfulSyncAt: null,
      latestRun: {
        attemptCount: 3,
        commitsDiscovered: 0,
        commitsInserted: 0,
        failureCode: "GITHUB_RATE_LIMITED",
        finishedAt: "2026-09-19T10:00:00.000Z",
        retryAfterAt: "2026-09-19T11:00:00.000Z",
        startedAt: "2026-09-19T09:59:00.000Z",
        status: "failed_retryable",
        syncRunId: "523e4567-e89b-42d3-a456-426614174000",
      },
    });

    expect(screen.getByText(/Retry after/)).toHaveTextContent(
      "GitHub is temporarily unavailable."
    );
    expect(screen.queryByText(/GITHUB_RATE_LIMITED/)).not.toBeInTheDocument();
  });

  it("renders terminal authorization failure as connection guidance", () => {
    renderConnected({
      lastSuccessfulSyncAt: null,
      latestRun: {
        attemptCount: 1,
        commitsDiscovered: 0,
        commitsInserted: 0,
        failureCode: "GITHUB_AUTHORIZATION_FAILED",
        finishedAt: "2026-09-19T10:00:00.000Z",
        retryAfterAt: null,
        startedAt: "2026-09-19T09:59:00.000Z",
        status: "failed_terminal",
        syncRunId: "523e4567-e89b-42d3-a456-426614174000",
      },
    });

    expect(
      screen.getByText(
        "GitHub access needs attention. Review the repository connection."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/GITHUB_AUTHORIZATION_FAILED/)
    ).not.toBeInTheDocument();
  });

  it("renders the import safety limit as an incomplete import without exposing its code", () => {
    renderConnected({
      lastSuccessfulSyncAt: null,
      latestRun: {
        attemptCount: 7,
        commitsDiscovered: 0,
        commitsInserted: 0,
        failureCode: "GITHUB_SAFETY_LIMIT_EXCEEDED",
        finishedAt: "2026-09-19T10:00:00.000Z",
        retryAfterAt: null,
        startedAt: "2026-09-19T09:59:00.000Z",
        status: "failed_terminal",
        syncRunId: "523e4567-e89b-42d3-a456-426614174000",
      },
    });

    expect(
      screen.getByText(
        "The import is incomplete because GitHub history exceeds the current 500-commit limit."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/GITHUB_SAFETY_LIMIT_EXCEEDED/)
    ).not.toBeInTheDocument();
  });

  it("renders a safe API failure without backend details", () => {
    render(
      <DashboardView
        connections={[]}
        createProjectAction={action}
        loadFailed
        projects={[]}
        signOutAction={action}
        syncProjectAction={action}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Dashboard data could not be loaded. Try again later."
    );
  });
});
