import type {
  GitHubConnectionSummary,
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

  const query = await searchParams;
  return (
    <DashboardView
      connections={connections}
      createProjectAction={createProject}
      error={first(query.error)}
      loadFailed={loadFailed}
      projects={projects}
      selectedProjectId={first(query.projectId)}
      signOutAction={signOut}
      status={first(query.status)}
      syncProjectAction={startManualSync}
    />
  );
}
