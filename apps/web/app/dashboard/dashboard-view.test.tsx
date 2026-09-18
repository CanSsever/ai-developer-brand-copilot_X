import type {
  GitHubConnectionSummary,
  ProjectSummary,
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

describe("DashboardView", () => {
  it("renders authenticated navigation, Project creation, and the empty state", () => {
    render(
      <DashboardView
        connections={[]}
        createProjectAction={action}
        loadFailed={false}
        projects={[]}
        signOutAction={action}
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
      />
    );

    expect(
      screen.getByText("GitHub App installed; no repository is connected to this Project.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect repository" })).toHaveAttribute(
      "href",
      expect.stringContaining("/github/connect?")
    );
  });

  it("renders the connected repository and selected Project state", () => {
    const connectedProject: ProjectSummary = {
      ...project,
      connectedRepository: {
        connectionId: connection.id,
        defaultBranch: "main",
        fullName: "safe-owner/safe-repository",
        isPrivate: true,
        status: "active",
      },
    };

    render(
      <DashboardView
        connections={[connection]}
        createProjectAction={action}
        loadFailed={false}
        projects={[connectedProject]}
        selectedProjectId={connectedProject.id}
        signOutAction={action}
      />
    );

    expect(screen.getByText("Repository connected")).toBeInTheDocument();
    expect(screen.getByText("safe-owner/safe-repository")).toBeInTheDocument();
    expect(screen.getByText("Default branch: main · Private")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage connection" })).toBeInTheDocument();
  });

  it("renders a safe API failure without backend details", () => {
    render(
      <DashboardView
        connections={[]}
        createProjectAction={action}
        loadFailed
        projects={[]}
        signOutAction={action}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Dashboard data could not be loaded. Try again later."
    );
  });
});
