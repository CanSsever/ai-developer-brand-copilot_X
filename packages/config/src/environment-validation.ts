import type { ZodError } from "zod";

export interface EnvironmentValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class EnvironmentValidationError extends Error {
  readonly issues: readonly EnvironmentValidationIssue[];

  constructor(issues: readonly EnvironmentValidationIssue[]) {
    super(
      `Invalid environment configuration: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`
    );
    this.name = "EnvironmentValidationError";
    this.issues = issues;
  }
}

export function toEnvironmentValidationError(
  error: ZodError
): EnvironmentValidationError {
  return new EnvironmentValidationError(
    error.issues.map((issue) => ({
      path: issue.path.join(".") || "environment",
      message: issue.message,
    }))
  );
}
