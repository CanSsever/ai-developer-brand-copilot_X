import { z } from "zod";

import { toEnvironmentValidationError } from "./environment-validation";

const publicWebEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z
    .string()
    .url("NEXT_PUBLIC_API_BASE_URL must be an absolute URL")
    .refine(
      (value) => {
        try {
          const protocol = new URL(value).protocol;

          return protocol === "http:" || protocol === "https:";
        } catch {
          return false;
        }
      },
      "NEXT_PUBLIC_API_BASE_URL must use HTTP or HTTPS"
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
