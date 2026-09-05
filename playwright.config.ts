import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3108);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("E2E_PORT must be a valid TCP port");
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  outputDir: ".playwright/test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: ".playwright/e2e-report", open: "never" }],
    ["junit", { outputFile: ".playwright/e2e-results.xml" }],
  ],
  use: {
    baseURL,
    trace: process.env.E2E_NAV_DIAGNOSTICS ? "retain-on-failure" : "on-first-retry",
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
    command: "node scripts/release-check.e2e-server.mjs",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    timeout: 120_000,
  },
});
