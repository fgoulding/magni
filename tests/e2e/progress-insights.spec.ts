import { randomUUID } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { registerViaApi } from "./helpers";

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

async function record(page: Page, { date, weight, reps = 5, name = "Deadlift", unit = "lb" }: { date: string; weight: number | null; reps?: number; name?: string; unit?: "lb" | "kg" }) {
  const created = await page.request.post("/api/sessions", { data: { name: "Strength and accessory training", date, unit, newWorkout: true, requestKey: randomUUID() } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const added = await page.request.post(`/api/sessions/${id}/sets`, { data: { name, sets: 1, reps: Math.max(1, reps), weight: weight ?? 0, requestKey: randomUUID() } });
  expect(added.status()).toBe(201);
  const { sets } = await added.json();
  expect((await page.request.put(`/api/sessions/${id}/sets`, { data: { setId: sets[0].id, actualReps: reps, actualWeight: weight } })).ok()).toBe(true);
  expect((await page.request.patch(`/api/sessions/${id}`)).ok()).toBe(true);
  return id as number;
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "The page must reflow without horizontal scroll").toBe(true);
  const heading = page.getByRole("heading", { name: "Progress", exact: true });
  const history = page.getByRole("link", { name: "History", exact: true });
  if (await heading.isVisible() && await history.isVisible()) {
    const titleBox = (await heading.boundingBox())!, historyBox = (await history.boundingBox())!;
    expect(titleBox.x + titleBox.width <= historyBox.x + 1 || titleBox.y + titleBox.height <= historyBox.y + 1, "Progress and History must not overlap").toBe(true);
    expect(await history.evaluate(link => link.scrollWidth <= link.clientWidth), "History text must fit inside its button").toBe(true);
  }
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
  await page.screenshot({ path: info.outputPath(`${name}-viewport.png`), animations: "disabled" });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 659 });
  await page.addInitScript(() => localStorage.setItem("install-help-dismissed", "1"));
});

test("strength summaries, same-day inspection and activity agree with saved workouts", async ({ page }, info) => {
  test.setTimeout(90_000);
  await registerViaApi(page, "progress-insights");
  const sessions = [
    await record(page, { date: daysAgo(150), weight: 245 }),
    await record(page, { date: daysAgo(14), weight: 205 }),
    await record(page, { date: daysAgo(7), weight: 215 }),
    await record(page, { date: daysAgo(7), weight: 225 }),
  ];
  await page.goto("/history?view=exercise&period=all&metric=load%3Alb");
  const summary = page.getByRole("region", { name: "Performance summary", exact: true });
  await expect(summary).toContainText("225");
  await expect(summary).toContainText("+10");
  await expect(summary).toContainText("245");
  const training = page.getByRole("region", { name: "Training in this range", exact: true });
  await expect(training).toContainText("4,450");
  await expect(training).toContainText("3 active weeks");

  const selected = page.getByRole("region", { name: "Selected workout", exact: true });
  await expect(selected.getByRole("link", { name: "View workout", exact: true })).toHaveAttribute("href", new RegExp(`/workouts/${sessions[3]}\\?`));
  const previous = page.getByRole("button", { name: "Previous workout", exact: true });
  await previous.click();
  await expect(selected).toContainText("215");
  await expect(selected.getByRole("link", { name: "View workout", exact: true })).toHaveAttribute("href", new RegExp(`/workouts/${sessions[2]}\\?`));
  // A second workout on the same date remains separately accessible.
  await previous.focus();
  await page.keyboard.press("Enter");
  await expect(selected).toContainText("205");
  await expect(summary).toContainText("225");
  const evidenceHref = await selected.getByRole("link", { name: "View workout", exact: true }).getAttribute("href");
  const returnHref = new URL(evidenceHref!, page.url()).searchParams.get("returnTo")!;
  await selected.getByRole("link", { name: "View workout", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/workouts/${sessions[1]}\\?`));
  await page.getByRole("link", { name: "← Back to Progress", exact: true }).click();
  await expect(page).toHaveURL(new URL(returnHref, page.url()).href);
  await expect(page.getByRole("combobox", { name: "Chart metric", exact: true })).toHaveValue("load:lb");
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("4w");
  await expect(summary).toContainText("225");
  await expect(summary).not.toContainText("245");
  await expect(training).toContainText("3,225");
  await expect(training).toContainText("2 active weeks");
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("all");
  await expect(summary).toContainText("245");

  for (const [name, width, height, fontSize, theme] of [
    ["mini-light", 375, 629, 16, "light"],
    ["iphone16-dark", 393, 659, 16, "dark"],
    ["mini-large", 375, 629, 20, "dark"],
    ["iphone16-double-text", 393, 659, 32, "light"],
    ["mini-pwa", 375, 812, 16, "dark"],
    ["iphone16-pwa", 393, 852, 16, "light"],
    ["desktop", 1440, 1000, 16, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ fontSize, theme }) => { document.documentElement.style.fontSize = `${fontSize}px`; document.documentElement.dataset.theme = theme; window.scrollTo(0, 0); }, { fontSize, theme });
    await capture(page, info, `progress-${name}`);
  }
});

test("single zero-load result and enlarged exercise chooser remain usable", async ({ page }, info) => {
  test.setTimeout(60_000);
  await registerViaApi(page, "progress-single");
  await record(page, { date: daysAgo(1), weight: 0, reps: 12, name: "Single leg standing calf raise", unit: "kg" });
  const found = await (await page.request.get("/api/progress/exercises?q=calf")).json();
  const key = found.items[0].key;
  await page.goto(`/history?exercise=${encodeURIComponent(key)}&period=all&metric=load%3Akg`);
  const summary = page.getByRole("region", { name: "Performance summary", exact: true });
  await expect(summary).toContainText("0");
  await expect(summary).not.toContainText("NaN");
  await expect(summary).not.toContainText("Infinity");
  await expect(page.getByRole("button", { name: "Previous workout", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next workout", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 375, height: 629 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; document.documentElement.dataset.theme = "dark"; });
  const trigger = page.getByRole("button", { name: "Choose exercise", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Choose exercise", exact: true });
  await expect(dialog.getByRole("heading", { name: "Exercises", exact: true })).toBeVisible();
  await expect(dialog.getByRole("searchbox")).not.toBeFocused();
  const titleBox = (await dialog.getByRole("heading", { name: "Exercises", exact: true }).boundingBox())!;
  const close = dialog.getByRole("button", { name: "Close exercise chooser", exact: true });
  const closeBox = (await close.boundingBox())!;
  expect(titleBox.x + titleBox.width <= closeBox.x + 1 || titleBox.y + titleBox.height <= closeBox.y + 1 || closeBox.y + closeBox.height <= titleBox.y + 1, "Exercise chooser heading must not overlap Close").toBe(true);
  expect(closeBox.width).toBeGreaterThanOrEqual(44);
  expect(closeBox.height).toBeGreaterThanOrEqual(44);
  await capture(page, info, "chooser-mini-double-text");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await capture(page, info, "single-zero-load-mini-double-text");
});

test("original-unit summaries ignore missing loads and failed attempts, then reflect a workout correction", async ({ page }, info) => {
  test.setTimeout(90_000);
  await registerViaApi(page, "progress-units");
  await record(page, { date: daysAgo(14), weight: 225 });
  const kgWorkout = await record(page, { date: daysAgo(7), weight: 100, unit: "kg" });
  await record(page, { date: daysAgo(3), weight: null });
  await record(page, { date: daysAgo(1), weight: 300, reps: 0 });
  await page.goto("/history?view=exercise&period=all&metric=load%3Alb");
  const summary = page.getByRole("region", { name: "Performance summary", exact: true });
  const training = page.getByRole("region", { name: "Training in this range", exact: true });
  await expect(summary).toContainText("225");
  await expect(summary).not.toContainText("300");
  await expect(training).toContainText("500 kg");
  await expect(training).toContainText("1,125 lb");
  await expect(training).toContainText(/1.*load.*not recorded|load.*not recorded.*1/i);
  await page.getByRole("combobox", { name: "Chart metric", exact: true }).selectOption("load:kg");
  await expect(summary).toContainText("100");
  const selected = page.getByRole("region", { name: "Selected workout", exact: true });
  await expect(selected.getByRole("link", { name: "View workout", exact: true })).toHaveAttribute("href", new RegExp(`/workouts/${kgWorkout}\\?`));
  await selected.getByRole("link", { name: "View workout", exact: true }).click();
  await page.getByRole("button", { name: "Correct workout", exact: true }).click();
  await page.getByLabel("Correct weight for set 1", { exact: true }).fill("105");
  await page.getByRole("button", { name: "Preview correction", exact: true }).click();
  await page.getByRole("button", { name: "Save correction", exact: true }).click();
  await expect(page.getByText(/525 kg volume/)).toBeVisible();
  await page.getByRole("link", { name: "← Back to Progress", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Chart metric", exact: true })).toHaveValue("load:kg");
  await expect(summary).toContainText("105");
  await expect(training).toContainText("525 kg");
  await expect(training).toContainText("1,125 lb");
  await capture(page, info, "mixed-units-after-correction");
});

test("Big three opens by default with independent histories and individual drilldown", async ({ page }, info) => {
  test.setTimeout(90_000);
  await registerViaApi(page, "progress-big-three");
  for (const [name, older, latest] of [["Squat", 185, 205.25], ["Bench", 135, 145.25], ["Deadlift", 225, 245.25]] as const) {
    await record(page, { name, date: daysAgo(90), weight: older });
    await record(page, { name, date: daysAgo(name === "Squat" ? 14 : name === "Bench" ? 7 : 2), weight: latest });
  }
  await record(page, { name: "Romanian deadlift", date: daysAgo(1), weight: 315 });
  await page.goto("/history");
  const chart = page.getByRole("region", { name: "Big three chart", exact: true });
  await expect(chart).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Period", exact: true })).toHaveValue("all");
  await page.getByRole("combobox", { name: "Chart metric", exact: true }).selectOption("load:lb");
  const lifts = page.getByRole("list", { name: "Primary lift results", exact: true });
  await expect(lifts.getByRole("listitem")).toHaveCount(3);
  await expect(lifts).toContainText("205.25");
  await expect(lifts).toContainText("145.25");
  await expect(lifts).toContainText("245.25");
  await expect(lifts).not.toContainText("315");
  await page.getByText("Dated chart values", { exact: true }).click();
  await expect(page.getByRole("table", { name: "Big three dated values", exact: true }).getByRole("row")).toHaveCount(7);
  await page.getByText("Dated chart values", { exact: true }).click();
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("4w");
  await expect(page).toHaveURL(/period=4w/);
  await page.getByRole("link", { name: "View Bench progress", exact: true }).click();
  await expect(page.getByRole("region", { name: "Exercise chart", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose exercise", exact: true })).toContainText("Bench");
  await expect(page.getByRole("combobox", { name: "Chart metric", exact: true })).toHaveValue("load:lb");
  await expect(page.getByRole("combobox", { name: "Period", exact: true })).toHaveValue("4w");
  await page.getByRole("link", { name: "Big three", exact: true }).click();
  await expect(chart).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Period", exact: true })).toHaveValue("4w");
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("all");
  await expect(lifts).toContainText("245.25");
  for (const [name, width, height, fontSize, theme] of [
    ["mini-light", 375, 629, 16, "light"],
    ["iphone16-dark", 393, 659, 16, "dark"],
    ["mini-double-text", 375, 629, 32, "dark"],
    ["iphone16-large", 393, 852, 20, "light"],
    ["iphone16-pwa", 393, 852, 16, "dark"],
    ["desktop", 1440, 1000, 16, "light"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ fontSize, theme }) => { document.documentElement.style.fontSize = `${fontSize}px`; document.documentElement.dataset.theme = theme; window.scrollTo(0, 0); }, { fontSize, theme });
    await capture(page, info, `big-three-${name}`);
  }
  const inspect = page.getByRole("button", { name: "Inspect Big three chart", exact: true });
  await inspect.focus();
  await page.keyboard.press("Enter");
  const selected = page.getByRole("region", { name: "Selected comparison workout", exact: true });
  await expect(selected).toContainText("Deadlift");
  await expect(selected).toContainText("245.25");
  await page.getByRole("button", { name: "Previous comparison workout", exact: true }).click();
  await expect(selected).toContainText("Bench");
  await expect(selected).toContainText("145.25");
  await selected.getByRole("link", { name: "View workout", exact: true }).click();
  await expect(page.getByText("Bench · Set 1", { exact: true })).toBeVisible();
  await expect(page.getByText("5 reps at 145.25 lb", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "← Back to Progress", exact: true }).click();
  await expect(chart).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Period", exact: true })).toHaveValue("all");
  await expect(page.getByRole("combobox", { name: "Chart metric", exact: true })).toHaveValue("load:lb");
});
