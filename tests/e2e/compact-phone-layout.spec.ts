import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { registerViaApi } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 659 });
  await page.addInitScript(() => localStorage.setItem("install-help-dismissed", "1"));
});

async function sameControlLine(controls: Locator[]) {
  const boxes = await Promise.all(controls.map(control => control.boundingBox()));
  for (const box of boxes) {
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(box!.y + box!.height / 2 - boxes[0]!.y - boxes[0]!.height / 2)).toBeLessThan(2);
  }
}

async function overviewFits(page: Page, info: TestInfo, name: string) {
  await expect(page.getByRole("navigation", { name: "Main navigation", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: /^(Week|Month) navigation$/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
  const metrics = await page.evaluate(() => ({ height: innerHeight, scrollHeight: document.documentElement.scrollHeight, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(metrics.scrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.width);
  expect(metrics.scrollHeight, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.height + 1);
  const nav = (await page.getByRole("navigation", { name: "Main navigation", exact: true }).boundingBox())!;
  const region = (await page.getByRole("region", { name: /^(Week|Month) calendar$/ }).boundingBox())!;
  expect(region.y + region.height).toBeLessThanOrEqual(nav.y);
}

async function calendarFixture(page: Page) {
  await registerViaApi(page, "compact-calendar");
  const created = await page.request.post("/api/programs", { data: { name: "Compact calendar", numWeeks: 4 } });
  expect(created.ok()).toBe(true);
  const program = await created.json();
  for (let index = 0; index < 7; index++) {
    const added = await page.request.post(`/api/programs/${program.id}/days`, { data: { name: index % 2 ? "Shoulders, Lateral Raises" : "Bench, Deadlift" } });
    expect(added.ok()).toBe(true);
    const day = await added.json();
    expect((await page.request.post(`/api/days/${day.id}/exercises`, { data: { name: "Squat", trainingMax: 200, progressionType: "linear" } })).ok()).toBe(true);
  }
  expect((await page.request.put(`/api/programs/${program.id}`, { data: { scheduleWeekdays: [0, 1, 2, 3, 4, 5, 6], startDate: "2026-05-04" } })).ok()).toBe(true);
}

async function extraWorkouts(page: Page) {
  for (const name of ["Mobility", "Evening walk"]) {
    expect((await page.request.post("/api/sessions", { data: { name, date: "2026-05-05", unit: "lb", newWorkout: true, requestKey: randomUUID() } })).status()).toBe(201);
  }
}

test("saved and edited sets keep Undo on the numeric control line", async ({ page }, info) => {
  await registerViaApi(page, "compact-set");
  const created = await page.request.post("/api/sessions", { data: { name: "Compact sets", date: "2026-05-05", unit: "lb", newWorkout: true, requestKey: randomUUID() } });
  expect(created.status()).toBe(201);
  const session = await created.json();
  const added = await page.request.post(`/api/sessions/${session.id}/sets`, { data: { name: "Dumbbell Bench Press", sets: 1, reps: 8, weight: 225.25, requestKey: randomUUID() } });
  expect(added.status()).toBe(201);
  const set = (await added.json()).sets[0];
  expect((await page.request.put(`/api/sessions/${session.id}/sets`, { data: { setId: set.id, actualReps: 8, actualWeight: 225.25 } })).ok()).toBe(true);
  await page.goto(`/workouts/${session.id}`);
  const reps = page.getByRole("spinbutton", { name: "Reps for set 1", exact: true });
  const weight = page.getByRole("spinbutton", { name: "Weight for set 1", exact: true });
  const undo = page.getByRole("button", { name: "Undo set 1", exact: true });
  await expect(undo).toBeVisible();
  await page.screenshot({ path: info.outputPath("saved-set.png"), animations: "disabled" });
  await sameControlLine([reps, weight, undo]);
  await weight.fill("227.5");
  const save = page.getByRole("button", { name: "Save set 1", exact: true });
  await sameControlLine([reps, weight, save, undo]);
  await page.screenshot({ path: info.outputPath("edited-saved-set.png"), animations: "disabled" });
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 659 });
    await sameControlLine([reps, weight, save, undo]);
  }
  await page.setViewportSize({ width: 393, height: 659 });
  await save.click();
  await expect(page.locator("[data-set-log-row]").getByText("Saved", { exact: true })).toBeVisible();
  await undo.click();
  // The pending action says “Undoing”; wait for acknowledgement before reload.
  await expect(page.getByRole("button", { name: "Log set 1", exact: true })).toBeEnabled();
  await expect(page.locator("[data-set-log-row]").getByText("Not logged", { exact: true })).toBeVisible();
  await page.reload();
  await expect(weight).toHaveValue("227.5");
  const recorded = await (await page.request.get(`/api/sessions/${session.id}`)).json();
  expect(recorded.sets[0]).toMatchObject({ actual_reps: null, actual_weight: null });
});

test("seven-day overview fits the phone and discloses every workout on a busy day", async ({ page }, info) => {
  // Seed a full month, exercise navigation, then capture four phone profiles.
  test.setTimeout(90_000);
  await calendarFixture(page);
  await page.goto("/calendar?month=2026-05&date=2026-05-04");
  await expect(page.locator("[data-calendar-date]")).toHaveCount(7);
  await overviewFits(page, info, "week-full");
  await extraWorkouts(page);
  await page.reload();
  await overviewFits(page, info, "week-busy-day");
  await page.getByRole("button", { name: "3 workouts on Tue, May 5", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Workouts on Tue, May 5", exact: true });
  await expect(dialog.getByRole("link", { name: /^(Scheduled|In progress):/ })).toHaveCount(3);
  await expect(dialog).toContainText("Mobility");
  await expect(dialog).toContainText("Evening walk");
  const trigger = page.getByRole("button", { name: "3 workouts on Tue, May 5", exact: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "Close day workouts" }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "More options for Shoulders, Lateral Raises", exact: true }).click();
  const actions = page.getByRole("dialog");
  await actions.getByRole("button", { name: "Move", exact: true }).click();
  await expect(actions.getByRole("button", { name: "Wed, May 6", exact: true })).toBeVisible();
  await actions.getByRole("button", { name: "Close calendar action", exact: true }).click();
  await expect(trigger).toBeFocused();
  for (const [name, width, height] of [["mini", 375, 629], ["iphone-13", 390, 664], ["iphone-16-pwa", 393, 852]] as const) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--app-height"))).toBe(`${height}px`);
    if (name.endsWith("pwa")) await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.setProperty("--safe-top", "59px"); document.documentElement.style.setProperty("--safe-bottom", "34px"); });
    await overviewFits(page, info, `week-${name}`);
  }
});

test("six-row month fits the phone and busy-day workouts remain reachable", async ({ page }, info) => {
  // Seed a full month, exercise navigation, then capture four phone profiles.
  test.setTimeout(90_000);
  await calendarFixture(page);
  await extraWorkouts(page);
  await page.goto("/calendar?month=2026-05&date=2026-05-04&view=month");
  await expect(page.getByRole("heading", { name: "May 2026", exact: true })).toBeVisible();
  await overviewFits(page, info, "month-six-rows");
  await page.getByRole("button", { name: "3 workouts on Tue, May 5", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Workouts on Tue, May 5", exact: true });
  await expect(dialog.getByRole("link", { name: /^(Scheduled|In progress):/ })).toHaveCount(3);
  await dialog.getByRole("link", { name: /In progress:.*Mobility/ }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Resume workout", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Close workout", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Calendar view" }).getByRole("link", { name: "Month", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "3 workouts on Tue, May 5", exact: true }).click();
  await dialog.getByRole("link", { name: "Add workout", exact: true }).click();
  await expect(page.getByLabel("Workout date", { exact: true })).toHaveValue("2026-05-05");
  await page.getByRole("link", { name: "← Back to Calendar", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Calendar view" }).getByRole("link", { name: "Month", exact: true })).toHaveAttribute("aria-current", "page");
  for (const [name, width, height] of [["mini", 375, 629], ["iphone-13", 390, 664], ["iphone-16-pwa", 393, 852]] as const) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--app-height"))).toBe(`${height}px`);
    if (name.endsWith("pwa")) await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.setProperty("--safe-top", "59px"); document.documentElement.style.setProperty("--safe-bottom", "34px"); });
    await overviewFits(page, info, `month-${name}`);
  }
});

test("empty week and six-row month remain compact", async ({ page }, info) => {
  await registerViaApi(page, "compact-calendar-empty");
  await page.goto("/calendar?month=2026-05&date=2026-05-04");
  await expect(page.getByText("No workouts scheduled for this week.")).toBeVisible();
  await overviewFits(page, info, "empty-week");
  await page.getByRole("navigation", { name: "Calendar view" }).getByRole("link", { name: "Month", exact: true }).click();
  await expect(page.getByText("No workouts scheduled for this month.")).toBeVisible();
  await overviewFits(page, info, "empty-month");
});
