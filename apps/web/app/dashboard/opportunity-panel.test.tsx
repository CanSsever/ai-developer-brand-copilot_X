import type { ContentOpportunityCard, ContentOpportunityListResponse, OpportunityProcessingSummary } from "@developer-brand-copilot/contracts";
import {
  contentOpportunityReasonCodes,
  contentOpportunityRecommendedFormats,
  contentOpportunityTypes,
} from "@developer-brand-copilot/contracts";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  OpportunityPanel,
  opportunityFormatLabels,
  opportunityReasonLabels,
  opportunityTypeLabels,
} from "./opportunity-panel";

const projectId = "323e4567-e89b-42d3-a456-426614174000";
const firstId = "423e4567-e89b-42d3-a456-426614174000";
const secondId = "523e4567-e89b-42d3-a456-426614174000";
const eventId = "623e4567-e89b-42d3-a456-426614174000";
const event2Id = "723e4567-e89b-42d3-a456-426614174000";

function card(id: string, title: string, priorityScore = 0.88): ContentOpportunityCard {
  return {
    id, title, opportunityType: "feature_showcase", recommendedFormat: "technical_breakdown",
    priorityScore, noveltyScore: 0.8, confidence: 0.91, scoringVersion: "phase3-opportunity-scoring-v1",
    createdAt: "2026-09-24T12:00:00.000Z",
    reasonSignals: [
      { code: "high_importance", effect: "positive", value: 0.9, developmentEventIds: [eventId] },
      { code: "low_novelty", effect: "negative", value: 0.3, developmentEventIds: [eventId] },
    ],
    developmentEvents: [
      { developmentEventId: eventId, type: "feature_completed", title: "Completed read boundary", occurredAt: "2026-09-24T11:00:00.000Z" },
      { developmentEventId: event2Id, type: "testing_milestone", title: "Added cursor tests", occurredAt: "2026-09-24T11:30:00.000Z" },
    ],
  };
}

function processing(
  status: OpportunityProcessingSummary["status"],
  counts: Partial<Pick<OpportunityProcessingSummary, "candidateCount" | "recommendedCount" | "suppressedCount">> = {}
): OpportunityProcessingSummary {
  const messages: Record<OpportunityProcessingSummary["status"], string> = {
    queued: "Content opportunity analysis is queued.",
    running: "Content opportunity analysis is in progress.",
    succeeded: "Content opportunity analysis is up to date.",
    failed_retryable: "Content opportunity analysis is temporarily delayed and will retry automatically.",
    failed_terminal: "Content opportunities could not be updated.",
  };
  return {
    status, statusMessage: messages[status], queuedAt: "2026-09-24T10:00:00.000Z",
    startedAt: status === "queued" ? null : "2026-09-24T10:01:00.000Z",
    finishedAt: status === "succeeded" || status === "failed_terminal" ? "2026-09-24T10:02:00.000Z" : null,
    retryAfterAt: status === "failed_retryable" ? "2026-09-24T13:00:00.000Z" : null,
    processingVersion: "phase3-current-processing-version",
    candidateCount: 2, recommendedCount: 1, suppressedCount: 1, ...counts,
  };
}

function response(
  items: readonly ContentOpportunityCard[] = [],
  run: OpportunityProcessingSummary | null = null
): ContentOpportunityListResponse {
  return { projectId, items, nextCursor: null, processing: run };
}

describe("OpportunityPanel", () => {
  it("has fixed readable labels for every approved reason, format, and opportunity type", () => {
    expect(Object.keys(opportunityReasonLabels).sort()).toEqual([...contentOpportunityReasonCodes].sort());
    expect(Object.values(opportunityReasonLabels).every((label) => label.length > 0)).toBe(true);
    expect(Object.keys(opportunityFormatLabels).sort()).toEqual([...contentOpportunityRecommendedFormats].sort());
    expect(Object.values(opportunityFormatLabels).every((label) => label.length > 0)).toBe(true);
    expect(Object.keys(opportunityTypeLabels).sort()).toEqual([...contentOpportunityTypes].sort());
    expect(Object.values(opportunityTypeLabels).every((label) => label.length > 0)).toBe(true);
  });

  it("distinguishes no run from an analysis in progress", () => {
    const { rerender } = render(<OpportunityPanel opportunities={response()} loadFailed={false} />);
    expect(screen.getByText("Content recommendations have not been generated yet.")).toBeInTheDocument();
    rerender(<OpportunityPanel opportunities={response([], processing("queued"))} loadFailed={false} />);
    expect(screen.getByText("Analyzing recent development activity for share-worthy updates.")).toBeInTheDocument();
    rerender(<OpportunityPanel opportunities={response([], processing("running"))} loadFailed={false} />);
    expect(screen.getByText("Analyzing recent development activity for share-worthy updates.")).toBeInTheDocument();
  });

  it("distinguishes zero detected candidates from candidates that are all suppressed", () => {
    const { rerender } = render(<OpportunityPanel opportunities={response([], processing("succeeded", {
      candidateCount: 0, recommendedCount: 0, suppressedCount: 0,
    }))} loadFailed={false} />);
    expect(screen.getByText("No content opportunity was detected from the current development activity.")).toBeInTheDocument();
    rerender(<OpportunityPanel opportunities={response([], processing("succeeded", {
      candidateCount: 3, recommendedCount: 0, suppressedCount: 3,
    }))} loadFailed={false} />);
    expect(screen.getByText("Development activity was analyzed, but nothing currently meets the recommendation threshold.")).toBeInTheDocument();
  });

  it("renders a ranked recommendation with readable type, format, reasons, and safe event provenance", () => {
    render(<OpportunityPanel opportunities={response([card(firstId, "Completed opportunity read model")], processing("succeeded"))} loadFailed={false} />);
    expect(screen.getByRole("heading", { name: "Content opportunities" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Completed opportunity read model" })).toBeInTheDocument();
    expect(screen.getByText("Top content opportunity")).toBeInTheDocument();
    expect(screen.getByText("Feature showcase")).toBeInTheDocument();
    expect(screen.getByText("Technical breakdown")).toBeInTheDocument();
    expect(screen.getByText("Based on 2 development events")).toBeInTheDocument();
    expect(screen.getByText("Completed read boundary")).toBeInTheDocument();
    expect(screen.getByText(/Feature Completed/)).toBeInTheDocument();
    expect(screen.getByText("Added cursor tests")).toBeInTheDocument();
    const reasons = screen.getAllByRole("list")[1]!;
    expect(within(reasons).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "High-impact development", "Low novelty (caution)",
    ]);
    expect(screen.queryByText("high_importance")).not.toBeInTheDocument();
    expect(screen.queryByText("low_novelty")).not.toBeInTheDocument();
  });

  it("keeps API ranking order when rendering multiple cards", () => {
    render(<OpportunityPanel opportunities={response([
      card(firstId, "Highest ranked", 0.95), card(secondId, "Next ranked", 0.81),
    ], processing("succeeded"))} loadFailed={false} />);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Highest ranked", "Next ranked"]);
  });

  it.each(["queued", "running", "failed_retryable"] as const)(
    "keeps existing recommendations visible while a newer run is %s",
    (status) => {
      render(<OpportunityPanel opportunities={response([card(firstId, "Existing recommendation")], processing(status))} loadFailed={false} />);
      expect(screen.getByText("Existing recommendation")).toBeInTheDocument();
      const statusMessage = status === "queued"
        ? "New content opportunity analysis is queued. Current recommendations remain available."
        : status === "running"
          ? "New content opportunity analysis is in progress. Current recommendations remain available."
          : "Content opportunity analysis is temporarily delayed and will retry automatically.";
      expect(screen.getByText(statusMessage)).toBeInTheDocument();
    }
  );

  it("shows retry timing and safe terminal guidance without internal failure codes", () => {
    const { rerender } = render(<OpportunityPanel opportunities={response([], processing("failed_retryable"))} loadFailed={false} />);
    expect(screen.getByText(/temporarily delayed and will retry automatically/)).toBeInTheDocument();
    expect(screen.getByText(/Retry after/)).toBeInTheDocument();
    rerender(<OpportunityPanel opportunities={response([], processing("failed_terminal"))} loadFailed={false} />);
    expect(screen.getByText("Content opportunities could not be updated.")).toBeInTheDocument();
    expect(screen.queryByText(/OPPORTUNITY_/)).not.toBeInTheDocument();
  });

  it("isolates load failure and renders no recommendation controls", () => {
    render(<OpportunityPanel opportunities={null} loadFailed />);
    expect(screen.getByRole("alert")).toHaveTextContent("Content opportunities could not be loaded. Try again later.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/accept|dismiss|draft|publish|copy/i)).not.toBeInTheDocument();
  });
});
