import { describe, expect, it } from "vitest";

import { connectionErrorMessage, connectionStatusMessage } from "./feedback";

describe("GitHub connection feedback", () => {
  it("turns internal success statuses into readable feedback", () => {
    expect(connectionStatusMessage("project_created")).toBe(
      "Project created successfully."
    );
    expect(connectionStatusMessage("repository_connected")).toBe(
      "Repository connected successfully."
    );
  });

  it("turns internal errors into safe readable feedback", () => {
    expect(connectionErrorMessage("installation_verification_failed")).toBe(
      "The GitHub App installation could not be verified."
    );
  });

  it("does not echo unknown status or error values", () => {
    expect(connectionStatusMessage("provider-payload-value")).toBe(
      "The requested action completed."
    );
    expect(connectionErrorMessage("provider-payload-value")).toBe(
      "The requested action could not be completed."
    );
  });
});
