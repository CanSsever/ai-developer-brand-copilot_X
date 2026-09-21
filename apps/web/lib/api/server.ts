import { getPublicWebConfig } from "../public-config";
import { createClient } from "../supabase/server";

export class AuthenticatedApiError extends Error {
  constructor(readonly status: number) {
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
    throw new AuthenticatedApiError(response.status);
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
