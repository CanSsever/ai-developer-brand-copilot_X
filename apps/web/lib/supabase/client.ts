"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicWebConfig } from "../public-config";

export function createClient() {
  const config = getPublicWebConfig();

  return createBrowserClient(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
