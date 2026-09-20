import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const fixtureApiOrigin = "http://127.0.0.1:4101";

async function setFixtureState(
  request: APIRequestContext,
  state: "empty" | "project" | "installed" | "connected" | "error"
    | "connected-retryable"
    | "connected-sync-error"
) {
  const response = await request.post(`${fixtureApiOrigin}/__e2e/reset`, {
    data: { state },
  });
  expect(response.ok()).toBe(true);
}

async function authenticate(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  await expect(page.getByText("You are signed in.")).toBeVisible();
  await page.getByRole("link", { name: "Open dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await setFixtureState(request, "empty");
});

test("redirects an unauthenticated visitor away from the dashboard", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/?authError=authentication_required$/);
  await expect(page.getByText("You are signed out.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);
});

test("renders the authenticated dashboard and empty Project state", async ({ page }) => {
  await authenticate(page);

  await expect(page.getByText("Authenticated session active.")).toBeVisible();
  await expect(page.getByText("No Projects yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("creates a Project and shows it on the dashboard", async ({ page }) => {
  await authenticate(page);

  await page.getByLabel("Project timezone").fill("Europe/Berlin");
  await page.getByRole("button", { name: "Create Project" }).click();

  await expect(page.getByRole("status")).toHaveText("Project created successfully.");
  await expect(page.getByText("Timezone: Europe/Berlin")).toBeVisible();
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
});

test("shows an installed GitHub App awaiting repository selection", async ({
  page,
  request,
}) => {
  await setFixtureState(request, "installed");
  await authenticate(page);

  await expect(
    page.getByText("GitHub App installed; no repository is connected to this Project.")
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect repository" })).toBeVisible();
});

test("reaches the existing GitHub connection management flow", async ({
  page,
  request,
}) => {
  await setFixtureState(request, "project");
  await authenticate(page);

  await page.getByRole("link", { name: "Connect GitHub" }).click();
  await expect(page).toHaveURL(/\/github\/connect$/);
  await expect(page.getByRole("heading", { name: "GitHub App connection" })).toBeVisible();
  await expect(page.getByText("No GitHub App installation is connected.")).toBeVisible();
});

test("represents a connected private repository", async ({ page, request }) => {
  await setFixtureState(request, "connected");
  await authenticate(page);

  await expect(page.getByText("Repository connected")).toBeVisible();
  await expect(page.getByText("fixture-owner/fixture-repository")).toBeVisible();
  await expect(page.getByText("Default branch: main · Private")).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage connection" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sync GitHub activity" })
  ).toBeVisible();
  await expect(
    page.getByText("GitHub activity has not been synced yet.")
  ).toBeVisible();
});

test("manually syncs a connected repository and shows safe success status", async ({
  page,
  request,
}) => {
  await setFixtureState(request, "connected");
  await authenticate(page);

  await page.getByRole("button", { name: "Sync GitHub activity" }).click();

  await expect(page.getByRole("status")).toHaveText(
    "GitHub activity synchronization started."
  );
  await expect(page.getByText(/3 new commits imported/)).toBeVisible();
});

test("shows safe manual-sync and retry-after failure feedback", async ({
  page,
  request,
}) => {
  await setFixtureState(request, "connected-sync-error");
  await authenticate(page);
  await page.getByRole("button", { name: "Sync GitHub activity" }).click();

  await expect(
    page.getByText("GitHub is temporarily unavailable. Try again later.", {
      exact: true,
    })
  ).toBeVisible();

  await setFixtureState(request, "connected-retryable");
  await page.reload();
  await expect(page.getByText(/Retry after/)).toBeVisible();
  await expect(page.getByText(/GITHUB_RATE_LIMITED/)).toHaveCount(0);
});

test("shows a safe dashboard error when the API is unavailable", async ({
  page,
  request,
}) => {
  await setFixtureState(request, "error");
  await authenticate(page);

  await expect(
    page.getByText("Dashboard data could not be loaded. Try again later.", {
      exact: true,
    })
  ).toBeVisible();
});
