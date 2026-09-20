"use server";

import type { StartSyncRunResponse } from "@developer-brand-copilot/contracts";
import { redirect } from "next/navigation";

import {
  authenticatedApiRequest,
  AuthenticatedApiError,
} from "../../lib/api/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function syncErrorCode(error: unknown): string {
  if (!(error instanceof AuthenticatedApiError)) return "sync_failed";
  switch (error.status) {
    case 404:
      return "sync_unavailable";
    case 409:
      return "sync_in_progress";
    case 429:
      return "sync_rate_limited";
    case 502:
      return "sync_access_attention";
    case 503:
      return "sync_temporarily_unavailable";
    default:
      return "sync_failed";
  }
}

export async function startManualSync(formData: FormData): Promise<never> {
  const projectId = formText(formData, "projectId");
  if (!uuidPattern.test(projectId)) {
    redirect("/dashboard?error=sync_unavailable");
  }

  try {
    await authenticatedApiRequest<StartSyncRunResponse>(
      `/projects/${encodeURIComponent(projectId)}/sync-runs`,
      { method: "POST" }
    );
  } catch (error) {
    redirect(
      `/dashboard?projectId=${encodeURIComponent(projectId)}&error=${syncErrorCode(error)}`
    );
  }

  redirect(
    `/dashboard?projectId=${encodeURIComponent(projectId)}&status=sync_started`
  );
}
