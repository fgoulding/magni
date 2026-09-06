import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { registerViaApi } from "./helpers";

type PlannedSet = { id: number; calculated_weight: number; reps: number; rep_out_target: number; editor_json: string };
type PlannedSession = { id: number; sets: PlannedSet[] };
type Completion = { progressionDecisions: Array<{ result: { outcome: string; reason: string; explanation: string }; afterState: { load: number; trainingMax: number; consecutiveFailures: number } }> };

const navigationDiagnostics = new WeakMap<Page, unknown[]>();
test.beforeEach(async ({ page }) => {
  if (!process.env.E2E_NAV_DIAGNOSTICS) return;
  const network: unknown[] = []; navigationDiagnostics.set(page, network);
  page.on("request", request => { if (/\/(today|calendar)(\?|$)/.test(request.url())) network.push({ type: "request", time: Date.now(), url: request.url(), rsc: request.headers().rsc, nextUrl: request.headers()["next-url"] }); });
  page.on("response", response => { if (/\/(today|calendar)(\?|$)/.test(response.url())) network.push({ type: "response", time: Date.now(), url: response.url(), status: response.status() }); });
  await page.addInitScript(() => {
    const events: unknown[] = []; Object.assign(window, { completionNavigationEvents: events });
    for (const type of ["pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click"]) document.addEventListener(type, event => {
      const target = event.target as Element;
      const pointer = event as MouseEvent;
      const anchor = document.querySelector('nav a[href="/calendar"]');
      events.push({ type, time: Date.now(), text: target.textContent?.trim().slice(0, 100), tag: target.tagName, x: pointer.clientX, y: pointer.clientY, scrollY, height: innerHeight, documentHeight: document.documentElement.scrollHeight, viewport: { top: visualViewport?.offsetTop, height: visualViewport?.height }, nav: anchor?.getBoundingClientRect().toJSON() });
    }, true);
  });
});
test.afterEach(async ({ page }, info) => {
  if (!process.env.E2E_NAV_DIAGNOSTICS) return;
  await info.attach("navigation-events", { body: JSON.stringify({ network: navigationDiagnostics.get(page), events: await page.evaluate(() => (window as unknown as { completionNavigationEvents: unknown[] }).completionNavigationEvents) }), contentType: "application/json" });
});

async function authorPreset(page: Page, preset: string): Promise<string> {
  await registerViaApi(page, `logged-${preset}`);
  await page.goto("/programs/editor/new");
  await page.getByText("Presets and program files", { exact: true }).click();
  await page.getByRole("combobox", { name: "Optional starting structure", exact: true }).selectOption(preset);
  await page.getByRole("button", { name: "Apply preset", exact: true }).click();
  await page.getByLabel("Program name", { exact: true }).fill(`Preset proof ${preset}`);
  await page.getByRole("button", { name: "Copy week", exact: true }).click();
  await page.getByLabel("Week name", { exact: true }).fill("Override week");
  await page.getByRole("button", { name: "Prescriptions", exact: true }).click();
  await page.getByLabel("Set 1 minimum reps", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("combobox", { name: "Week", exact: true }).selectOption({ label: "Override week" });
  await page.getByRole("button", { name: "Prescriptions", exact: true }).click();
  await expect(page.getByLabel("Set 1 minimum reps", { exact: true })).toHaveValue("4");
  await page.getByRole("combobox", { name: "Week", exact: true }).selectOption("0");
  await page.getByRole("button", { name: "Progression & preview", exact: true }).click();
  if (preset === "reset") for (const index of [1, 2, 3]) await page.getByLabel(`Set ${index} reps`, { exact: true }).fill("4");
  const preview = await page.getByRole("status", { name: "Progression preview result", exact: true }).innerText();
  await page.getByRole("button", { name: "Review & activate", exact: true }).click();
  for (const weekday of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
    const button = page.getByRole("button", { name: weekday, exact: true });
    if (await button.getAttribute("aria-pressed") !== "true") await button.click();
  }
  await page.getByRole("button", { name: "Activate program", exact: true }).click();
  await expect(page.getByText("Program activated", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Train this program", exact: true }).click();
  return preview;
}

async function start(page: Page, fromCalendar = false): Promise<PlannedSession> {
  await expect(page.getByRole("button", { name: fromCalendar ? "Do workout" : "Start Workout", exact: true })).toBeVisible();
  const previewText = await page.locator(fromCalendar ? '[role="dialog"]' : "main").innerText();
  const response = page.waitForResponse(item => /\/api\/programs\/\d+\/sessions$/.test(item.url()) && item.request().method() === "POST");
  await page.getByRole("button", { name: fromCalendar ? "Do workout" : "Start Workout", exact: true }).click();
  const started = await response;
  expect(started.ok()).toBe(true);
  const session: PlannedSession = await started.json();
  for (const set of session.sets) {
    const metadata = JSON.parse(set.editor_json);
    const range = `${set.reps}${set.rep_out_target === set.reps ? "" : `–${set.rep_out_target}`}`;
    const load = metadata.set.loadMode === "bodyweight" ? "BW" : metadata.set.loadMode === "added" ? `BW +${set.calculated_weight} ${metadata.unit}` : `${set.calculated_weight} ${metadata.unit}`;
    expect(previewText).toContain(`${range} @ ${load}`);
  }
  return session;
}

async function perform(page: Page, actualReps?: number[]): Promise<Completion> {
  const reps = page.getByRole("spinbutton", { name: / set \d+ reps$/ });
  const saves = page.getByRole("button", { name: /^Save set \d+$/ });
  const setPicker = page.getByRole("combobox", { name: "Set", exact: true });
  const focused = await setPicker.count() > 0;
  const count = focused ? await setPicker.locator("option").count() : await reps.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    if (focused) await setPicker.selectOption({ index });
    const visibleIndex = focused ? 0 : index;
    if (actualReps) await reps.nth(visibleIndex).fill(String(actualReps[index]));
    await saves.nth(visibleIndex).click();
    await expect(saves.nth(visibleIndex)).toHaveAttribute("aria-pressed", "true");
  }
  const response = page.waitForResponse(item => item.url().endsWith("/complete-and-advance") && item.request().method() === "POST");
  await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
  const finished = await response;
  expect(finished.ok()).toBe(true);
  return finished.json();
}

async function openNext(page: Page) {
  if (await page.getByRole("dialog").count()) {
    await page.getByRole("link", { name: "Close workout", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.getByRole("navigation").getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.locator('[aria-label="Weekly workout agenda"]')).toBeVisible();
  const next = page.getByRole("link", { name: /^Scheduled: Preset proof/ }).first();
  for (let offset = 0; await next.count() === 0 && offset < 3; offset++) {
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

async function capture(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

for (const preset of ["linear", "top-backoff", "manual-ab"]) test(`log ${preset} and preserve copied overrides into the next prescription`, async ({ page }, info) => {
  test.setTimeout(90_000);
  const preview = await authorPreset(page, preset);
  const first = await start(page);
  const completed = await perform(page);
  expect(completed.progressionDecisions[0].result.explanation).toBe(preview);
  if (preset === "manual-ab") expect(completed.progressionDecisions.every(decision => decision.result.reason === "manual")).toBe(true);
  else expect(completed.progressionDecisions[0].afterState.load).toBe(preset === "linear" ? 42.5 : 137.5);
  await openNext(page);
  const next = await start(page, true);
  if (preset === "top-backoff") {
    expect(first.sets.map(set => set.calculated_weight)).toEqual([135, 115, 115]);
    expect(next.sets.map(set => set.calculated_weight)).toEqual([137.5, 115, 115]);
    expect(next.sets[0].reps).toBe(4);
    await expect(page.getByText(/RPE 8/)).toBeVisible();
    await expect(page.getByText(/RIR 2/)).toHaveCount(2);
  } else if (preset === "linear") {
    expect(next.sets.map(set => set.calculated_weight)).toEqual([42.5, 42.5, 42.5]);
    expect(next.sets[0].reps).toBe(4);
  } else {
    expect(first.sets.map(set => set.calculated_weight)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(next.sets.map(set => set.calculated_weight)).toEqual([40, 40, 40, 40, 40, 40]);
    const dayB = await perform(page);
    expect(dayB.progressionDecisions.every(decision => decision.result.reason === "manual")).toBe(true);
    await openNext(page);
    const copiedA = await start(page, true);
    expect(copiedA.sets.map(set => set.calculated_weight)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(copiedA.sets[0].reps).toBe(4);
  }
  await capture(page, info, `logged-${preset}-next-prescription`);
});

test("three actual missed exposures reset the next load once", async ({ page }, info) => {
  test.setTimeout(90_000);
  const preview = await authorPreset(page, "reset");
  for (let exposure = 1; exposure <= 3; exposure++) {
    const current = await start(page, exposure > 1);
    expect(current.sets.map(set => set.calculated_weight)).toEqual([40, 40, 40]);
    const completed = await perform(page, [4, 4, 4]);
    const decision = completed.progressionDecisions[0];
    if (exposure === 1) expect(decision.result.explanation).toBe(preview);
    expect(decision.result.outcome).toBe(exposure === 3 ? "reset" : "hold");
    expect(decision.afterState.consecutiveFailures).toBe(exposure === 3 ? 0 : exposure);
    expect(decision.afterState.load).toBe(exposure === 3 ? 35 : 40);
    await openNext(page);
  }
  const afterReset = await start(page, true);
  expect(afterReset.sets.map(set => set.calculated_weight)).toEqual([35, 35, 35]);
  await capture(page, info, "logged-reset-next35");
});

test("percentage weeks use updated max, fixed deload and the next cycle", async ({ page }, info) => {
  test.setTimeout(120_000);
  const preview = await authorPreset(page, "percentage");
  const expectedLoads = [130, 133.25, 147, 161.25, 110, 143];
  for (let exposure = 0; exposure < expectedLoads.length; exposure++) {
    const current = await start(page, exposure > 0);
    expect(current.sets.map(set => set.calculated_weight)).toEqual(Array(3).fill(expectedLoads[exposure]));
    if (exposure === 5) { await capture(page, info, "logged-percentage-next-cycle143"); break; }
    const completed = await perform(page);
    const decision = completed.progressionDecisions[0];
    if (exposure === 0) expect(decision.result.explanation).toBe(preview);
    expect(decision.afterState.trainingMax).toBe([205, 210, 215, 220, 220][exposure]);
    expect(decision.result.reason).toBe(exposure === 4 ? "fixed_deload" : "success");
    await openNext(page);
  }
});
