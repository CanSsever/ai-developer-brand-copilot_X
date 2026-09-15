export type ApplicationUserSyncStage =
  | "RLS_SYNC_USER_A"
  | "RLS_SYNC_USER_B";

export type ApplicationUserSyncFailure =
  | "http-status"
  | "identity-mismatch"
  | "network"
  | "response-validation";

export class ApplicationUserSyncError extends Error {
  constructor(readonly reason: ApplicationUserSyncFailure) {
    super("Application User synchronization failed");
    this.name = "ApplicationUserSyncError";
  }
}

interface ApplicationUserSyncOptions {
  readonly apiBaseUrl: string;
  readonly expectedSubject: string;
  readonly fetcher?: typeof fetch;
  readonly report?: (result: string) => void;
  readonly stage: ApplicationUserSyncStage;
  readonly token: string;
}

function defaultReport(result: string): void {
  console.error(result);
}

export function resolveLocalApiBaseUrl(port: number): string {
  return "http://127.0.0.1:" + port;
}

export async function synchronizeApplicationUser({
  apiBaseUrl,
  expectedSubject,
  fetcher = fetch,
  report = defaultReport,
  stage,
  token,
}: ApplicationUserSyncOptions): Promise<void> {
  let response: Response;

  try {
    response = await fetcher(apiBaseUrl + "/auth/me", {
      headers: {
        Authorization: "Bearer " + token,
      },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    report(stage + "_NETWORK=failed");
    throw new ApplicationUserSyncError("network");
  }

  report(stage + "_API_STATUS=" + response.status);

  if (response.status !== 200) {
    throw new ApplicationUserSyncError("http-status");
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    report(stage + "_RESPONSE_VALIDATION=failed");
    throw new ApplicationUserSyncError("response-validation");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("id" in body) ||
    typeof body.id !== "string"
  ) {
    report(stage + "_RESPONSE_VALIDATION=failed");
    throw new ApplicationUserSyncError("response-validation");
  }

  if (body.id !== expectedSubject) {
    report(stage + "_IDENTITY_MISMATCH=failed");
    throw new ApplicationUserSyncError("identity-mismatch");
  }
}
