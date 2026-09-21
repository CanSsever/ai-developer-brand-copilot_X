"use server";

import type {
  ConnectedRepositorySummary,
  GitHubConnectionStartResponse,
  ProjectSummary,
} from "@developer-brand-copilot/contracts";
import { redirect } from "next/navigation";

import { authenticatedApiRequest } from "../../lib/api/server";

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function createProject(formData: FormData): Promise<never> {
  const destination =
    formText(formData, "returnTo") === "/dashboard"
      ? "/dashboard"
      : "/github/connect";

  try {
    await authenticatedApiRequest<ProjectSummary>("/projects", {
      method: "POST",
      body: JSON.stringify({ timezone: formText(formData, "timezone") }),
    });
  } catch {
    redirect(`${destination}?error=project_creation_failed`);
  }

  redirect(`${destination}?status=project_created`);
}

export async function startGitHubConnection(formData: FormData): Promise<never> {
  try {
    const result = await authenticatedApiRequest<GitHubConnectionStartResponse>(
      "/github/connections/start",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: formText(formData, "projectId"),
          mode: formText(formData, "mode") || undefined,
        }),
      }
    );
    redirect(result.installationUrl);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/github/connect?error=installation_start_failed");
  }
}

export async function connectRepository(formData: FormData): Promise<never> {
  const projectId = formText(formData, "projectId");
  const connectionId = formText(formData, "connectionId");

  try {
    await authenticatedApiRequest<ConnectedRepositorySummary>(
      "/github/repositories",
      {
        method: "POST",
        body: JSON.stringify({
          projectId,
          connectionId,
          repositoryId: formText(formData, "repositoryId"),
        }),
      }
    );
  } catch {
    redirect(
      `/github/connect?error=repository_connection_failed&projectId=${encodeURIComponent(projectId)}&connectionId=${encodeURIComponent(connectionId)}`
    );
  }

  redirect("/github/connect?status=repository_connected");
}

export async function disconnectGitHubConnection(
  formData: FormData
): Promise<never> {
  const connectionId = formText(formData, "connectionId");

  try {
    await authenticatedApiRequest(
      `/github/connections/${encodeURIComponent(connectionId)}`,
      { method: "DELETE" }
    );
  } catch {
    redirect("/github/connect?error=disconnect_failed");
  }

  redirect("/github/connect?status=locally_disconnected");
}
