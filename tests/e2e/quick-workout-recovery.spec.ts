import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { registerViaApi } from "./helpers";

test("quick workout preserves pending edits, recovers failed writes, and counts only performed sets", async ({ page }, testInfo) => {
  await registerViaApi(page, "quick-recovery");
  await page.goto("/today");
  await page.getByRole("button", { name: "Quick workout", exact: true }).click();
  await page.getByRole("button", { name: "Add exercise", exact: true }).click();
  await page.getByRole("textbox", { name: "New exercise name" }).fill("Dumbbell Row");
  await page.getByRole("spinbutton", { name: "Weight", exact: true }).fill("40");
  await page.getByRole("button", { name: "Add to workout" }).click();
  await page.getByRole("button", { name: "Log set 1", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("spinbutton", { name: "Reps for set 1" }).fill("7");
  await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish workout", exact: true })).toBeDisabled();
  await page.getByRole("navigation").getByRole("link", { name: "Programs" }).click();
  await page.getByRole("navigation").getByRole("link", { name: "Today" }).click();
  await expect(page.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue("7");
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue("7");
  await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();

  const screenshot = async (name: string) => {
    if (testInfo.project.name !== "mobile-safari") return;
    fs.mkdirSync(".playwright/production-goal", { recursive: true });
    await page.screenshot({ path: `.playwright/production-goal/logging-${name}-iphone.png`, fullPage: true, animations: "disabled", caret: "initial" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  };
  await screenshot("unsaved");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("navigation").getByRole("link", { name: "Today" }).click();
  await expect(page.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue("7");
  await screenshot("unsaved-dark");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByRole("navigation").getByRole("link", { name: "Today" }).click();
  await page.route("**/api/sessions/*/sets", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary connection failure" }) });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Save set 1", exact: true }).click();
  await expect(page.getByText("Save failed", { exact: true })).toBeVisible();
  await expect(page.locator("section").getByRole("alert")).toHaveText("Temporary connection failure");
  await screenshot("failed");
  await page.unroute("**/api/sessions/*/sets");
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Reps for set 1" })).toHaveValue("7");
  await page.getByRole("spinbutton", { name: "Reps for set 1" }).fill("10");
  await page.getByRole("button", { name: "Save set 1", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText("Not logged", { exact: true })).toHaveCount(2);
  await screenshot("saved");

  // Commit the real completion but lose its response, then retry through the UI.
  await page.route(/\/api\/sessions\/\d+$/, async (route) => {
    if (route.request().method() === "PATCH") {
      const completed = await route.fetch();
      expect(completed.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Finish workout", exact: true }).click();
  await expect(page.locator("section").getByRole("alert")).toBeVisible();
  await page.unroute(/\/api\/sessions\/\d+$/);
  await page.getByRole("button", { name: "Finish workout", exact: true }).click();
  await expect(page.getByText("Quick workout complete", { exact: true })).toBeVisible();
  await expect(page.getByText(/400 lb total/)).toBeVisible();
  await screenshot("recap");
  await page.getByRole("navigation").getByRole("link", { name: "Stats" }).click();
  await expect(page.getByRole("heading", { name: "Statistics" })).toBeVisible();
  await expect(page.getByText("400", { exact: true }).first()).toBeVisible();
  await screenshot("stats");
  const history = await page.request.get("/api/sessions");
  expect(history.status()).toBe(200);
  const sessions = await history.json();
  expect(sessions).toHaveLength(1);
  expect(sessions[0].status).toBe("completed");
});
