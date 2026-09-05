import { expect, test } from "@playwright/test";
import { addDay, addLinearExercise, createProgram, goToTab, register, scheduleForToday } from "./helpers";

test("creates a custom program, adds a day and lift, and schedules it for Today", async ({ page }) => {
  await register(page, "program");
  const programName = "E2E Custom Program";

  await createProgram(page, programName);
  await addDay(page, "Today Lower");
  await addLinearExercise(page, "Squat", "200");
  const weekday = await scheduleForToday(page);

  await page.getByRole("link", { name: "Programs" }).click();
  await expect(page.getByRole("heading", { name: "Your programs" })).toBeVisible();
  const program = page.getByRole("article").filter({ has: page.getByRole("heading", { name: programName }) });
  await expect(program).toBeVisible();
  await expect(program.getByText(weekday, { exact: true })).toBeVisible();
  await expect(program.getByText("Wk 1 · Day 1", { exact: true })).toBeVisible();

  await goToTab(page, "Today");
  await expect(page.getByText("Scheduled today")).toBeVisible();
  await expect(page.getByText(programName, { exact: true })).toBeVisible();
  await expect(page.getByText("Week 1 · Day 1 · Today Lower", { exact: true })).toBeVisible();
  await expect(page.getByText("Today's lifts", { exact: true })).toBeVisible();
  await expect(page.getByText("Squat")).toBeVisible();
  await expect(page.getByText("3×5 @ 200 lb", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Workout" })).toBeVisible();
});

test("starts Day 1 on the first eligible date and Day 2 on the next selected weekday", async ({ page }) => {
  await register(page, "schedule-map");
  const programName = "E2E Schedule Mapping";
  const weekday = await page.evaluate(() => new Date().getDay());
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const companionWeekday = weekday === 0 ? 6 : weekday - 1;
  const companionDay = labels[companionWeekday];
  const today = labels[weekday];
  const dates = await page.evaluate(() => {
    const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const date = new Date();
    const first = key(date);
    date.setDate(date.getDate() + 6);
    return { first, second: key(date) };
  });

  await createProgram(page, programName);
  await addDay(page, "Earlier Day");
  await addDay(page, "Today Day");

  const schedule = page.locator("section").filter({ has: page.getByRole("heading", { name: "Schedule" }) });
  await expect(schedule.getByLabel("Program start date")).toHaveValue(dates.first);
  for (const label of [companionDay, today]) {
    const schedulePut = page.waitForResponse((response) =>
      /\/api\/programs\/\d+$/.test(response.url()) && response.request().method() === "PUT",
    );
    await schedule.getByRole("button", { name: label, exact: true }).click();
    const response = await schedulePut;
    expect(response.ok(), `Schedule ${label}: HTTP ${response.status()}, ${await response.text()}, request ${response.request().postData()}`).toBe(true);
  }
  await expect(schedule.getByText("2 days each week")).toBeVisible();

  await goToTab(page, "Today");
  const scheduledToday = page.locator("section").filter({ hasText: "Scheduled today" }).filter({ hasText: programName });
  await expect(scheduledToday.getByText(programName, { exact: true })).toBeVisible();
  await expect(scheduledToday.getByText("Week 1 · Day 1 · Earlier Day", { exact: true })).toBeVisible();
  await expect(scheduledToday.getByText(`Originally scheduled ${dates.first}`, { exact: true })).toBeVisible();
  await goToTab(page, "Calendar");
  await page.goto(`/calendar?date=${dates.second}`);
  await expect(page.getByRole("link", { name: `Scheduled: ${programName} - Today Day on ${dates.second}`, exact: true })).toBeVisible();
});

test("warns when schedule compresses a shorter program week", async ({ page }) => {
  await register(page, "compressed-schedule");

  await createProgram(page, "E2E Compressed Schedule");
  await addDay(page, "Workout A");
  await addDay(page, "Workout B");

  const schedule = page.locator("section").filter({ has: page.getByRole("heading", { name: "Schedule" }) });
  await schedule.getByRole("button", { name: "Mon" }).click();
  await schedule.getByRole("button", { name: "Wed" }).click();
  await schedule.getByRole("button", { name: "Fri" }).click();

  await expect(schedule.getByText(/compressed into less than one week/i)).toBeVisible();
});

test("deletes a program instance from its detail page", async ({ page }) => {
  await register(page, "delete-program");

  await createProgram(page, "E2E Delete Me");
  await page.locator("header").getByRole("button", { name: "Delete program" }).click();
  const responsePromise = page.waitForResponse((response) =>
    /\/api\/programs\/\d+$/.test(response.url()) && response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: "Confirm" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);

  await expect(page).toHaveURL(/\/programs$/);
  await expect(page.getByText("E2E Delete Me")).not.toBeVisible();
});
