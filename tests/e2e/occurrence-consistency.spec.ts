import { test, expect } from "@playwright/test";
import { registerViaApi } from "./helpers";

test("Today and Calendar share a partial-week occurrence and resume the same session", async ({ page }, info) => {
  await registerViaApi(page, "occurrence");
  const timezone = "America/Los_Angeles";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const date = `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}-${parts.find(p => p.type === "day")!.value}`;
  await page.request.post("/api/settings", { data: { timezone } });
  const program = await (await page.request.post("/api/programs", { data: { name: "Shared occurrence", numWeeks: 2 } })).json();
  for (const [name, lift] of [["Lower", "Squat"], ["Upper", "Bench Press"], ["Full Body", "Deadlift"]]) {
    const day = await (await page.request.post(`/api/programs/${program.id}/days`, { data: { name } })).json();
    expect((await page.request.post(`/api/days/${day.id}/exercises`, { data: { name: lift, trainingMax: 200, progressionType: "linear" } })).ok()).toBe(true);
  }
  expect((await page.request.put(`/api/programs/${program.id}`, { data: { scheduleWeekdays: [0,1,2,3,4,5,6], startDate: date } })).ok()).toBe(true);
  await page.goto("/today");
  await expect(page.getByText("Squat", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("today-occurrence.png"), fullPage: true });
  const startResponse = page.waitForResponse(r => r.url().endsWith(`/api/programs/${program.id}/sessions`) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Start Workout", exact: true }).click();
  const session = await (await startResponse).json();
  expect(session.scheduled_date).toBe(date);
  expect(session.day_name).toBe("Lower");
  expect(session.occurrence_id).toBeGreaterThan(0);
  const savedSet = { setId: session.sets[0].id, actualReps: 7, actualWeight: 42.5 };
  expect((await page.request.put(`/api/sessions/${session.id}/sets`, { data: savedSet })).ok()).toBe(true);
  const waitForExactResume = () => page.waitForResponse(response =>
    response.request().method() === "GET" &&
    new URL(response.url()).pathname === `/api/programs/${program.id}/sessions/current` &&
    new URL(response.url()).searchParams.get("occurrenceId") === String(session.occurrence_id),
  ).then(async response => {
    expect(response.ok()).toBe(true);
    const resumed = await response.json();
    expect(resumed).toMatchObject({ id: session.id, occurrence_id: session.occurrence_id, status: "in_progress" });
    expect(resumed.sets.map((set: { id: number }) => set.id)).toEqual(session.sets.map((set: { id: number }) => set.id));
    expect(resumed.sets[0]).toMatchObject({ id: savedSet.setId, actual_reps: savedSet.actualReps, actual_weight: savedSet.actualWeight });
  });
  await page.getByRole("navigation").getByRole("link", { name: "Calendar", exact: true }).click();
  const occurrence = page.getByRole("link", { name: `In progress: Shared occurrence - Lower on ${date}`, exact: true });
  await expect(occurrence).toBeVisible();
  expect(new URL((await occurrence.getAttribute("href"))!, page.url()).searchParams.get("workout")).toBe(`occurrence-${session.occurrence_id}`);
  const box = await occurrence.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const resumed = waitForExactResume();
  await occurrence.click();
  await resumed;
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Squat", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("calendar-resume.png"), fullPage: true });
  const reloaded = waitForExactResume();
  await page.reload();
  await reloaded;
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Squat", exact: true })).toBeVisible();
  const sessions = await (await page.request.get("/api/sessions")).json();
  expect(sessions.filter((s: { program_id: number }) => s.program_id === program.id).map((s: { id: number }) => s.id)).toEqual([session.id]);
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: info.outputPath("calendar-resume-dark.png"), fullPage: true });
});
