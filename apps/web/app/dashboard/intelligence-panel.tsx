import type {
  DevelopmentEventType,
  ProjectIntelligenceSummary,
  ProjectStateEventReference,
} from "@developer-brand-copilot/contracts";

interface IntelligencePanelProps {
  readonly intelligence: ProjectIntelligenceSummary | null;
  readonly loadFailed: boolean;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric",
  }).format(new Date(value));
}

function eventTypeLabel(type: DevelopmentEventType): string {
  return type
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function stateItems(
  title: string,
  items: readonly ProjectStateEventReference[]
) {
  return (
    <div>
      <h4 className="font-medium">{title}</h4>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-gray-600">None recorded.</p>
      ) : (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {items.map((item) => (
            <li key={item.developmentEventId}>{item.title}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IntelligencePanel({ intelligence, loadFailed }: IntelligencePanelProps) {
  if (loadFailed) {
    return (
      <section aria-labelledby="intelligence-heading" className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 id="intelligence-heading" className="text-xl font-semibold">Development intelligence</h2>
        <p role="alert" className="mt-3 rounded-md bg-red-50 p-3">
          Development intelligence could not be loaded. Try again later.
        </p>
      </section>
    );
  }

  if (!intelligence) return null;
  const { currentState, events, processing } = intelligence;
  const hasIntelligence = currentState !== null || events.length > 0;

  return (
    <section aria-labelledby="intelligence-heading" className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 id="intelligence-heading" className="text-xl font-semibold">Development intelligence</h2>
      <p className="mt-1 text-sm text-gray-600">
        Current interpreted project state and recent development outcomes.
      </p>

      {!hasIntelligence && !processing ? (
        <p className="mt-4 rounded-md border border-dashed border-gray-300 p-4">
          No development intelligence yet. Sync GitHub activity to begin processing.
        </p>
      ) : null}

      <div className="mt-5 grid gap-5">
        <section aria-labelledby="processing-heading" className="rounded-md border border-gray-200 p-4">
          <h3 id="processing-heading" className="font-semibold">Processing status</h3>
          {processing ? (
            <div className="mt-2 text-sm">
              <p aria-live="polite">{processing.statusMessage}</p>
              {processing.retryAfterAt ? (
                <p className="mt-1">Retry after {formatTime(processing.retryAfterAt)}.</p>
              ) : null}
              <p className="mt-1 text-gray-600">
                {processing.counters.groupsSucceeded} completed, {processing.counters.groupsRejected} withheld, {processing.counters.groupsFailed} failed of {processing.counters.groupsDiscovered} groups.
              </p>
              <p className="mt-1 text-gray-600">Processing version: {processing.processingVersion}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-600">Processing has not started.</p>
          )}
        </section>

        <section aria-labelledby="state-heading" className="rounded-md border border-gray-200 p-4">
          <h3 id="state-heading" className="font-semibold">Current ProjectState</h3>
          {currentState ? (
            <div className="mt-3 grid gap-4 text-sm">
              <p>
                Version {currentState.version} · Projection {currentState.projectionVersion} · Updated {formatTime(currentState.updatedAt)}
              </p>
              <dl className="grid gap-2 sm:grid-cols-3">
                <div><dt className="font-medium">Purpose</dt><dd>{currentState.purpose ?? "Not established yet"}</dd></div>
                <div><dt className="font-medium">Audience</dt><dd>{currentState.targetAudience ?? "Not established yet"}</dd></div>
                <div><dt className="font-medium">Phase</dt><dd>{currentState.currentPhase ?? "Not established yet"}</dd></div>
              </dl>
              <div>
                <h4 className="font-medium">Technologies</h4>
                <p className="mt-1">{currentState.technologies.join(", ") || "None recorded."}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {stateItems("Active features", currentState.activeFeatures)}
                {stateItems("Completed features", currentState.completedFeatures)}
                {stateItems("Recent milestones", currentState.recentMilestones)}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-600">No ProjectState has been generated yet.</p>
          )}
        </section>

        <section aria-labelledby="events-heading" className="rounded-md border border-gray-200 p-4">
          <h3 id="events-heading" className="font-semibold">Recent DevelopmentEvents</h3>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">No meaningful development events have been detected yet.</p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {events.map((event) => (
                <li key={event.eventId} className="rounded-md bg-gray-50 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="font-medium">{event.title}</h4>
                    <span className="text-xs text-gray-600">{eventTypeLabel(event.type)}</span>
                  </div>
                  <p className="mt-1 text-sm">{event.summary}</p>
                  <p className="mt-2 text-xs text-gray-600">
                    {formatTime(event.occurredAt)} · {Math.round(event.confidence * 100)}% confidence · {event.provenance.commitCount} commit references · {event.provenance.pullRequestCount} pull request references · Extraction {event.extractionVersion}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
