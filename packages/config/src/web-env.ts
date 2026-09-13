import { z } from "zod";

import { toEnvironmentValidationError } from "./environment-validation";

const publicHttpUrl = (fieldName: string) =>
  z
    .string()
    .url(`${fieldName} must be an absolute URL`)
    .refine(
      (value) => {
        try {
          const protocol = new URL(value).protocol;

          return protocol === "http:" || protocol === "https:";
        } catch {
          return false;
        }
      },
      `${fieldName} must use HTTP or HTTPS`
    );

const publicWebEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: publicHttpUrl("NEXT_PUBLIC_API_BASE_URL"),
  NEXT_PUBLIC_SITE_URL: publicHttpUrl("NEXT_PUBLIC_SITE_URL"),
  NEXT_PUBLIC_SUPABASE_URL: publicHttpUrl("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .trim()
    .min(
      20,
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a non-empty publishable key"
    ),
});

export type PublicWebEnv = z.output<typeof publicWebEnvSchema>;

export function parsePublicWebEnv(
  input: Record<string, unknown>
): PublicWebEnv {
  const result = publicWebEnvSchema.safeParse(input);

  if (!result.success) {
    throw toEnvironmentValidationError(result.error);
  }

  return result.data;
}
