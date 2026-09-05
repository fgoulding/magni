import { expect, test, type Page } from "@playwright/test";
import { registerViaApi } from "./helpers";

async function nextScheduledWorkout(page: Page) {
  if (await page.getByRole("dialog").count()) {
    await page.getByRole("link", { name: "Close workout", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.getByRole("navigation").getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.locator('[aria-label="Weekly workout agenda"]')).toBeVisible();
  const next = page.getByRole("link", { name: /^Scheduled: Recovery double progression/ }).first();
  if (await next.count() === 0) {
    const week = page.getByRole("link", { name: "Next week", exact: true });
    const href = await week.getAttribute("href");
    await week.click();
    await expect(page).toHaveURL(url => `${url.pathname}${url.search}` === href);
  }
  await expect(next).toBeVisible();
  const href = await next.getAttribute("href");
  await next.click();
  await expect(page).toHaveURL(url => `${url.pathname}${url.search}` === href);
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function saveSet(page: Page, number: number, reps: string) {
  await page.getByRole("spinbutton", { name: `Dumbbell row set ${number} reps`, exact: true }).fill(reps);
  await page.getByRole("button", { name: `Save set ${number}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Save set ${number}`, exact: true })).toHaveAttribute("aria-pressed", "true");
}

test("custom set drafts recover and double progression advances once from real UI logging", async ({ page, context }, info) => {
  test.setTimeout(120_000);
  await registerViaApi(page, "planned-recovery");
  await page.goto("/programs/editor/new");
  await page.getByLabel("Program name", { exact: true }).fill("Recovery double progression");
  await page.getByLabel("Repeat cycles", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Prescriptions", exact: true }).click();
  await page.getByRole("button", { name: "Add exercise", exact: true }).click();
  await page.getByLabel("Exercise name", { exact: true }).fill("Dumbbell row");
  await expect(page.getByLabel("Working load (lb)", { exact: true })).toHaveValue("40");
  await page.getByRole("button", { name: "Progression & preview", exact: true }).click();
  await page.getByRole("combobox", { name: "Progression condition", exact: true }).selectOption("double_progression");
  await page.getByRole("button", { name: "Review & activate", exact: true }).click();
  for (const day of ["Sun", "Tue", "Thu", "Sat"]) await page.getByRole("button", { name: day, exact: true }).click();
  await page.getByRole("button", { name: "Activate program", exact: true }).click();
  await expect(page.getByText("Program activated", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Train this program", exact: true }).click();
  const start = page.waitForResponse(response => /\/api\/programs\/\d+\/sessions$/.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Start Workout", exact: true }).click();
  const first = await (await start).json();
  expect(first.sets.map((set: { calculated_weight: number }) => set.calculated_weight)).toEqual([40, 40, 40]);
  await expect(page.getByRole("spinbutton", { name: "Dumbbell row set 1 reps", exact: true })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("spinbutton", { name: "Dumbbell row set 1 reps", exact: true }).fill("11");
  await page.getByRole("button", { name: "Save set 1", exact: true }).click();
  await expect(page.getByText("Save failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish Workout", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("planned-offline-light-iphone.png"), fullPage: true });
  await page.getByRole("spinbutton", { name: "Dumbbell row set 1 reps", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("planned-offline-light-viewport.png") });
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Dumbbell row set 1 reps", exact: true })).toHaveValue("11");
  await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("navigation").getByRole("link", { name: "Today", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Dumbbell row set 1 reps", exact: true })).toHaveValue("11");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: info.outputPath("planned-recovered-dark-iphone.png"), fullPage: true });
  await page.getByRole("spinbutton", { name: "Dumbbell row set 1 reps", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("planned-recovered-dark-viewport.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await saveSet(page, 1, "12");
  await saveSet(page, 2, "12");
  await saveSet(page, 3, "11");
  const hold = page.waitForResponse(response => response.url().endsWith("/complete-and-advance"));
  await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
  const held = await (await hold).json();
  expect(held.progressionDecisions[0].result.outcome).toBe("hold");
  expect(held.progressionDecisions[0].afterState.load).toBe(40);
  await expect(page.getByText(held.progressionDecisions[0].result.explanation, { exact: true })).toBeVisible();
  await nextScheduledWorkout(page);
  await expect(page.getByRole("dialog")).toContainText("40 lb");
  const secondStart = page.waitForResponse(response => /\/api\/programs\/\d+\/sessions$/.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: "Do workout", exact: true }).click();
  const second = await (await secondStart).json();
  expect(second.sets.map((set: { calculated_weight: number }) => set.calculated_weight)).toEqual([40, 40, 40]);
  for (const number of [1, 2, 3]) await saveSet(page, number, "12");

  // Lose the response after the real server commits. The user's retry must return
  // the original event without advancing the state a second time.
  let committed: { progressionDecisions: Array<{ beforeState: { load: number }; afterState: { load: number } }> } | undefined;
  await page.route("**/complete-and-advance", async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    committed = await response.json();
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Response lost. Retry finishing." }) });
  });
  await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Response lost");
  expect(committed?.progressionDecisions[0].afterState.load).toBe(42.5);
  await page.unroute("**/complete-and-advance");
  const retry = page.waitForResponse(response => response.url().endsWith("/complete-and-advance"));
  await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
  const retried = await (await retry).json();
  expect(retried.progressionDecisions).toEqual(committed?.progressionDecisions);
  await nextScheduledWorkout(page);
  await expect(page.getByRole("dialog")).toContainText("42.5 lb");
  await page.screenshot({ path: info.outputPath("planned-next-load-dark-iphone.png"), fullPage: true });
});
