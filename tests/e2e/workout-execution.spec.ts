import { expect, test } from "@playwright/test";
import {
  addDay,
  addLinearExercise,
  buildScheduledLinearProgram,
  completeVisibleWorkout,
  createProgram,
  goToTab,
  register,
} from "./helpers";

test("starts, logs, completes, and records a scheduled workout", async ({ page }, info) => {
  await register(page, "complete");
  const programName = "E2E Complete Workout";

  await buildScheduledLinearProgram(page, programName);
  await goToTab(page, "Today");
  await completeVisibleWorkout(page);

  await goToTab(page, "Stats");
  await expect(page.getByRole("heading", { name: "Squat" })).toBeVisible();

  await goToTab(page, "Calendar");
  await expect(page.getByRole("link", { name: new RegExp(`Completed: ${programName} - Today Lower on`) })).toBeVisible();

  await goToTab(page, "Today");
  await expect(page.getByText("Workout complete today")).toBeVisible();
  await expect(page.getByText("15 reps @ 200 lb")).toBeVisible();
  await expect(page.getByText("3,000 lb total")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Workout" })).toHaveCount(0);
  await expect(page.getByRole("navigation").getByRole("link", { name: "Today", exact: true })).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: info.outputPath("today-completed-recap.png"), fullPage: true, animations: "disabled" });
});

test("skips a scheduled workout and records it on the calendar", async ({ page }) => {
  await register(page, "skip");
  const programName = "E2E Skip Workout";

  await buildScheduledLinearProgram(page, programName, "Skip Lower");
  await goToTab(page, "Today");
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Workout skipped")).toBeVisible();

  // Skipped workouts are recorded on the calendar but do not contribute to stats.
  await goToTab(page, "Stats");
  await expect(page.getByText("No stats yet")).toBeVisible();

  await goToTab(page, "Calendar");
  await expect(page.getByRole("link", { name: new RegExp(`Skipped: ${programName} - Skip Lower on`) })).toBeVisible();
});

test("trains a missed calendar workout today and records it on the day it is done", async ({ page }) => {
  await register(page, "catch-up");
  const programName = "E2E Catch Up Workout";
  const dates = await page.evaluate(() => {
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const date = new Date();
    const today = key(date);
    date.setDate(date.getDate() - 1);
    return { today, yesterday: key(date), weekday: labels[date.getDay()] };
  });

  await createProgram(page, programName);
  await addDay(page, "Late Lower");
  await addLinearExercise(page, "Squat", "200");

  const schedule = page.locator("section").filter({ has: page.getByRole("heading", { name: "Schedule" }) });
  const startDateResponse = page.waitForResponse((response) =>
    /\/api\/programs\/\d+$/.test(response.url()) && response.request().method() === "PUT",
  );
  await schedule.getByLabel("Program start date").fill(dates.yesterday);
  expect((await startDateResponse).ok()).toBe(true);
  const yesterdayButton = schedule.getByRole("button", { name: dates.weekday });
  if ((await yesterdayButton.getAttribute("aria-pressed")) !== "true") {
    const responsePromise = page.waitForResponse((response) =>
      /\/api\/programs\/\d+$/.test(response.url()) && response.request().method() === "PUT",
    );
    await yesterdayButton.click(); // toggling auto-saves
    expect((await responsePromise).ok()).toBe(true);
  }

  await goToTab(page, "Calendar");
  await page.goto(`/calendar?date=${dates.yesterday}`);
  await page.getByRole("link", { name: `Scheduled: ${programName} - Late Lower on ${dates.yesterday}`, exact: true }).click();
  await expect(page.getByText("Run from calendar")).toBeVisible();
  await expect(page.getByText(`Originally scheduled ${dates.yesterday} · Late Lower`, { exact: true })).toBeVisible();

  await completeVisibleWorkout(page, "Do workout");
  await page.getByRole("link", { name: "Close workout" }).click();

  await goToTab(page, "Stats");
  await expect(page.getByRole("heading", { name: "Squat" })).toBeVisible();

  await goToTab(page, "Calendar");
  await expect(page.getByRole("link", { name: `Completed: ${programName} - Late Lower on ${dates.today}`, exact: true })).toBeVisible();
  const sessions = await (await page.request.get("/api/sessions")).json();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ status: "completed", date: dates.today, scheduled_date: dates.yesterday });
});
