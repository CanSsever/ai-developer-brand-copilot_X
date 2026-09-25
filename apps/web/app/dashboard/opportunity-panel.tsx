import type {
  ContentOpportunityListResponse,
  ContentOpportunityReasonCode,
  ContentOpportunityRecommendedFormat,
  ContentOpportunityType,
} from "@developer-brand-copilot/contracts";

export const opportunityReasonLabels: Record<ContentOpportunityReasonCode, string> = {
  high_importance: "High-impact development",
  high_content_potential: "Strong content potential",
  fresh_work: "Fresh work",
  novel_topic: "High novelty",
  feature_completed: "Feature completed",
  release_or_milestone: "Release or milestone",
  multi_event_story: "Multiple development events form one story",
  duplicate_topic: "Duplicate topic",
  repetition_penalty: "Repeated development theme",
  low_novelty: "Low novelty",
  low_confidence: "Lower confidence",
};

export const opportunityFormatLabels: Record<ContentOpportunityRecommendedFormat, string> = {
  short_update: "Short update",
  visual_progress: "Visual progress update",
  technical_breakdown: "Technical breakdown",
  milestone_update: "Milestone update",
  release_announcement: "Release announcement",
  multi_point_story: "Multi-point story",
};

export const opportunityTypeLabels: Record<ContentOpportunityType, string> = {
  progress_update: "Progress update",
  feature_showcase: "Feature showcase",
  technical_insight: "Technical insight",
  problem_solution: "Problem and solution",
  milestone: "Milestone",
  release: "Release",
};

interface OpportunityPanelProps {
  readonly opportunities: ContentOpportunityListResponse | null;
  readonly loadFailed: boolean;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric", hour: "numeric", minute: "2-digit", month: "short",
    timeZone: "UTC", timeZoneName: "short", year: "numeric",
  }).format(new Date(value));
}

function emptyMessage(opportunities: ContentOpportunityListResponse | null): string {
  const processing = opportunities?.processing;
  if (!processing) return "Content recommendations have not been generated yet.";
  if (processing.status === "queued" || processing.status === "running") {
    return "Analyzing recent development activity for share-worthy updates.";
  }
  if (processing.status === "succeeded" && processing.candidateCount === 0) {
    return "No content opportunity was detected from the current development activity.";
  }
  if (processing.status === "succeeded" && processing.recommendedCount === 0) {
    return "Development activity was analyzed, but nothing currently meets the recommendation threshold.";
  }
  return processing.statusMessage;
}

export function OpportunityPanel({ opportunities, loadFailed }: OpportunityPanelProps) {
  if (loadFailed) {
    return (
      <section aria-labelledby="opportunities-heading" className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 id="opportunities-heading" className="text-xl font-semibold">Content opportunities</h2>
        <p role="alert" className="mt-3 rounded-md bg-red-50 p-3">
          Content opportunities could not be loaded. Try again later.
        </p>
      </section>
    );
  }

  const items = opportunities?.items ?? [];
  const processing = opportunities?.processing ?? null;
  return (
    <section aria-labelledby="opportunities-heading" className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 id="opportunities-heading" className="text-xl font-semibold">Content opportunities</h2>
      <p className="mt-1 text-sm text-gray-600">Share-worthy development ideas grounded in your recent work.</p>

      {items.length === 0 ? (
        <p aria-live="polite" className="mt-4 rounded-md border border-dashed border-gray-300 p-4">
          {emptyMessage(opportunities)}
          {processing?.status === "failed_retryable" && processing.retryAfterAt ? (
            <span className="mt-1 block">Retry after {formatTime(processing.retryAfterAt)}.</span>
          ) : null}
        </p>
      ) : (
        <>
          {processing && processing.status !== "succeeded" ? (
            <p aria-live="polite" className="mt-4 rounded-md bg-blue-50 p-3">
              {processing.status === "queued"
                ? "New content opportunity analysis is queued. Current recommendations remain available."
                : processing.status === "running"
                  ? "New content opportunity analysis is in progress. Current recommendations remain available."
                  : processing.statusMessage}
              {processing.status === "failed_retryable" && processing.retryAfterAt ? (
                <span className="mt-1 block">Retry after {formatTime(processing.retryAfterAt)}.</span>
              ) : null}
            </p>
          ) : null}
          <ol className="mt-5 grid gap-4">
            {items.map((item, index) => (
              <li key={item.id} className="rounded-md border border-gray-200 p-4">
                <article aria-labelledby={`opportunity-${item.id}`}>
                  {index === 0 ? <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Top content opportunity</p> : null}
                  <h3 id={`opportunity-${item.id}`} className="mt-1 text-lg font-semibold">{item.title}</h3>
                  <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="font-medium">Opportunity type</dt>
                      <dd className="mt-1">{opportunityTypeLabels[item.opportunityType]}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">Recommended format</dt>
                      <dd className="mt-1">{opportunityFormatLabels[item.recommendedFormat]}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="font-medium">Why?</dt>
                      {item.reasonSignals.length > 0 ? (
                        <ul className="mt-1 list-disc space-y-1 pl-5">
                          {item.reasonSignals.map((signal, signalIndex) => (
                            <li key={`${signal.code}-${signalIndex}`}>
                              {opportunityReasonLabels[signal.code]}
                              {signal.effect === "negative" ? " (caution)" : ""}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-gray-600">No reason signals are available.</p>
                      )}
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="font-medium">
                        Based on {item.developmentEvents.length} development {item.developmentEvents.length === 1 ? "event" : "events"}
                      </dt>
                      {item.developmentEvents.length > 0 ? (
                        <ul className="mt-1 list-disc space-y-1 pl-5">
                          {item.developmentEvents.map((event) => (
                            <li key={event.developmentEventId}>
                              <span className="font-medium">{event.title}</span>
                              <span className="text-gray-600"> - {event.type.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ")}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p role="alert" className="mt-1 text-sm text-red-700">Event provenance is unavailable.</p>
                      )}
                    </div>
                  </dl>
                </article>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
