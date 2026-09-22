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

const githubCallbackUrl = z
  .string()
  .url("GITHUB_APP_CALLBACK_URL must be an absolute URL")
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          (url.hostname === "localhost" || url.hostname === "127.0.0.1"))) &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  }, "GITHUB_APP_CALLBACK_URL must use HTTPS (HTTP is allowed only for localhost)");

const githubPrivateKey = z
  .string()
  .min(1, "GITHUB_APP_PRIVATE_KEY is required")
  .transform((value) => value.replace(/\\n/g, "\n").trim())
  .refine(
    (value) =>
      /-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(value) &&
      /-----END (?:RSA )?PRIVATE KEY-----/.test(value),
    "GITHUB_APP_PRIVATE_KEY must be a PEM private key"
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
  SUPABASE_URL: supabaseUrl,
  SUPABASE_PUBLISHABLE_KEY: publishableKey,
  GITHUB_APP_CLIENT_ID: z.string().trim().min(1),
  GITHUB_APP_CLIENT_SECRET: z.string().trim().min(20),
  GITHUB_APP_SLUG: z
    .string()
    .trim()
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  GITHUB_APP_PRIVATE_KEY: githubPrivateKey,
  GITHUB_APP_CALLBACK_URL: githubCallbackUrl,
  OPENAI_API_KEY: z.string().trim().min(20),
  OPENAI_INTERPRETATION_MODEL: z.string().trim().min(1).max(100),
  OPENAI_DAILY_ATTEMPT_LIMIT: z.coerce.number().int().min(1).max(1_000).default(100),
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
