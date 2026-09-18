import { createClient } from "../lib/supabase/server";
import { signInWithGithub, signOut } from "./auth/actions";
import { AuthStatus } from "./auth-status";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId =
    typeof data?.claims.sub === "string" ? data.claims.sub : undefined;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-center text-3xl font-semibold tracking-tight">
        AI Developer Brand Copilot
      </h1>
      <AuthStatus
        userId={userId}
        signInAction={signInWithGithub}
        signOutAction={signOut}
      />
      {userId ? (
        <nav aria-label="Product navigation" className="flex gap-4">
          <Link href="/dashboard">Open dashboard</Link>
          <Link href="/github/connect">Manage GitHub App connection</Link>
        </nav>
      ) : null}
    </main>
  );
}
