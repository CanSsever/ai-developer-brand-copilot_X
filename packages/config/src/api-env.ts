import { z } from "zod";

import { toEnvironmentValidationError } from "./environment-validation";

const postgresqlUrl = z
  .string()
  .url("must be a valid PostgreSQL connection URL")
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "postgres:" || protocol === "postgresql:";
      } catch {
        return false;
      }
    },
    "must use the postgres or postgresql protocol"
  );

const apiEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce
    .number()
    .int("PORT must be an integer")
    .min(1, "PORT must be at least 1")
    .max(65_535, "PORT must be at most 65535")
    .default(3001),
  DATABASE_URL: postgresqlUrl,
  DIRECT_URL: postgresqlUrl,
});

export type ApiEnv = z.output<typeof apiEnvSchema>;

export function parseApiEnv(input: Record<string, unknown>): ApiEnv {
  const result = apiEnvSchema.safeParse(input);

  if (!result.success) {
    throw toEnvironmentValidationError(result.error);
  }

  return result.data;
}
