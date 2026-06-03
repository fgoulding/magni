import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  outputDir: ".playwright/test-results",
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 15"] },
    },
  ],
  webServer: {
    command: `mkdir -p .playwright && rm -f .playwright/e2e.sqlite .playwright/e2e.sqlite-* && DB_PATH=.playwright/e2e.sqlite /opt/homebrew/bin/npm run dev -- --webpack --hostname localhost --port ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
