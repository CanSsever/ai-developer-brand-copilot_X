import type {
  AuthorizedRepositorySummary,
  GitHubConnectionSummary,
  ProjectSummary,
} from "@developer-brand-copilot/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authenticatedApiRequest } from "../../../lib/api/server";
import { createClient } from "../../../lib/supabase/server";
import {
  connectRepository,
  createProject,
  disconnectGitHubConnection,
  startGitHubConnection,
} from "../actions";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function GitHubConnectPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims.sub !== "string") redirect("/");

  const query = await searchParams;
  const projectId = first(query.projectId);
  const connectionId = first(query.connectionId);
  let projects: readonly ProjectSummary[] = [];
  let connections: readonly GitHubConnectionSummary[] = [];
  let repositories: readonly AuthorizedRepositorySummary[] = [];
  let loadFailed = false;

  try {
    [projects, connections] = await Promise.all([
      authenticatedApiRequest<readonly ProjectSummary[]>("/projects"),
      authenticatedApiRequest<readonly GitHubConnectionSummary[]>(
        "/github/connections"
      ),
    ]);

    if (projectId && connectionId) {
      repositories = await authenticatedApiRequest<
        readonly AuthorizedRepositorySummary[]
      >(
        `/github/connections/${encodeURIComponent(connectionId)}/repositories?projectId=${encodeURIComponent(projectId)}`
      );
    }
  } catch {
    loadFailed = true;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <header>
        <Link href="/">← Home</Link>
        <h1 className="mt-4 text-3xl font-semibold">GitHub App connection</h1>
        <p>Repository authorization is separate from GitHub sign-in.</p>
      </header>

      {loadFailed ? <p role="alert">Connection data could not be loaded.</p> : null}
      {first(query.status) ? <p role="status">{first(query.status)}</p> : null}
      {first(query.error) ? <p role="alert">{first(query.error)}</p> : null}

      <section aria-labelledby="projects-heading">
        <h2 id="projects-heading" className="text-xl font-semibold">Projects</h2>
        <form action={createProject} className="mt-3 flex gap-3">
          <label>
            Timezone
            <input name="timezone" defaultValue="Etc/UTC" required />
          </label>
          <button type="submit">Create Project</button>
        </form>
        <ul className="mt-4 space-y-3">
          {projects.map((project) => (
            <li key={project.id}>
              <span>{project.timezone}</span>
              <form action={startGitHubConnection} className="inline pl-3">
                <input type="hidden" name="projectId" value={project.id} />
                <button type="submit">Connect GitHub App</button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="connections-heading">
        <h2 id="connections-heading" className="text-xl font-semibold">Installations</h2>
        <ul className="mt-4 space-y-3">
          {connections.map((connection) => (
            <li key={connection.id}>
              <span>{connection.accountLogin} ({connection.accountType})</span>
              <form action={disconnectGitHubConnection} className="inline pl-3">
                <input type="hidden" name="connectionId" value={connection.id} />
                <button type="submit">Disconnect locally</button>
              </form>
            </li>
          ))}
        </ul>
        <p>Local disconnect does not uninstall or revoke the GitHub App at GitHub.</p>
      </section>

      {projectId && connectionId ? (
        <section aria-labelledby="repositories-heading">
          <h2 id="repositories-heading" className="text-xl font-semibold">
            Authorized repositories
          </h2>
          <ul className="mt-4 space-y-3">
            {repositories.map((repository) => (
              <li key={repository.id}>
                <span>{repository.fullName}{repository.isPrivate ? " (private)" : ""}</span>
                <form action={connectRepository} className="inline pl-3">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="connectionId" value={connectionId} />
                  <input type="hidden" name="repositoryId" value={repository.id} />
                  <button type="submit">Connect repository</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
