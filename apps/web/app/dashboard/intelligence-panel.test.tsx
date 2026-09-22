import type {
  IntelligenceProcessingStatus,
  ProjectIntelligenceSummary,
} from "@developer-brand-copilot/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IntelligencePanel } from "./intelligence-panel";

const projectId = "323e4567-e89b-42d3-a456-426614174000";

function processing(status: IntelligenceProcessingStatus) {
  const messages: Record<IntelligenceProcessingStatus, string> = {
    queued: "Development intelligence is queued.",
    running: "Development intelligence is being processed.",
    succeeded: "Development intelligence is up to date.",
    failed_retryable:
      "Development intelligence is temporarily delayed and will retry automatically.",
    failed_terminal:
      "Development intelligence could not be processed. Try syncing again later.",
  };
  return {
    counters: {
      groupsDiscovered: 2,
      groupsFailed: status === "failed_terminal" ? 1 : 0,
      groupsRejected: 0,
      groupsSucceeded: 1,
    },
    failureCode:
      status === "failed_retryable"
        ? ("temporarily_unavailable" as const)
        : status === "failed_terminal"
          ? ("processing_failed" as const)
          : null,
    finishedAt: status === "succeeded" ? "2026-09-22T11:00:00.000Z" : null,
    processingVersion: "processing-v1",
    queuedAt: "2026-09-22T10:00:00.000Z",
    retryAfterAt:
      status === "failed_retryable" ? "2026-09-22T12:00:00.000Z" : null,
    startedAt: status === "queued" ? null : "2026-09-22T10:01:00.000Z",
    status,
    statusMessage: messages[status],
  };
}

function summary(
  overrides: Partial<ProjectIntelligenceSummary> = {}
): ProjectIntelligenceSummary {
  return {
    currentState: null,
    eventLimit: 20,
    events: [],
    processing: null,
    projectId,
    ...overrides,
  };
}

describe("IntelligencePanel", () => {
  it("renders the no-intelligence and empty state clearly", () => {
    render(<IntelligencePanel intelligence={summary()} loadFailed={false} />);
    expect(screen.getByText(/No development intelligence yet/)).toBeInTheDocument();
    expect(screen.getByText("Processing has not started.")).toBeInTheDocument();
    expect(screen.getByText("No ProjectState has been generated yet.")).toBeInTheDocument();
    expect(
      screen.getByText("No meaningful development events have been detected yet.")
    ).toBeInTheDocument();
  });

  it.each(["queued", "running"] as const)(
    "renders %s processing with human-readable text",
    (status) => {
      const run = processing(status);
      render(
        <IntelligencePanel
          intelligence={summary({ processing: run })}
          loadFailed={false}
        />
      );
      expect(screen.getByText(run.statusMessage)).toBeInTheDocument();
      expect(screen.queryByText(status)).not.toBeInTheDocument();
    }
  );

  it("renders retry-deferred timing without an internal failure enum", () => {
    const run = processing("failed_retryable");
    render(
      <IntelligencePanel
        intelligence={summary({ processing: run })}
        loadFailed={false}
      />
    );
    expect(screen.getByText(run.statusMessage)).toBeInTheDocument();
    expect(screen.getByText(/Retry after/)).toBeInTheDocument();
    expect(screen.queryByText("temporarily_unavailable")).not.toBeInTheDocument();
  });

  it("renders terminal failure as safe guidance", () => {
    const run = processing("failed_terminal");
    render(
      <IntelligencePanel
        intelligence={summary({ processing: run })}
        loadFailed={false}
      />
    );
    expect(screen.getByText(run.statusMessage)).toBeInTheDocument();
    expect(screen.queryByText("processing_failed")).not.toBeInTheDocument();
  });

  it("renders the current ProjectState and successful processing", () => {
    render(
      <IntelligencePanel
        loadFailed={false}
        intelligence={summary({
          processing: processing("succeeded"),
          currentState: {
            activeFeatures: [
              {
                developmentEventId: "event-active",
                occurredAt: "2026-09-22T09:00:00.000Z",
                relatedFeatureIds: ["feature-active"],
                summary: "Safe active summary",
                technologies: ["TypeScript"],
                title: "Build intelligence inspection",
                type: "feature_started",
              },
            ],
            completedFeatures: [],
            currentPhase: "Development intelligence",
            projectionVersion: "project-state-projection-v1",
            purpose: "Explain development progress",
            recentMilestones: [],
            targetAudience: "Developers",
            technologies: ["NestJS", "TypeScript"],
            updatedAt: "2026-09-22T10:00:00.000Z",
            version: 4,
          },
        })}
      />
    );
    expect(screen.getByText("Development intelligence is up to date.")).toBeInTheDocument();
    expect(screen.getByText(/Version 4/)).toHaveTextContent(
      "Projection project-state-projection-v1"
    );
    expect(screen.getByText("Explain development progress")).toBeInTheDocument();
    expect(screen.getByText("Developers")).toBeInTheDocument();
    expect(screen.getByText("NestJS, TypeScript")).toBeInTheDocument();
    expect(screen.getByText("Build intelligence inspection")).toBeInTheDocument();
  });

  it("renders recent active DevelopmentEvents with safe provenance and versions", () => {
    render(
      <IntelligencePanel
        loadFailed={false}
        intelligence={summary({
          events: [
            {
              confidence: 0.87,
              eventId: "event-1",
              extractionVersion: "development-event-extraction-v1",
              occurredAt: "2026-09-22T10:00:00.000Z",
              provenance: { commitCount: 3, pullRequestCount: 1 },
              status: "active",
              summary: "Added a bounded intelligence read model.",
              title: "Completed intelligence inspection",
              type: "feature_completed",
            },
          ],
        })}
      />
    );
    expect(screen.getByText("Completed intelligence inspection")).toBeInTheDocument();
    expect(screen.getByText("Feature Completed")).toBeInTheDocument();
    expect(screen.getByText(/87% confidence/)).toHaveTextContent(
      "3 commit references · 1 pull request references · Extraction development-event-extraction-v1"
    );
  });

  it("renders a safe isolated loading failure", () => {
    render(<IntelligencePanel intelligence={null} loadFailed />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Development intelligence could not be loaded. Try again later."
    );
  });

  it("renders nothing when no Project is selected", () => {
    const { container } = render(
      <IntelligencePanel intelligence={null} loadFailed={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
