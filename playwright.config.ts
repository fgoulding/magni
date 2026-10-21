import { defineConfig, devices } from "@playwright/test";
import { warmupProfile } from "./scripts/release-check.profile.mjs";

const PORT = Number(process.env.E2E_PORT ?? 3108);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("E2E_PORT must be a valid TCP port");
const baseURL = `http://localhost:${PORT}`;
const profile = warmupProfile();

export default defineConfig({
  metadata: { warmupProfile: profile.name },
  testDir: "./tests/e2e",
  globalSetup: "./scripts/release-check.e2e-warmup.mjs",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  outputDir: `${profile.outputDirectory}/test-results`,
  reporter: [
    ["list"],
    ["html", { outputFolder: `${profile.outputDirectory}/e2e-report`, open: "never" }],
    ["junit", { outputFile: `${profile.outputDirectory}/e2e-results.xml` }],
    ["json", { outputFile: `${profile.outputDirectory}/e2e-results.json` }],
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
