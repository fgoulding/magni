import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { registerViaApi } from "./helpers";

test("quick workout waits for its draft handlers before accepting a name, date or units", async ({ page }, info) => {
  await registerViaApi(page, "quick-start-hydration");
  let release!: () => void;
  const scripts = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_next/**", async (route) => {
    if (route.request().resourceType() === "script") await scripts;
    await route.continue();
  });
  await page.goto("/workouts/new?date=2026-09-01", { waitUntil: "commit" });
  try {
    await expect(page.getByLabel("Workout name", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Workout date", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Workout units")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Quick workout", exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByLabel("Workout name", { exact: true })).toBeEnabled();
  await page.getByLabel("Workout name", { exact: true }).fill("September pull");
  await page.getByLabel("Workout date", { exact: true }).fill("2026-09-02");
  await page.getByLabel("Workout units").selectOption("kg");
  if (info.project.name === "mobile-safari") {
    fs.mkdirSync(".playwright/production-goal", { recursive: true });
    await page.screenshot({ path: ".playwright/production-goal/quick-start-ready-iphone.png", fullPage: true, caret: "initial" });
  }
  const creating = page.waitForResponse((response) => response.url().endsWith("/api/sessions") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Quick workout", exact: true }).click();
  const response = await creating;
  expect(response.request().postDataJSON()).toMatchObject({ name: "September pull", date: "2026-09-02", unit: "kg" });
  expect(response.status()).toBe(201);
  const session = await response.json();
  await expect(page.getByRole("heading", { name: "September pull", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "September pull", exact: true })).toBeVisible();
  expect(await (await page.request.get(`/api/sessions/${session.id}`)).json()).toMatchObject({ name: "September pull", date: "2026-09-02", unit: "kg" });
});
