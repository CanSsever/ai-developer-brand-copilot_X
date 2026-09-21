import { defineConfig, devices } from "@playwright/test";

const webOrigin = "http://localhost:3100";
const fixtureApiOrigin = "http://127.0.0.1:4101";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: webOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node e2e/fixture-server.mjs",
      url: `${fixtureApiOrigin}/__e2e/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "pnpm dev:e2e",
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_E2E: "1",
        NEXT_PUBLIC_API_BASE_URL: fixtureApiOrigin,
        NEXT_PUBLIC_SITE_URL: webOrigin,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:4100",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "e2e-fixture-e2e-fixture",
      },
    },
  ],
});
