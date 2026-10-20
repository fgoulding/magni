import { expect, test } from "@playwright/test";
import { registerViaApi } from "./helpers";

function offsetDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

for (const width of [375, 393]) {
  test(`Month early start and active movement preserve the training date and sets at ${width}px`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 375 ? 812 : 852 });
    await registerViaApi(page, `workout-dates-${width}`);
    const created = await page.request.post("/api/programs", { data: { name: "Date test", numWeeks: 2 } });
    expect(created.ok()).toBe(true);
    const program = await created.json();
    const dayResponse = await page.request.post(`/api/programs/${program.id}/days`, { data: { name: "Lower" } });
    expect(dayResponse.ok()).toBe(true);
    const day = await dayResponse.json();
    expect((await page.request.post(`/api/days/${day.id}/exercises`, { data: { name: "Squat", trainingMax: 200, progressionType: "linear" } })).ok()).toBe(true);
    expect((await page.request.put(`/api/programs/${program.id}`, { data: { scheduleWeekdays: [0, 1, 2, 3, 4, 5, 6], startDate: "2090-06-05" } })).ok()).toBe(true);
    await page.goto("/calendar?month=2090-06&date=2090-06-05&view=month");
    await page.locator('[data-month-date="2090-06-05"]').getByRole("link").click();
    const workout = page.getByRole("dialog", { name: "Date test", exact: true });
    await expect(workout.getByRole("button", { name: "Move to date", exact: true })).toBeVisible();
    const occurrenceId = Number(new URL(page.url()).searchParams.get("workout")!.split("-").at(-1));
    const picker = page.getByRole("dialog", { name: "Move Lower", exact: true });
    const plannedDate = width === 375 ? "2090-07-05" : "2090-06-05";
    if (width === 375) {
      await workout.getByRole("button", { name: "Move to date", exact: true }).click();
      await picker.getByLabel("Another date", { exact: true }).fill(plannedDate);
      await page.screenshot({ path: info.outputPath(`month-move-${width}.png`), animations: "disabled" });
      await picker.getByRole("button", { name: "Save date", exact: true }).click();
      await expect(page).toHaveURL(/month=2090-07/);
      expect(new URL(page.url()).searchParams.get("view")).toBe("month");
      await expect(workout).toContainText(plannedDate);
    } else {
      // A month-cell link has no date parameter; start must handle that too.
      expect(new URL(page.url()).searchParams.has("date")).toBe(false);
    }
    const started = page.waitForResponse(response => response.url().endsWith(`/api/programs/${program.id}/sessions`) && response.request().method() === "POST");
    await workout.getByRole("button", { name: "Do workout", exact: true }).click();
    const response = await started;
    expect(response.status()).toBe(201);
    const session = await response.json();
    expect(session.scheduled_date).toBe(plannedDate);
    expect(session.occurrence_id).toBe(occurrenceId);
    const today = session.date as string;
    expect(today).not.toBe(session.scheduled_date);
    await expect(page).toHaveURL(new RegExp(`month=${today.slice(0, 7)}`));
    expect(new URL(page.url()).searchParams.get("view")).toBe("month");
    await expect(workout).toContainText(`Training date ${today}`);
    await expect(workout.getByRole("heading", { name: "Squat", exact: true })).toBeVisible();
    await workout.getByRole("button", { name: "Save set 1", exact: true }).click();
    await expect(workout.getByRole("button", { name: "Undo set 1", exact: true })).toBeEnabled();
    const before = await (await page.request.get(`/api/sessions/${session.id}`)).json();
    const yesterday = offsetDate(today, -1);
    // No reload between logging and Move: its concurrency revision must be fresh.
    await workout.getByRole("button", { name: "Move to date", exact: true }).click();
    await picker.getByLabel("Another date", { exact: true }).fill(yesterday);
    const moved = page.waitForResponse(response => response.url().endsWith("/api/calendar/actions") && response.request().method() === "POST");
    await picker.getByRole("button", { name: "Save date", exact: true }).click();
    expect((await moved).ok()).toBe(true);
    await expect(workout).toContainText(`Training date ${yesterday}`);
    const after = await (await page.request.get(`/api/sessions/${session.id}`)).json();
    expect(after).toMatchObject({ id: session.id, date: yesterday, scheduled_date: plannedDate, occurrence_id: occurrenceId });
    expect(after.sets).toEqual(before.sets);
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await page.screenshot({ path: info.outputPath(`active-moved-${width}.png`), animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await workout.getByRole("link", { name: "Close workout", exact: true }).click();
    await expect(workout).toHaveCount(0);
    await expect(page).toHaveURL(`/calendar?month=${yesterday.slice(0, 7)}&date=${yesterday}&view=month`);
    await expect(page.locator(`[data-month-date="${yesterday}"]`).getByRole("link", { name: `In progress: Date test - Lower on ${yesterday}`, exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Calendar view", exact: true }).getByRole("link", { name: "Week", exact: true }).click();
    await expect(page).toHaveURL(`/calendar?month=${yesterday.slice(0, 7)}&date=${yesterday}`);
    await expect(page.locator(`[data-calendar-date="${yesterday}"]`).getByRole("button", { name: "Drag Lower to another day", exact: true })).toBeVisible();
    await page.goto(`/calendar?month=${plannedDate.slice(0, 7)}&view=month`);
    await expect(page.locator(`[data-month-date="${plannedDate}"]`).getByRole("link", { name: /^In progress:/ })).toHaveCount(0);
    await page.goto(`/workouts/${session.id}`);
    await page.getByRole("link", { name: "Resume planned workout", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`date=${yesterday}.*workout=occurrence-${occurrenceId}`));
    await expect(workout.getByRole("button", { name: "Undo set 1", exact: true })).toBeEnabled();
    await page.reload();
    await expect(workout.getByRole("button", { name: "Undo set 1", exact: true })).toBeEnabled();
    for (const number of [2, 3]) {
      await workout.getByRole("button", { name: `Save set ${number}`, exact: true }).click();
      await expect(workout.getByRole("button", { name: `Undo set ${number}`, exact: true })).toBeEnabled();
    }
    await workout.getByRole("button", { name: "Finish Workout", exact: true }).click();
    await expect(workout).toContainText(`Completed on ${yesterday}`);
    await expect(workout.getByRole("button", { name: "Move to date", exact: true })).toHaveCount(0);
    const completed = await (await page.request.get(`/api/sessions/${session.id}`)).json();
    expect(completed).toMatchObject({ id: session.id, date: yesterday, status: "completed", scheduled_date: plannedDate });
    const sessions = await (await page.request.get(`/api/programs/${program.id}/sessions`)).json();
    expect(sessions.map((row: { id: number }) => row.id)).toEqual([session.id]);
  });
}
