import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerViaApi } from "./helpers";

async function captureRows(page: Page, info: TestInfo, name: string) {
  for (const [theme, textSize] of [["light", 16], ["dark", 16], ["dark", 20], ["light", 32]] as const) {
    await page.evaluate(({ theme, textSize }) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.fontSize = `${textSize}px`;
    }, { theme, textSize });
    const card = page.locator("[data-exercise-log-card]").first();
    await card.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const controls = card.locator("input, button");
    for (const control of await controls.all()) {
      if (!await control.isVisible()) continue;
      const bounds = await control.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
    }
    // Numeric content needs room beyond a touch-sized border. Keep room for
    // decimal weights, horizontal padding and the browser's number spinner.
    const weights = card.getByRole("spinbutton", { name: /[Ww]eight/ });
    for (const weight of await weights.all()) {
      const width = await weight.evaluate(input => input.getBoundingClientRect().width);
      expect(width).toBeGreaterThanOrEqual(90);
      expect(await weight.evaluate(input => Number.parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(textSize);
    }
    for (const action of await page.getByRole("button", { name: /^(Finish workout|Discard)$/i }).all()) {
      const size = await action.evaluate(button => ({ text: button.textContent, scroll: button.scrollWidth, client: button.clientWidth }));
      expect(size.scroll, JSON.stringify({ theme, textSize, ...size })).toBeLessThanOrEqual(size.client + 1);
    }
    await page.screenshot({ path: info.outputPath(`${name}-${theme}-${textSize}px.png`), fullPage: true, animations: "disabled" });
    await card.screenshot({ path: info.outputPath(`${name}-card-${theme}-${textSize}px.png`), animations: "disabled" });
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
}

test("quick exercise cards retain edits through collapse and undo without counting unlogged sets", async ({ page }, info) => {
  await registerViaApi(page, "exercise-cards-quick");
  const created = await page.request.post("/api/sessions", { data: { name: "Independent set rows", date: "2026-10-08", unit: "lb", newWorkout: true, requestKey: randomUUID() } });
  expect(created.status()).toBe(201);
  const session = await created.json();
  const added = await page.request.post(`/api/sessions/${session.id}/sets`, { data: { name: "Dumbbell Bench Press", sets: 3, reps: 10, weight: 60, requestKey: randomUUID() } });
  expect(added.status()).toBe(201);
  const sets = (await added.json()).sets;
  await page.goto(`/workouts/${session.id}`);
  const header = () => page.getByRole("button", { name: /^(Expand|Collapse) Dumbbell Bench Press$/ });
  const reps = (number: number) => page.getByRole("spinbutton", { name: `Reps for set ${number}`, exact: true });
  const weight = (number: number) => page.getByRole("spinbutton", { name: `Weight for set ${number}`, exact: true });
  await expect(header()).toHaveAttribute("aria-expanded", "true");
  await reps(2).fill("8");
  await weight(2).fill("225.25");
  await header().click();
  await expect(header()).toHaveAttribute("aria-expanded", "false");
  await expect(reps(2)).toBeHidden();
  await expect(page.locator("[data-exercise-log-card]")).toContainText(/Unsaved/i);
  await header().click();
  await expect(weight(2)).toHaveValue("225.25");
  await page.getByRole("button", { name: "Save set 2", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo set 2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Log set 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo set 1", exact: true })).toBeVisible();
  await captureRows(page, info, "quick-saved");
  await page.getByRole("button", { name: "Undo set 2", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo set 2", exact: true })).toHaveCount(0);
  await expect(weight(2)).toHaveValue("225.25");
  await expect(reps(2)).toHaveValue("8");
  await expect(page.getByRole("button", { name: "Finish workout", exact: true })).toBeEnabled();
  await page.reload();
  await expect(weight(2)).toHaveValue("225.25");
  await expect(reps(2)).toHaveValue("8");
  await expect(page.getByRole("button", { name: "Undo set 2", exact: true })).toHaveCount(0);
  await header().click();
  await expect(header()).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({ path: info.outputPath("quick-collapsed.png"), fullPage: true });
  await page.getByRole("button", { name: "Finish workout", exact: true }).click();
  await expect(page.getByText("Quick workout complete", { exact: true })).toBeVisible();
  const detail = await (await page.request.get(`/api/sessions/${session.id}`)).json();
  expect(detail).toMatchObject({ status: "completed", volume: 600, loggedSets: 1 });
  expect(detail.sets[1]).toMatchObject({ id: sets[1].id, actual_reps: null, actual_weight: null, calculated_weight: 60 });
});

test("planned Today and calendar share collapsible rows and undo preserves the prescription", async ({ page }, info) => {
  await registerViaApi(page, "exercise-cards-planned");
  const document = JSON.parse(await readFile("examples/programs/linear.magni.json", "utf8"));
  document.startDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  document.weekdays = [0, 1, 2, 3, 4, 5, 6];
  const draft = `/api/program-drafts/${randomUUID()}`;
  expect((await page.request.put(draft, { data: { expectedRevision: 0, document } })).ok()).toBe(true);
  expect((await page.request.post(`${draft}/activate`, { data: { expectedRevision: 1 } })).ok()).toBe(true);
  await page.goto("/today");
  const started = page.waitForResponse(response => /\/api\/programs\/\d+\/sessions$/.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Start Workout", exact: true }).click();
  const session = await (await started).json();
  const name = session.sets[0].exercise_name;
  const header = () => page.getByRole("button", { name: new RegExp(`^(Expand|Collapse) ${name}$`) });
  const weight = () => page.getByRole("spinbutton", { name: `${name} set 1 weight (lb)`, exact: true });
  await expect(page.locator("[data-set-log-row]")).toHaveCount(3);
  await expect(header()).toHaveAttribute("aria-expanded", "true");
  await weight().fill("62.5");
  await page.getByRole("button", { name: "Save set 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo set 1", exact: true })).toBeVisible();
  await header().click();
  await expect(weight()).toBeHidden();
  await header().click();
  await expect(weight()).toHaveValue("62.5");
  await captureRows(page, info, "planned-today");
  await page.getByRole("button", { name: "Undo set 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo set 1", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finish Workout", exact: true })).toBeEnabled();
  await page.reload();
  await expect(weight()).toHaveValue("62.5");
  const detail = await (await page.request.get(`/api/sessions/${session.id}`)).json();
  expect(detail.sets[0]).toMatchObject({ id: session.sets[0].id, actual_reps: null, actual_weight: null, calculated_weight: session.sets[0].calculated_weight, editor_json: session.sets[0].editor_json });
  await page.locator("next-route-announcer").waitFor({ state: "attached" });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.getByRole("link", { name: /^In progress:/ }).first().click();
  await expect(page).toHaveURL(url => url.searchParams.get("workout") === `occurrence-${detail.occurrence_id}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(header()).toHaveAttribute("aria-expanded", "true");
  await expect(weight()).toHaveValue("62.5");
  await captureRows(page, info, "planned-calendar");
  await page.getByRole("button", { name: "Save set 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo set 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
  await expect(page.getByText("Completed workout", { exact: true })).toBeVisible();
  const completed = await (await page.request.get(`/api/sessions/${session.id}`)).json();
  expect(completed).toMatchObject({ status: "completed", loggedSets: 1, volume: 62.5 * session.sets[0].rep_out_target });
});

test("a lost Undo response remains a null-write retry after reload", async ({ page }) => {
  await registerViaApi(page, "exercise-cards-undo-retry");
  const created = await page.request.post("/api/sessions", { data: { name: "Undo recovery", date: "2026-10-08", unit: "kg", newWorkout: true, requestKey: randomUUID() } });
  expect(created.status()).toBe(201);
  const session = await created.json();
  const added = await page.request.post(`/api/sessions/${session.id}/sets`, { data: { name: "Row", sets: 1, reps: 8, weight: 42.5, requestKey: randomUUID() } });
  expect(added.status()).toBe(201);
  const set = (await added.json()).sets[0];
  expect((await page.request.put(`/api/sessions/${session.id}/sets`, { data: { setId: set.id, actualReps: 8, actualWeight: 42.5 } })).ok()).toBe(true);
  await page.goto(`/workouts/${session.id}`);
  await page.route("**/api/sessions/*/sets", async route => {
    if (route.request().method() === "PUT" && route.request().postDataJSON().actualReps === null) {
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Undo set 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry undo set 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry undo set 1", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Finish workout", exact: true })).toBeDisabled();
  await page.unroute("**/api/sessions/*/sets");
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry undo set 1", exact: true })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Weight for set 1", exact: true })).toHaveValue("42.5");
  const retry = page.waitForResponse(response => response.url().endsWith(`/api/sessions/${session.id}/sets`) && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Retry undo set 1", exact: true }).click();
  const response = await retry;
  expect(response.request().postDataJSON()).toMatchObject({ actualReps: null, actualWeight: null });
  expect(response.ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Retry undo set 1", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finish workout", exact: true })).toBeEnabled();
  const detail = await (await page.request.get(`/api/sessions/${session.id}`)).json();
  expect(detail.sets[0]).toMatchObject({ id: set.id, actual_reps: null, actual_weight: null });
});
