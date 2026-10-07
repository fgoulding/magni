import { randomUUID } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { registerViaApi } from "./helpers";

async function completedWorkout(page: Page, name: string, date: string, names: string[], weight = 20) {
  const created = await page.request.post("/api/sessions", { data: { name, date, unit: "kg", newWorkout: true, requestKey: randomUUID() } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  for (const exercise of names) {
    const added = await page.request.post(`/api/sessions/${id}/sets`, { data: { name: exercise, sets: 1, reps: 10, weight, requestKey: randomUUID() } });
    expect(added.status()).toBe(201);
    const { sets } = await added.json();
    expect((await page.request.put(`/api/sessions/${id}/sets`, { data: { setId: sets[0].id, actualReps: 10, actualWeight: weight } })).ok()).toBe(true);
  }
  expect((await page.request.patch(`/api/sessions/${id}`)).ok()).toBe(true);
  return id as number;
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: "disabled", caret: "initial" });
}

test("Progress stays bounded while finder pages replace and old names are directly searchable", async ({ page }, info) => {
  test.setTimeout(120_000);
  await registerViaApi(page, "progress-bounded");
  // Stay inside the recent window on both UTC CI and a local server around midnight.
  const recentDate = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  await completedWorkout(page, "Large recorded workout", recentDate, Array.from({ length: 22 }, (_, index) => `Exercise ${String(index + 1).padStart(3, "0")}`));
  await completedWorkout(page, "Old mobility", "2020-01-02", ["Old exercise 0999 — forearm rotation with a long distinguishing equipment description"]);
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Progress", exact: true })).toBeVisible();
  await expect(page.getByTestId("progress-exercise-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Choose exercise", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Choose exercise" }).getByTestId("exercise-choice")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Choose exercise", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Choose exercise", exact: true }).click();
  await page.getByRole("dialog", { name: "Choose exercise" }).getByRole("searchbox", { name: "Search exercises" }).fill("0999");
  await expect(page.getByTestId("exercise-choice")).toHaveCount(1);
  await expect(page.getByTestId("exercise-choice")).toContainText("Old exercise 0999");
  await screenshot(page, info, "old-exercise-chooser");
  await page.getByTestId("exercise-choice").click();
  await expect(page).toHaveURL(/exercise=u%3A.*period=12w/);
  await expect(page.getByRole("button", { name: "Choose exercise", exact: true })).toContainText("Old exercise 0999");
  await expect(page.getByRole("button", { name: "Choose exercise", exact: true })).toBeFocused();
  await expect(page.getByRole("region", { name: "Exercise chart" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Period" }).selectOption("all");
  await expect(page.getByRole("list", { name: "Recent exercise workouts" }).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Choose exercise", exact: true }).click();
  await page.getByRole("link", { name: "Browse all exercises" }).click();
  await expect(page.getByTestId("progress-exercise-row")).toHaveCount(0);
  await page.getByRole("link", { name: "Browse A–Z" }).click();
  await expect(page.getByTestId("progress-exercise-row")).toHaveCount(20);
  await page.getByRole("link", { name: "Next", exact: true }).first().click();
  await expect(page.getByTestId("progress-exercise-row")).toHaveCount(3);
  const secondPage = page.url();
  expect(secondPage.length).toBeLessThan(1000);
  expect(new URL(secondPage).searchParams.has("trail")).toBe(false);
  await page.getByTestId("progress-exercise-row").first().getByRole("link").click();
  await page.getByRole("link", { name: "Back to results" }).click();
  await expect(page).toHaveURL(secondPage);
  await expect(page.getByTestId("progress-exercise-row")).toHaveCount(3);
  await page.getByRole("link", { name: "Previous", exact: true }).first().click();
  await expect(page.getByTestId("progress-exercise-row")).toHaveCount(20);
  expect(new URL(page.url()).searchParams.get("browse")).toBe("az");
  expect(new URL(page.url()).searchParams.has("trail")).toBe(false);
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("0999");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("progress-exercise-row")).toHaveCount(1);
  await expect(page.getByText(/Old exercise 0999/)).toBeVisible();
  await screenshot(page, info, "old-exercise-search");
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("no-matching-exercise");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("No matches for “no-matching-exercise” in this scope.")).toBeVisible();
  await screenshot(page, info, "no-matches");
  await page.goto("/history?lift=Exercise%20001");
  await expect(page).toHaveURL(/\/history\/exercises\?q=Exercise%20001/);
  await expect(page.getByTestId("progress-exercise-row")).toHaveCount(1);
});

test("explicit selected workouts connect, survive a lost save, pin, and separate without changing actuals", async ({ page }, info) => {
  test.setTimeout(120_000);
  await registerViaApi(page, "progress-linking");
  const name = "Band row with a long distinguishing shoulder-friendly pause and neutral grip";
  const firstDate = new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 10);
  const secondDate = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const first = await completedWorkout(page, "First row workout", firstDate, [name], 0);
  const second = await completedWorkout(page, "Second row workout", secondDate, [name], 0);
  const before = await Promise.all([first, second].map(async id => (await page.request.get(`/api/sessions/${id}`)).json()));
  await page.goto(`/history/exercises?q=${encodeURIComponent(name)}`);
  await expect(page.getByTestId("progress-exercise-row")).toHaveCount(1);
  await page.getByTestId("progress-exercise-row").getByRole("link").click();
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.getByRole("link", { name: "Follow as one exercise" }).click();
  await expect(page.getByRole("button", { name: "Review selected workouts" })).toBeDisabled();
  await page.getByRole("button", { name: "Select these 2 records" }).click();
  await page.getByLabel("Exercise label", { exact: true }).fill("Band row — deliberate comparison");
  await page.getByRole("button", { name: "Review selected workouts" }).click();
  await expect(page.getByText(/Connect 2 recorded exercises from 2 workouts/)).toBeVisible();
  await screenshot(page, info, "review-selected");
  let finishInterception!: () => void;
  const interceptionDone = new Promise<void>(resolve => { finishInterception = resolve; });
  let intercepted = false;
  await page.route("**/api/progress/identity", async route => {
    if (!intercepted && route.request().method() === "POST" && route.request().postDataJSON().action === "apply") {
      intercepted = true;
      try { expect((await route.fetch()).ok()).toBe(true); await route.abort("failed"); }
      finally { finishInterception(); }
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Connect selected workouts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry saving grouping" })).toBeVisible();
  await interceptionDone;
  await page.unroute("**/api/progress/identity");
  await page.reload();
  await page.getByRole("button", { name: "Retry saving grouping" }).click();
  await expect(page.getByRole("button", { name: "Undo grouping change" })).toBeVisible();
  await page.getByRole("link", { name: "View exercise", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Band row — deliberate comparison", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Chart metric" })).toHaveValue("reps");
  await expect(page.getByText("10 reps · 0 kg", { exact: true })).toHaveCount(2);
  await page.getByText("Dated chart values", { exact: true }).click();
  await expect(page.getByRole("table", { name: "Recorded reps by workout" })).toBeVisible();
  await screenshot(page, info, "linked-detail");
  await page.getByRole("button", { name: "Pin exercise", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unpin exercise", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Edit included workouts" }).click();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Review selected workouts" }).click();
  await page.getByRole("button", { name: "Keep selected records separate" }).click();
  await expect(page.getByRole("heading", { name: "Selected records kept separate" })).toBeVisible();
  await page.getByRole("button", { name: "Undo grouping change" }).click();
  await expect(page.getByRole("heading", { name: "Grouping change undone" })).toBeVisible();
  const after = await Promise.all([first, second].map(async id => (await page.request.get(`/api/sessions/${id}`)).json()));
  expect(after).toEqual(before);
  await page.goto("/history");
  await expect(page.getByRole("region", { name: "Exercise chart" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Favorite exercises" }).getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Recent exercise workouts" }).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("combobox", { name: "Period" }).focus();
  await page.getByRole("combobox", { name: "Period" }).selectOption("all");
  await expect(page).toHaveURL(/exercise=e%3A.*period=all/);
  await expect(page.getByRole("combobox", { name: "Period" })).toBeFocused();
  await page.getByRole("combobox", { name: "Chart metric" }).focus();
  await page.getByRole("combobox", { name: "Chart metric" }).selectOption("load:kg");
  await expect(page.getByRole("region", { name: "Exercise chart" })).toContainText("Heaviest completed set in each workout.");
  await expect(page).toHaveURL(/metric=load%3Akg/);
  await expect(page.getByRole("combobox", { name: "Chart metric" })).toBeFocused();
  await screenshot(page, info, "pinned-overview");
  const graphHref = page.url();
  await page.getByRole("list", { name: "Recent exercise workouts" }).getByRole("link").first().click();
  await page.getByRole("link", { name: "← Back to Progress", exact: true }).click();
  await expect(page).toHaveURL(graphHref);
  await expect(page.getByRole("combobox", { name: "Period" })).toHaveValue("all");
  await expect(page.getByRole("combobox", { name: "Chart metric" })).toHaveValue("load:kg");
  await expect(page.getByRole("region", { name: "Exercise chart" })).toBeVisible();
});
