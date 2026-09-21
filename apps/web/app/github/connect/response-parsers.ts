import type {
  AuthorizedRepositorySummary,
  GitHubConnectionSummary,
  ProjectSummary,
} from "@developer-brand-copilot/contracts";

export type ConnectionProjectSummary = Pick<ProjectSummary, "id" | "timezone">;

const connectionStatuses = new Set(["active", "disconnected", "authorization_error"]);

export class ResponseValidationError extends Error {
  constructor(
    readonly parser: string,
    readonly path: string,
    readonly expected: string,
    readonly actual: string
  ) {
    super("Invalid API response");
    this.name = "ResponseValidationError";
  }
}

function category(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredText(value: unknown, parser: string, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ResponseValidationError(parser, path, "non-empty string", category(value));
  }
  return value;
}

export function parseConnectionProjects(
  value: unknown
): readonly ConnectionProjectSummary[] {
  const parser = "projects";
  if (!Array.isArray(value)) {
    throw new ResponseValidationError(parser, "$", "array", category(value));
  }
  return value.map((project, index) => {
    if (!isRecord(project)) {
      throw new ResponseValidationError(
        parser,
        `$[${index}]`,
        "object",
        category(project)
      );
    }
    return {
      id: requiredText(project.id, parser, `$[${index}].id`),
      timezone: requiredText(project.timezone, parser, `$[${index}].timezone`),
    };
  });
}

export function parseGitHubConnections(
  value: unknown
): readonly GitHubConnectionSummary[] {
  const parser = "connections";
  if (!Array.isArray(value)) {
    throw new ResponseValidationError(parser, "$", "array", category(value));
  }
  return value.map((connection, index) => {
    if (
      !isRecord(connection) ||
      typeof connection.status !== "string" ||
      !connectionStatuses.has(connection.status)
    ) {
      const path = isRecord(connection) ? `$[${index}].status` : `$[${index}]`;
      const actual = isRecord(connection)
        ? category(connection.status)
        : category(connection);
      throw new ResponseValidationError(
        parser,
        path,
        isRecord(connection) ? "connection status" : "object",
        actual
      );
    }
    return {
      id: requiredText(connection.id, parser, `$[${index}].id`),
      accountLogin: requiredText(
        connection.accountLogin,
        parser,
        `$[${index}].accountLogin`
      ),
      accountType: requiredText(
        connection.accountType,
        parser,
        `$[${index}].accountType`
      ),
      status: connection.status as GitHubConnectionSummary["status"],
    };
  });
}

export function parseAuthorizedRepositories(
  value: unknown
): readonly AuthorizedRepositorySummary[] {
  const parser = "repositories";
  if (!Array.isArray(value)) {
    throw new ResponseValidationError(parser, "$", "array", category(value));
  }
  return value.map((repository, index) => {
    if (!isRecord(repository) || typeof repository.isPrivate !== "boolean") {
      const path = isRecord(repository) ? `$[${index}].isPrivate` : `$[${index}]`;
      const actual = isRecord(repository)
        ? category(repository.isPrivate)
        : category(repository);
      throw new ResponseValidationError(
        parser,
        path,
        isRecord(repository) ? "boolean" : "object",
        actual
      );
    }
    return {
      id: requiredText(repository.id, parser, `$[${index}].id`),
      owner: requiredText(repository.owner, parser, `$[${index}].owner`),
      name: requiredText(repository.name, parser, `$[${index}].name`),
      fullName: requiredText(
        repository.fullName,
        parser,
        `$[${index}].fullName`
      ),
      defaultBranch: requiredText(
        repository.defaultBranch,
        parser,
        `$[${index}].defaultBranch`
      ),
      isPrivate: repository.isPrivate,
    };
  });
}
