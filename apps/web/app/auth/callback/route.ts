import { type NextRequest, NextResponse } from "next/server";

import { getPublicWebConfig } from "../../../lib/public-config";
import { createClient } from "../../../lib/supabase/server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedPath = requestUrl.searchParams.get("next");
  const next =
    requestedPath?.startsWith("/") && !requestedPath.startsWith("//")
      ? requestedPath
      : "/";
  const config = getPublicWebConfig();

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, config.NEXT_PUBLIC_SITE_URL));
    }
  }

  return NextResponse.redirect(
    new URL("/?authError=callback_failed", config.NEXT_PUBLIC_SITE_URL)
  );
}
