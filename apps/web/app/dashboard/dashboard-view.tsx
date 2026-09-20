import type {
  GitHubConnectionSummary,
  ProjectSummary,
  RepositorySyncSummary,
} from "@developer-brand-copilot/contracts";
import Link from "next/link";

import { connectionErrorMessage, connectionStatusMessage } from "../github/feedback";
import { SyncButton } from "./sync-button";

interface DashboardViewProps {
  readonly connections: readonly GitHubConnectionSummary[];
  readonly createProjectAction: (formData: FormData) => Promise<never>;
  readonly error?: string | undefined;
  readonly loadFailed: boolean;
  readonly projects: readonly ProjectSummary[];
  readonly selectedProjectId?: string | undefined;
  readonly signOutAction: () => Promise<never>;
  readonly status?: string | undefined;
  readonly syncProjectAction: (formData: FormData) => Promise<never>;
}

function projectLabel(index: number): string {
  return `Project ${index + 1}`;
}

function projectConnectionAction(
  project: ProjectSummary,
  connections: readonly GitHubConnectionSummary[]
): { readonly href: string; readonly label: string } {
  const connectionId =
    project.connectedRepository?.connectionId ?? connections[0]?.id;
  const params = new URLSearchParams({ projectId: project.id });
  if (connectionId) params.set("connectionId", connectionId);

  if (project.connectedRepository) {
    return { href: `/github/connect?${params}`, label: "Manage connection" };
  }
  if (connectionId) {
    return { href: `/github/connect?${params}`, label: "Connect repository" };
  }
  return { href: "/github/connect", label: "Connect GitHub" };
}

function formatSyncTime(value: string): string {
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

export function syncStatusMessage(sync: RepositorySyncSummary): string {
  const latest = sync.latestRun;
  if (!latest) return "GitHub activity has not been synced yet.";

  switch (latest.status) {
    case "queued":
    case "running":
      return "Sync in progress.";
    case "succeeded": {
      const timestamp =
        sync.lastSuccessfulSyncAt ?? latest.finishedAt ?? latest.startedAt;
      const imported =
        latest.commitsInserted === 1
          ? "1 new commit imported."
          : `${latest.commitsInserted} new commits imported.`;
      return timestamp
        ? `Last synced: ${formatSyncTime(timestamp)}. ${imported}`
        : imported;
    }
    case "failed_retryable":
      return latest.retryAfterAt
        ? `GitHub is temporarily unavailable. Retry after ${formatSyncTime(latest.retryAfterAt)}.`
        : "GitHub is temporarily unavailable. Try again later.";
    case "failed_terminal":
      if (latest.failureCode === "GITHUB_SAFETY_LIMIT_EXCEEDED") {
        return "The import is incomplete because GitHub history exceeds the current 500-commit limit.";
      }
      return latest.failureCode === "GITHUB_AUTHORIZATION_FAILED" ||
        latest.failureCode === "CONNECTED_REPOSITORY_NOT_AVAILABLE"
        ? "GitHub access needs attention. Review the repository connection."
        : "GitHub activity synchronization could not be completed.";
    case "cancelled":
      return "The previous synchronization was cancelled.";
  }
}

export function DashboardView({
  connections,
  createProjectAction,
  error,
  loadFailed,
  projects,
  selectedProjectId,
  signOutAction,
  status,
  syncProjectAction,
}: DashboardViewProps) {
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const successMessage = connectionStatusMessage(status);
  const errorMessage = connectionErrorMessage(error);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 p-4 sm:p-8">
      <header className="flex flex-col gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">AI Developer Brand Copilot</p>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <nav aria-label="Product navigation" className="flex flex-wrap items-center gap-4">
          <Link aria-current="page" href="/dashboard">Dashboard</Link>
          <Link href="/github/connect">GitHub connection</Link>
          <form action={signOutAction}>
            <button type="submit">Sign out</button>
          </form>
        </nav>
      </header>

      <section aria-labelledby="session-heading" className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 id="session-heading" className="text-lg font-semibold">Account</h2>
        <p className="mt-2">Authenticated session active.</p>
      </section>

      {successMessage ? <p role="status" className="rounded-md bg-green-50 p-3">{successMessage}</p> : null}
      {errorMessage ? <p role="alert" className="rounded-md bg-red-50 p-3">{errorMessage}</p> : null}
      {loadFailed ? (
        <p role="alert" className="rounded-md bg-red-50 p-3">
          Dashboard data could not be loaded. Try again later.
        </p>
      ) : null}

      <section aria-labelledby="projects-heading" className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="projects-heading" className="text-xl font-semibold">Projects</h2>
            <p className="mt-1 text-sm text-gray-600">
              Projects keep repository access and future development activity isolated.
            </p>
          </div>
          <form action={createProjectAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <input name="returnTo" type="hidden" value="/dashboard" />
            <label className="flex flex-col gap-1">
              <span>Project timezone</span>
              <input name="timezone" defaultValue="Etc/UTC" required />
            </label>
            <button type="submit">Create Project</button>
          </form>
        </div>

        {!loadFailed && projects.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-gray-300 p-5">
            <h3 className="font-semibold">No Projects yet</h3>
            <p className="mt-1">Create a Project to connect an authorized GitHub repository.</p>
          </div>
        ) : null}

        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {projects.map((project, index) => {
            const isSelected = selectedProject?.id === project.id;
            const action = projectConnectionAction(project, connections);
            return (
              <li key={project.id} className="min-w-0 rounded-md border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{projectLabel(index)}</h3>
                    <p className="text-sm text-gray-600">Timezone: {project.timezone}</p>
                  </div>
                  {isSelected ? <span className="text-sm font-medium">Current</span> : null}
                </div>

                {project.connectedRepository ? (
                  <div className="mt-4 min-w-0">
                    <p className="font-medium text-green-700">Repository connected</p>
                    <p className="break-words">{project.connectedRepository.fullName}</p>
                    <p className="text-sm text-gray-600">
                      Default branch: {project.connectedRepository.defaultBranch}
                      {project.connectedRepository.isPrivate ? " · Private" : " · Public"}
                    </p>
                    <p aria-live="polite" className="mt-2 text-sm">
                      {syncStatusMessage(project.connectedRepository.sync)}
                    </p>
                  </div>
                ) : connections.length > 0 ? (
                  <p className="mt-4">GitHub App installed; no repository is connected to this Project.</p>
                ) : (
                  <p className="mt-4">No GitHub App connection.</p>
                )}

                <div className="mt-4 flex flex-wrap gap-4">
                  {!isSelected ? (
                    <Link href={`/dashboard?projectId=${encodeURIComponent(project.id)}`}>
                      Select Project
                    </Link>
                  ) : null}
                  <Link href={action.href}>{action.label}</Link>
                  {project.connectedRepository ? (
                    <form action={syncProjectAction}>
                      <input name="projectId" type="hidden" value={project.id} />
                      <SyncButton />
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {selectedProject ? (
        <section aria-labelledby="current-project-heading" className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 id="current-project-heading" className="text-xl font-semibold">Current Project</h2>
          <p className="mt-2">
            {projectLabel(projects.findIndex((project) => project.id === selectedProject.id))}
            {` · ${selectedProject.timezone}`}
          </p>
          <p className="mt-2 text-sm text-gray-600">
            {selectedProject.connectedRepository
              ? "Manual GitHub activity synchronization is available for this Project."
              : "Connect an authorized GitHub repository to synchronize activity."}
          </p>
        </section>
      ) : null}
    </main>
  );
}
