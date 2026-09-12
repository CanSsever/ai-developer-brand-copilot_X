import {
  parsePublicWebEnv,
  type PublicWebEnv,
} from "@developer-brand-copilot/config";

export function getPublicWebConfig(): PublicWebEnv {
  return parsePublicWebEnv({
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  });
}
