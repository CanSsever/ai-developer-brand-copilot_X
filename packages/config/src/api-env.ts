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

const supabaseUrl = z
  .string()
  .url("SUPABASE_URL must be an absolute URL")
  .refine(
    (value) => {
      const url = new URL(value);

      return (
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            (url.hostname === "localhost" || url.hostname === "127.0.0.1"))) &&
        url.username === "" &&
        url.password === "" &&
        (url.pathname === "/" || url.pathname === "") &&
        url.search === "" &&
        url.hash === ""
      );
    },
    "SUPABASE_URL must be an HTTPS origin (HTTP is allowed only for localhost)"
  );

const publishableKey = z
  .string()
  .trim()
  .min(20, "SUPABASE_PUBLISHABLE_KEY must be a non-empty publishable key");

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
  SUPABASE_URL: supabaseUrl,
  SUPABASE_PUBLISHABLE_KEY: publishableKey,
});

const databaseEnvSchema = apiEnvSchema.pick({
  DATABASE_URL: true,
  DIRECT_URL: true,
});

export type ApiEnv = z.output<typeof apiEnvSchema>;
export type DatabaseEnv = z.output<typeof databaseEnvSchema>;

export function parseApiEnv(input: Record<string, unknown>): ApiEnv {
  const result = apiEnvSchema.safeParse(input);

  if (!result.success) {
    throw toEnvironmentValidationError(result.error);
  }

  return result.data;
}

export function parseDatabaseEnv(input: Record<string, unknown>): DatabaseEnv {
  const result = databaseEnvSchema.safeParse(input);

  if (!result.success) {
    throw toEnvironmentValidationError(result.error);
  }

  return result.data;
}
