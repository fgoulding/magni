import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerViaApi } from "./helpers";

async function prepare(page: Page, label: string) {
  await page.addInitScript(() => localStorage.setItem("install-help-dismissed", "1"));
  await registerViaApi(page, label);
  expect((await page.request.post("/api/settings", { data: { timezone: "UTC" } })).ok()).toBe(true);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => [...document.querySelectorAll("main *")].filter(element => /^(auto|scroll)$/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1).length)).toBe(0);
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" });
}

test("Today overview and saved-set progress remain readable at mini and iPhone 16 sizes", async ({ page }, info) => {
  // This flow captures idle, active, completed and enlarged-text states across six sizes.
  test.setTimeout(90_000);
  await prepare(page, "today-refinement");
  await page.setViewportSize({ width: 375, height: 629 });
  await page.goto("/today");
  await expect(page.getByRole("button", { name: "Quick workout", exact: true })).toBeEnabled();
  await capture(page, info, "mini-rest");
  const document = JSON.parse(await readFile("examples/programs/linear.magni.json", "utf8"));
  document.name = "Full body strength";
  document.startDate = new Date().toISOString().slice(0, 10);
  document.weekdays = [0, 1, 2, 3, 4, 5, 6];
  const day = document.weeks[0].days[0];
  day.name = "Squat, Bench & Row";
  const template = day.exercises[0];
  day.exercises = ["Squat", "Bench press", "Dumbbell row"].map((name, index) => ({
    ...template, id: randomUUID(), progressionKey: randomUUID(), name, baseLoad: [185, 135, 40][index],
    sets: template.sets.map((set: object) => ({ ...set, id: randomUUID() })),
  }));
  const draft = `/api/program-drafts/${randomUUID()}`;
  expect((await page.request.put(draft, { data: { expectedRevision: 0, document } })).ok()).toBe(true);
  expect((await page.request.post(`${draft}/activate`, { data: { expectedRevision: 1 } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Start Workout", exact: true })).toBeEnabled();
  await capture(page, info, "mini-idle");
  await page.getByRole("button", { name: "Start Workout", exact: true }).click();
  const progress = page.getByRole("progressbar", { name: "Saved sets", exact: true });
  await expect(progress).toHaveAttribute("value", "0");
  await expect(progress).toHaveAttribute("max", "9");
  const first = page.locator("[data-set-log-row]").first();
  await first.getByRole("button", { name: "Save set 1", exact: true }).click();
  await expect(progress).toHaveAttribute("value", "1");
  await expect(page.getByText("1 of 9 sets saved", { exact: true })).toBeVisible();
  for (const [name, width, height, theme] of [
    ["mini-browser", 375, 629, "light"], ["iphone16-browser", 393, 659, "dark"],
    ["mini-pwa-size", 375, 812, "dark"], ["iphone16-pwa-size", 393, 852, "light"],
    ["desktop", 1440, 1000, "light"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await capture(page, info, `${name}-active`);
    const row = (await first.boundingBox())!;
    const nav = (await page.getByRole("navigation", { name: "Main navigation" }).boundingBox())!;
    expect(row.y + row.height).toBeLessThanOrEqual(nav.y);
  }
  await page.setViewportSize({ width: 375, height: 629 });
  await first.getByRole("spinbutton", { name: "Squat set 1 weight (lb)", exact: true }).fill("190");
  await expect(progress).toHaveAttribute("value", "0");
  await page.getByRole("button", { name: "Collapse Squat", exact: true }).click();
  await expect(page.locator("[data-exercise-log-card]").first()).toContainText("Unsaved");
  await capture(page, info, "mini-collapsed-pending");
  await page.getByRole("button", { name: "Expand Squat", exact: true }).click();
  await first.getByRole("button", { name: "Undo set 1", exact: true }).click();
  await expect(progress).toHaveAttribute("value", "0");
  await first.getByRole("button", { name: "Save set 1", exact: true }).click();
  await expect(progress).toHaveAttribute("value", "1");
  await page.setViewportSize({ width: 320, height: 812 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
  await capture(page, info, "narrow-enlarged");
  await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
  await page.setViewportSize({ width: 393, height: 659 });
  await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
  await expect(page.getByText("Workout complete today", { exact: true })).toBeVisible();
  await capture(page, info, "iphone16-completed");
});

test("Quick Today keeps editing and secondary actions accessible without duplicate identity", async ({ page }, info) => {
  await prepare(page, "today-quick-refinement");
  await page.setViewportSize({ width: 375, height: 629 });
  const created = await page.request.post("/api/sessions", { data: { name: "Quick workout", date: new Date().toISOString().slice(0, 10), newWorkout: true, requestKey: randomUUID() } });
  expect(created.status()).toBe(201);
  const session = await created.json();
  expect((await page.request.post(`/api/sessions/${session.id}/sets`, { data: { name: "Dumbbell lateral raise", sets: 3, reps: 12, weight: 15, requestKey: randomUUID() } })).ok()).toBe(true);
  await page.goto("/today");
  await expect(page.getByRole("button", { name: "Edit workout", exact: true })).toBeEnabled();
  await expect(page.getByText("Quick workout", { exact: true })).toHaveCount(1);
  const progress = page.getByRole("progressbar", { name: "Saved sets", exact: true });
  await expect(progress).toHaveAttribute("max", "3");
  await page.getByRole("button", { name: "Log set 1", exact: true }).click();
  await expect(progress).toHaveAttribute("value", "1");
  await capture(page, info, "mini-quick-active");
  const first = (await page.locator("[data-set-log-row]").first().boundingBox())!;
  const nav = (await page.getByRole("navigation", { name: "Main navigation" }).boundingBox())!;
  expect(first.y + first.height).toBeLessThanOrEqual(nav.y);
  await page.getByRole("button", { name: "Collapse Dumbbell lateral raise", exact: true }).click();
  await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeHidden();
  await page.getByText("More", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeEnabled();
  await page.getByText("More", { exact: true }).click();
  await page.setViewportSize({ width: 393, height: 659 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.fontSize = "20px"; });
  await capture(page, info, "iphone16-quick-collapsed-large");
  await page.getByRole("button", { name: "Edit workout", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Workout name", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const previous = new Date();
  previous.setUTCDate(previous.getUTCDate() - 1);
  const movedDate = previous.toISOString().slice(0, 10);
  await page.getByLabel("Workout date", { exact: true }).fill(movedDate);
  await page.getByRole("button", { name: "Save workout changes", exact: true }).click();
  await expect(page.getByText(`${movedDate} · lb`, { exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/sessions/${session.id}`)).json()).date).toBe(movedDate);
  await page.reload();
  await expect(page.getByRole("heading", { name: "No workout scheduled today", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dumbbell lateral raise", exact: true })).toHaveCount(0);
});
