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
  await expect(page.getByRole("heading", { name: "Active Runs" })).toBeVisible();
  await expect(page.getByText(programName).first()).toBeVisible();
  await expect(page.getByText(weekday, { exact: true })).toBeVisible();

  await goToTab(page, "Today");
  await expect(page.getByText("Scheduled today")).toBeVisible();
  await expect(page.getByRole("heading", { name: programName })).toBeVisible();
  await expect(page.getByText("Day 1 · Today Lower")).toBeVisible();
  await expect(page.getByText("Next lift")).toBeVisible();
  await expect(page.getByText("Squat")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Workout" })).toBeVisible();
});

test("maps selected weekdays onto ordered program days", async ({ page }) => {
  await register(page, "schedule-map");
  const programName = "E2E Schedule Mapping";
  const weekday = await page.evaluate(() => new Date().getDay());
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const companionWeekday = weekday === 0 ? 6 : weekday - 1;
  const companionDay = labels[companionWeekday];
  const today = labels[weekday];
  const expectedDayNumber = [companionWeekday, weekday].sort((a, b) => a - b).indexOf(weekday) + 1;
  const expectedDayName = expectedDayNumber === 1 ? "Earlier Day" : "Today Day";

  await createProgram(page, programName);
  await addDay(page, "Earlier Day");
  await addDay(page, "Today Day");

  const schedule = page.locator("section").filter({ has: page.getByRole("heading", { name: "Schedule" }) });
  await schedule.getByRole("button", { name: companionDay }).click();
  await schedule.getByRole("button", { name: today }).click();
  await schedule.getByRole("button", { name: "Save schedule" }).click();
  await expect(schedule.getByText("2 days each week")).toBeVisible();

  await goToTab(page, "Today");
  const scheduledToday = page.locator("section").filter({ hasText: "Scheduled today" }).filter({ hasText: programName });
  await expect(scheduledToday.getByRole("heading", { name: programName })).toBeVisible();
  await expect(scheduledToday.getByText(`Day ${expectedDayNumber} · ${expectedDayName}`)).toBeVisible();
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
