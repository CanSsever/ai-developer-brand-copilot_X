import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicWebConfig } from "../public-config";

export async function createClient() {
  const config = getPublicWebConfig();
  const cookieStore = await cookies();

  return createServerClient(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components cannot write cookies. The proxy refreshes them.
          }
        },
      },
    }
  );
}
