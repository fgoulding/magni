import fs from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { registerViaApi } from "./helpers";

async function programWithDays(page: Page, name: string) {
  const created = await page.request.post("/api/programs", { data: { name, numWeeks: 2 } });
  expect(created.ok(), `Create program: HTTP ${created.status()}, ${await created.text()}`).toBe(true);
  const program = await created.json();
  const days: number[] = [];
  for (const [dayName, lift] of [["Lower", "Squat"], ["Upper", "Dumbbell Row"]]) {
    const dayResponse = await page.request.post(`/api/programs/${program.id}/days`, { data: { name: dayName } });
    expect(dayResponse.ok(), `Create day: HTTP ${dayResponse.status()}, ${await dayResponse.text()}`).toBe(true);
    const day = await dayResponse.json();
    days.push(day.id);
    const exercise = await page.request.post(`/api/days/${day.id}/exercises`, { data: { name: lift, trainingMax: 200, progressionType: "linear" } });
    expect(exercise.ok(), `Create exercise: HTTP ${exercise.status()}, ${await exercise.text()}`).toBe(true);
  }
  return { id: program.id as number, days };
}
async function savedSession(page: Page, programId: number, body: Record<string, number>) {
  const started = await page.request.post(`/api/programs/${programId}/sessions`, { data: body });
  expect(started.status()).toBe(201);
  const session = await started.json();
  expect((await page.request.put(`/api/sessions/${session.id}/sets`, { data: { setId: session.sets[0].id, actualReps: 7, actualWeight: 42.5 } })).ok()).toBe(true);
  return session;
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  if (info.project.name !== "mobile-safari") return;
  fs.mkdirSync(".playwright/production-goal", { recursive: true });
  await page.screenshot({ path: `.playwright/production-goal/history-${name}-iphone.png`, fullPage: true, animations: "disabled", caret: "initial" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function assertUnchanged(page: Page, programId: number, session: { id: number; sets: { id: number }[] }) {
  const restored = await (await page.request.get(`/api/sessions/${session.id}`)).json();
  expect(restored.sets[0]).toMatchObject({ id: session.sets[0].id, actual_reps: 7, actual_weight: 42.5 });
  const sessions = await (await page.request.get(`/api/programs/${programId}/sessions`)).json();
  expect(sessions.map((row: { id: number }) => row.id)).toEqual([session.id]);
}

test("History resumes a future occurrence with its saved set identity instead of the first program day", async ({ page }, info) => {
  await registerViaApi(page, "future-history-resume");
  const program = await programWithDays(page, "History future");
  expect((await page.request.put(`/api/programs/${program.id}`, { data: { scheduleWeekdays: [0,1,2,3,4,5,6], startDate: "2026-09-05" } })).ok()).toBe(true);
  await page.request.get("/workouts/999999");
  await page.goto("/calendar?month=2026-09&date=2026-09-08");
  const link = page.getByRole("link", { name: "Scheduled: History future - Upper on 2026-09-08", exact: true });
  await expect(link).toBeVisible();
  const occurrenceId = Number((await link.getAttribute("href"))!.match(/workout=occurrence-(\d+)/)![1]);
  const session = await savedSession(page, program.id, { occurrenceId });
  expect(session.week_number).toBe(2);
  const programState = await (await page.request.get(`/api/programs/${program.id}`)).json();
  expect(programState).toMatchObject({ current_week: 1, current_day: 1 });
  await page.goto(`/workouts/${session.id}`);
  const resumed = page.waitForResponse((response) => response.url().includes(`/api/programs/${program.id}/sessions/current?`) && new URL(response.url()).searchParams.get("occurrenceId") === String(occurrenceId));
  await page.getByRole("link", { name: "Resume planned workout", exact: true }).click();
  expect((await (await resumed).json()).id).toBe(session.id);
  await expect(page).toHaveURL(`/calendar?month=2026-09&date=2026-09-08&workout=occurrence-${occurrenceId}`);
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Dumbbell Row", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Squat", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Dumbbell Row", exact: true })).toBeVisible();
  await assertUnchanged(page, program.id, session);
  await screenshot(page, info, "future-resume");
});

test("History resumes an unlinked manual session by exact ID with a stable reload", async ({ page }, info) => {
  await registerViaApi(page, "legacy-history-resume");
  const program = await programWithDays(page, "History manual");
  const session = await savedSession(page, program.id, { dayId: program.days[1], weekNumber: 2 });
  expect(session.occurrence_id).toBeNull();
  await page.request.get("/workouts/999999/resume");
  await page.goto(`/workouts/${session.id}`);
  const resumed = page.waitForResponse((response) => response.url().endsWith(`/api/sessions/${session.id}`) && response.request().method() === "GET");
  await page.getByRole("link", { name: "Resume planned workout", exact: true }).click();
  expect((await (await resumed).json()).id).toBe(session.id);
  await expect(page).toHaveURL(`/workouts/${session.id}/resume`);
  await expect(page.getByRole("heading", { name: "Dumbbell Row", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dumbbell Row", exact: true })).toBeVisible();
  await assertUnchanged(page, program.id, session);
  await screenshot(page, info, "legacy-resume");
});
