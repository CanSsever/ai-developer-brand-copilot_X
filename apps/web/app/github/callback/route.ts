import type { GitHubConnectionCompleteResponse } from "@developer-brand-copilot/contracts";
import { NextResponse } from "next/server";

import {
  AuthenticatedApiError,
  authenticatedApiRequest,
} from "../../../lib/api/server";
import { getPublicWebConfig } from "../../../lib/public-config";

function destination(path: string): URL {
  return new URL(path, getPublicWebConfig().NEXT_PUBLIC_SITE_URL);
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const installationId = url.searchParams.get("installation_id");
  const state = url.searchParams.get("state");

  if (!code || !installationId || !state) {
    return NextResponse.redirect(
      destination("/github/connect?error=invalid_callback")
    );
  }

  try {
    const result = await authenticatedApiRequest<GitHubConnectionCompleteResponse>(
      "/github/connections/complete",
      {
        method: "POST",
        body: JSON.stringify({ code, installationId, state }),
      }
    );
    const target = destination("/github/connect");
    target.searchParams.set("status", "installation_connected");
    target.searchParams.set("projectId", result.projectId);
    target.searchParams.set("connectionId", result.connection.id);
    return NextResponse.redirect(target);
  } catch (error) {
    if (error instanceof AuthenticatedApiError && error.status === 401) {
      return NextResponse.redirect(
        destination("/?authError=authentication_required")
      );
    }
    return NextResponse.redirect(
      destination("/github/connect?error=installation_verification_failed")
    );
  }
}
