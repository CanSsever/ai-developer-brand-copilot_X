export type GitHubConnectionStatus =
  | "active"
  | "disconnected"
  | "authorization_error";

export interface ProjectSummary {
  readonly id: string;
  readonly timezone: string;
  readonly connectedRepository: ProjectConnectedRepositorySummary | null;
}

export interface ProjectConnectedRepositorySummary {
  readonly connectionId: string;
  readonly defaultBranch: string;
  readonly fullName: string;
  readonly isPrivate: boolean;
  readonly status: GitHubConnectionStatus;
}

export interface CreateProjectRequest {
  readonly timezone: string;
}

export interface GitHubConnectionStartRequest {
  readonly projectId: string;
}

export interface GitHubConnectionStartResponse {
  readonly installationUrl: string;
}

export interface GitHubConnectionCompleteRequest {
  readonly code: string;
  readonly installationId: string;
  readonly state: string;
}

export interface GitHubConnectionSummary {
  readonly id: string;
  readonly accountLogin: string;
  readonly accountType: string;
  readonly status: GitHubConnectionStatus;
}

export interface GitHubConnectionCompleteResponse {
  readonly connection: GitHubConnectionSummary;
  readonly projectId: string;
}

export interface AuthorizedRepositorySummary {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly isPrivate: boolean;
}

export interface ConnectRepositoryRequest {
  readonly connectionId: string;
  readonly projectId: string;
  readonly repositoryId: string;
}

export interface ConnectedRepositorySummary extends AuthorizedRepositorySummary {
  readonly connectionId: string;
  readonly projectId: string;
  readonly status: GitHubConnectionStatus;
}

export interface DisconnectConnectionResponse {
  readonly disconnected: true;
  readonly githubInstallationUnchanged: true;
}
