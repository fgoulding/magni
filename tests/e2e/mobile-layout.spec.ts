import { expect, test } from "@playwright/test";
import { registerViaApi } from "./helpers";

test("Today workout scrolls with the page instead of sticking over later content", async ({ page }, info) => {
  await registerViaApi(page, "today-scroll");
  expect((await page.request.post("/api/settings", { data: { timezone: "UTC" } })).ok()).toBe(true);
  const program = await (await page.request.post("/api/programs", { data: { name: "Today scroll training", numWeeks: 8 } })).json();
  const day = await (await page.request.post(`/api/programs/${program.id}/days`, { data: { name: "Full body" } })).json();
  for (const name of ["Squat", "Bench press", "Row", "Curl"]) {
    expect((await page.request.post(`/api/days/${day.id}/exercises`, { data: { name, trainingMax: 100, progressionType: "linear" } })).ok()).toBe(true);
  }
  // Scheduling puts the active card beside the remaining Today content, where
  // a sticky whole-workout container previously covered the following actions.
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 3);
  expect((await page.request.put(`/api/programs/${program.id}`, { data: { startDate: start.toISOString().slice(0, 10), scheduleWeekdays: [0, 1, 2, 3, 4, 5, 6] } })).ok()).toBe(true);
  await page.goto("/today");
  await expect(page.getByRole("button", { name: "Start Workout", exact: true })).toHaveCount(1);
  const missed = page.getByRole("region", { name: "Missed workouts", exact: true });
  await expect(missed.getByRole("link")).toHaveCount(3);
  await expect(missed.getByRole("button")).toHaveCount(0);
  const plannedHref = await missed.getByRole("link").first().getAttribute("href");
  expect(plannedHref).toMatch(/workout=occurrence-\d+/);
  await page.screenshot({ path: info.outputPath("today-focused-idle.png"), fullPage: true, animations: "disabled" });
  await page.screenshot({ path: info.outputPath("today-focused-idle-viewport.png"), animations: "disabled" });
  const startResponse = page.waitForResponse(response => /\/api\/programs\/\d+\/sessions$/.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Start Workout", exact: true }).click();
  const activeResponse = await startResponse;
  expect(activeResponse.ok()).toBe(true);
  const activeSession = await activeResponse.json();
  const card = page.locator("section.card").filter({ has: page.getByRole("button", { name: "Finish Workout", exact: true }) });
  await expect(card).toBeVisible();
  // Starting the workout can scroll its action into view. Measure from a known
  // document origin so that click-induced scrolling cannot mimic sticky drift.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: info.outputPath("today-scroll-top.png"), animations: "disabled" });
  const top = (await card.boundingBox())!.y;
  await page.evaluate(distance => window.scrollTo(0, distance), top + 100);
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(top);
  expect(Math.abs((await card.boundingBox())!.y - (top - scrolled))).toBeLessThan(2);
  await page.screenshot({ path: info.outputPath("today-scroll-middle.png") });
  const quick = page.getByRole("link", { name: "Quick workout", exact: true });
  await quick.scrollIntoViewIfNeeded();
  await expect(quick).toBeInViewport();
  expect(await page.evaluate(() => [...document.querySelectorAll("main *")].filter(element => /^(auto|scroll)$/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1).length)).toBe(0);
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.fontSize = "20px"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("today-focused-dark-large.png"), fullPage: true, animations: "disabled" });
  await quick.click();
  await expect(page.getByRole("heading", { name: "Add workout", exact: true })).toBeVisible();
  await expect(page.getByLabel("Workout date", { exact: true })).toHaveValue(new Date().toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Quick workout", exact: true }).click();
  await expect(page.getByRole("button", { name: "Finish workout", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Today", exact: true }).click();
  await expect(page.getByRole("button", { name: "Finish workout", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish Workout", exact: true })).toHaveCount(0);
  const resume = page.getByRole("link", { name: "Resume: Today scroll training - Full body", exact: true });
  await expect(resume).toHaveAttribute("href", `/workouts/${activeSession.id}`);
  await expect(page.getByRole("region", { name: "Missed workouts", exact: true }).getByRole("link")).toHaveCount(3);
  await page.screenshot({ path: info.outputPath("today-focused-active-quick.png"), fullPage: true, animations: "disabled" });
});

test("Today resumes the exact active manual session ahead of another unscheduled program", async ({ page }, info) => {
  await registerViaApi(page, "today-manual-resume");
  const programs = [];
  for (const suffix of ["A", "B"]) {
    const created = await page.request.post("/api/programs", { data: { name: `Manual ${suffix}`, numWeeks: 2 } });
    expect(created.ok()).toBe(true);
    const program = await created.json();
    const addedDay = await page.request.post(`/api/programs/${program.id}/days`, { data: { name: `Manual day ${suffix}` } });
    expect(addedDay.ok()).toBe(true);
    const day = await addedDay.json();
    expect((await page.request.post(`/api/days/${day.id}/exercises`, { data: { name: `Manual row ${suffix}`, trainingMax: 100, progressionType: "linear" } })).ok()).toBe(true);
    programs.push({ id: program.id, dayId: day.id, name: `Manual ${suffix}`, lift: `Manual row ${suffix}` });
  }
  await page.goto("/today");
  const originalPrimary = page.locator("section.card").filter({ has: page.getByRole("button", { name: "Start Workout", exact: true }) });
  await expect(originalPrimary).toHaveCount(1);
  const originalText = await originalPrimary.innerText();
  const alternate = programs.find(program => !originalText.includes(program.name))!;
  expect(alternate).toBeDefined();
  const started = await page.request.post(`/api/programs/${alternate.id}/sessions`, { data: { dayId: alternate.dayId, weekNumber: 2 } });
  expect(started.status()).toBe(201);
  const session = await started.json();
  expect(session.occurrence_id).toBeNull();
  expect((await page.request.put(`/api/sessions/${session.id}/sets`, { data: { setId: session.sets[0].id, actualReps: 7, actualWeight: 42.5 } })).ok()).toBe(true);
  const exactResume = page.waitForResponse(response => response.url().endsWith(`/api/sessions/${session.id}`) && response.request().method() === "GET");
  await page.goto("/today");
  expect((await (await exactResume).json()).id).toBe(session.id);
  await expect(page.getByRole("button", { name: "Finish Workout", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Start Workout", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: alternate.lift, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: alternate.lift, exact: true })).toBeVisible();
  const saved = await (await page.request.get(`/api/sessions/${session.id}`)).json();
  expect(saved).toMatchObject({ id: session.id, date: session.date, occurrence_id: null, status: "in_progress", week_number: 2 });
  expect(saved.sets[0]).toMatchObject({ id: session.sets[0].id, actual_reps: 7, actual_weight: 42.5 });
  expect(await (await page.request.get(`/api/programs/${alternate.id}/sessions`)).json()).toHaveLength(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("today-manual-exact-resume-viewport.png"), animations: "disabled" });
});

test("bottom tabs clear the home indicator and stay still while the agenda scrolls", async ({ page }, info) => {
  await registerViaApi(page, "mobile-layout");
  await page.goto("/calendar?month=2090-06&date=2090-06-05");
  const nav = page.locator("nav").filter({ has: page.getByRole("link", { name: "Programs", exact: true }) });
  // WebKit emulation does not expose a hardware safe area. Exercise the same
  // runtime inset variable with an iPhone-sized inset, separate from real PWA QA.
  await page.addStyleTag({ content: ":root { --safe-bottom: 34px !important; }" });
  const today = nav.getByRole("link", { name: "Today", exact: true });
  const before = await today.boundingBox();
  expect(before!.height).toBeGreaterThanOrEqual(60);
  expect(page.viewportSize()!.height - before!.y - before!.height).toBeGreaterThanOrEqual(40);
  const restDay = page.locator('[data-calendar-date="2090-06-05"]');
  expect((await restDay.boundingBox())!.height).toBeLessThan(108);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect((await today.boundingBox())!.y).toBe(before!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("calendar-bottom-clearance-light.png"), fullPage: true, animations: "disabled" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.fontSize = "20px"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("calendar-bottom-clearance-dark-large.png"), fullPage: true, animations: "disabled" });
});
