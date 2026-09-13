"use server";

import { redirect } from "next/navigation";

import { getPublicWebConfig } from "../../lib/public-config";
import { createClient } from "../../lib/supabase/server";

export async function signInWithGithub(): Promise<never> {
  const config = getPublicWebConfig();
  const supabase = await createClient();
  const redirectTo = new URL(
    "/auth/callback",
    config.NEXT_PUBLIC_SITE_URL
  ).toString();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo },
  });

  if (error || !data.url) {
    redirect("/?authError=sign_in_failed");
  }

  redirect(data.url);
}

export async function signOut(): Promise<never> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    redirect("/?authError=sign_out_failed");
  }

  redirect("/");
}
