const statusMessages: Readonly<Record<string, string>> = {
  installation_connected:
    "GitHub App connected. Choose an authorized repository for your Project.",
  locally_disconnected: "The GitHub App connection was removed locally.",
  project_created: "Project created successfully.",
  repository_connected: "Repository connected successfully.",
  sync_started: "GitHub activity synchronization started.",
};

const errorMessages: Readonly<Record<string, string>> = {
  disconnect_failed: "The GitHub App connection could not be removed.",
  installation_start_failed: "The GitHub App connection could not be started.",
  installation_verification_failed:
    "The GitHub App installation could not be verified.",
  invalid_callback: "The GitHub App callback was incomplete or invalid.",
  project_creation_failed: "The Project could not be created.",
  repository_connection_failed: "The repository could not be connected.",
  sync_access_attention:
    "GitHub access needs attention. Review the repository connection.",
  sync_failed: "GitHub activity synchronization could not be started.",
  sync_in_progress: "GitHub activity synchronization is already in progress.",
  sync_rate_limited:
    "GitHub activity was synced recently. Try again in a moment.",
  sync_temporarily_unavailable:
    "GitHub is temporarily unavailable. Try again later.",
  sync_unavailable:
    "The connected repository is unavailable or you do not have access.",
};

export function connectionStatusMessage(value: string | undefined): string | null {
  return value ? (statusMessages[value] ?? "The requested action completed.") : null;
}

export function connectionErrorMessage(value: string | undefined): string | null {
  return value ? (errorMessages[value] ?? "The requested action could not be completed.") : null;
}
