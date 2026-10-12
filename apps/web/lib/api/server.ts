import { getPublicWebConfig } from "../public-config";
import { createClient } from "../supabase/server";

export class AuthenticatedApiError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super("Authenticated API request failed");
    this.name = "AuthenticatedApiError";
  }
}

export type AuthenticatedApiRequester = <T>(
  path: string,
  init?: RequestInit
) => Promise<T>;

async function requestWithAccessToken<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const config = getPublicWebConfig();
  const response = await fetch(new URL(path, config.NEXT_PUBLIC_API_BASE_URL), {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let code: string | undefined;
    try {
      const errorBody: unknown = await response.json();
      if (typeof errorBody === "object" && errorBody !== null && "code" in errorBody) {
        const value = (errorBody as { code?: unknown }).code;
        if (typeof value === "string" && /^[A-Z0-9_]{1,64}$/.test(value)) code = value;
      }
    } catch {
      // Error bodies are intentionally not forwarded; callers map only status and a safe code.
    }
    throw new AuthenticatedApiError(response.status, code);
  }

  return (await response.json()) as T;
}

export async function createAuthenticatedApiRequester(): Promise<AuthenticatedApiRequester> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (error || !accessToken) {
    throw new AuthenticatedApiError(401);
  }

  return <T>(path: string, init: RequestInit = {}) =>
    requestWithAccessToken<T>(accessToken, path, init);
}

export async function authenticatedApiRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const request = await createAuthenticatedApiRequester();
  return request<T>(path, init);
}
