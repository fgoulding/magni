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
  await page.getByRole("navigation").getByRole("link", { name: "Calendar", exact: true }).click();
  const occurrence = page.getByRole("link", { name: `Scheduled: Shared occurrence - Lower on ${date}`, exact: true });
  await expect(occurrence).toBeVisible();
  const box = await occurrence.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await occurrence.click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Squat", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("calendar-resume.png"), fullPage: true });
  await page.reload();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Squat", exact: true })).toBeVisible();
  const sessions = await (await page.request.get("/api/sessions")).json();
  expect(sessions.filter((s: { program_id: number }) => s.program_id === program.id)).toHaveLength(1);
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: info.outputPath("calendar-resume-dark.png"), fullPage: true });
});
