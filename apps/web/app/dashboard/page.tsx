import type {
  ContentOpportunityListResponse,
  DailyDevelopmentSummaryResponse,
  GitHubConnectionSummary,
  ProjectIntelligenceSummary,
  ProjectSummary,
} from "@developer-brand-copilot/contracts";
import { redirect } from "next/navigation";

import { authenticatedApiRequest, AuthenticatedApiError } from "../../lib/api/server";
import { createClient } from "../../lib/supabase/server";
import { signOut } from "../auth/actions";
import { createProject } from "../github/actions";
import { startManualSync } from "./actions";
import { DashboardView } from "./dashboard-view";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims.sub !== "string") {
    redirect("/?authError=authentication_required");
  }

  let projects: readonly ProjectSummary[] = [];
  let connections: readonly GitHubConnectionSummary[] = [];
  let loadFailed = false;
  let intelligence: ProjectIntelligenceSummary | null = null;
  let intelligenceLoadFailed = false;
  let dailySummary: DailyDevelopmentSummaryResponse | null = null;
  let dailySummaryLoadFailed = false;
  let opportunities: ContentOpportunityListResponse | null = null;
  let opportunitiesLoadFailed = false;
  const query = await searchParams;

  try {
    [projects, connections] = await Promise.all([
      authenticatedApiRequest<readonly ProjectSummary[]>("/projects"),
      authenticatedApiRequest<readonly GitHubConnectionSummary[]>("/github/connections"),
    ]);
  } catch (error) {
    if (error instanceof AuthenticatedApiError && error.status === 401) {
      redirect("/?authError=authentication_required");
    }
    loadFailed = true;
  }

  const selectedProjectId = first(query.projectId);
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  if (selectedProject) {
    try {
      intelligence = await authenticatedApiRequest<ProjectIntelligenceSummary>(
        `/projects/${encodeURIComponent(selectedProject.id)}/intelligence`
      );
    } catch (error) {
      if (error instanceof AuthenticatedApiError && error.status === 401) {
        redirect("/?authError=authentication_required");
      }
      intelligenceLoadFailed = true;
    }
    try {
      dailySummary = await authenticatedApiRequest<DailyDevelopmentSummaryResponse>(
        `/projects/${encodeURIComponent(selectedProject.id)}/daily-summaries/today`
      );
    } catch (error) {
      if (error instanceof AuthenticatedApiError && error.status === 401) {
        redirect("/?authError=authentication_required");
      }
      dailySummaryLoadFailed = true;
    }
    try {
      opportunities = await authenticatedApiRequest<ContentOpportunityListResponse>(
        `/projects/${encodeURIComponent(selectedProject.id)}/opportunities`
      );
    } catch (error) {
      if (error instanceof AuthenticatedApiError && error.status === 401) {
        redirect("/?authError=authentication_required");
      }
      opportunitiesLoadFailed = true;
    }
  }

  return (
    <DashboardView
      connections={connections}
      createProjectAction={createProject}
      error={first(query.error)}
      loadFailed={loadFailed}
      intelligence={intelligence}
      intelligenceLoadFailed={intelligenceLoadFailed}
      dailySummary={dailySummary}
      dailySummaryLoadFailed={dailySummaryLoadFailed}
      opportunities={opportunities}
      opportunitiesLoadFailed={opportunitiesLoadFailed}
      projects={projects}
      selectedProjectId={first(query.projectId)}
      signOutAction={signOut}
      status={first(query.status)}
      syncProjectAction={startManualSync}
    />
  );
}
