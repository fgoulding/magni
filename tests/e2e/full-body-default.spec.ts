import { expect, test } from "@playwright/test";
import { registerViaApi } from "./helpers";

test("full body default survives editing, reload and activation with all three supersets", async ({ page }, info) => {
  test.setTimeout(120_000);
  await registerViaApi(page, "full-body-default");
  await page.goto("/programs/new");
  const starter = page.getByRole("region", { name: "Ready programs" });
  await expect(starter).toContainText("Full Body Supersets 3-Day");
  await page.screenshot({ path: info.outputPath("default-program-starter.png"), fullPage: true });
  // The chooser opens the shared builder. Keep direct advanced authoring coverage too.
  await expect(starter.getByRole("link").filter({ hasText: "Full Body Supersets 3-Day" })).toHaveAttribute("href", "/programs/editor/new?template=full-body-supersets-3-day");
  await page.goto("/programs/editor/new?preset=full-body-supersets-3-day&advanced=1");
  await expect(page.getByLabel("Program name", { exact: true })).toHaveValue("Full Body Supersets 3-Day");
  await page.getByLabel("Program name", { exact: true }).fill("My full body program");
  await page.getByRole("button", { name: "Prescriptions", exact: true }).click();
  await expect(page.getByLabel("Set 5 minimum reps", { exact: true })).toHaveValue("4");
  await page.getByLabel("Working load (lb)", { exact: true }).fill("135");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  const draftUrl = page.url();
  const draftId = new URL(draftUrl).pathname.split("/").at(-1)!;
  await page.reload();
  await expect(page.getByLabel("Program name", { exact: true })).toHaveValue("My full body program");
  await page.getByRole("button", { name: "Prescriptions", exact: true }).click();
  await expect(page.getByLabel("Working load (lb)", { exact: true })).toHaveValue("135");
  const draftResponse = await page.request.get(`/api/program-drafts/${draftId}`);
  expect(draftResponse.ok()).toBe(true);
  const { document } = await draftResponse.json();
  expect(document.cycles).toBe(4);
  expect(document.weekdays).toEqual([1, 3, 5]);
  expect(document.weeks[0].days).toHaveLength(3);
  for (const day of document.weeks[0].days) {
    expect(day.exercises).toHaveLength(6);
    expect(day.exercises.map((exercise: { sets: unknown[] }) => exercise.sets.length)).toEqual([5, 5, 5, 5, 3, 3]);
    expect(day.exercises.map((exercise: { supersetGroup: string }) => exercise.supersetGroup)).toEqual(["A", "A", "B", "B", "C", "C"]);
  }
  await page.screenshot({ path: info.outputPath("default-program-prescriptions.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Review & activate", exact: true }).click();
  // Ensure the first workout is reachable today regardless of the CI weekday.
  for (const weekday of ["Sun", "Tue", "Thu", "Sat"]) await page.getByRole("button", { name: weekday, exact: true }).click();
  await page.getByRole("button", { name: "Activate program", exact: true }).click();
  await page.getByRole("link", { name: "Train this program" }).click();
  const started = page.waitForResponse(response => /\/api\/programs\/\d+\/sessions$/.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Start Workout", exact: true }).click();
  const response = await started;
  expect(response.ok()).toBe(true);
  const session = await response.json();
  expect(session.sets).toHaveLength(26);
  const spoto = session.sets.filter((set: { exercise_name: string }) => /Spoto/.test(set.exercise_name));
  expect(spoto).toHaveLength(5);
  for (const set of spoto) {
    const metadata = JSON.parse(set.editor_json);
    expect(metadata.set.repMin).toBe(6);
    expect(metadata.set.repMax).toBe(8);
    expect(metadata.set.notes).toBe("");
    expect(metadata.set.tempo).toBe("1-second hover pause");
  }
  await expect(page.getByRole("heading", { name: "Barbell back squat + One-arm dumbbell row", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("default-program-workout.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("default starter stays readable on both phone sizes", async ({ page }, info) => {
  await registerViaApi(page, "full-body-default-phones");
  for (const [width, height] of [[375, 812], [393, 852]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/programs/new");
    const starter = page.getByRole("region", { name: "Ready programs" });
    await expect(starter.getByRole("link").filter({ hasText: "Full Body Supersets 3-Day" })).toBeVisible();
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.fontSize = "20px"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const useProgram = starter.getByRole("link").filter({ hasText: "Full Body Supersets 3-Day" });
    await useProgram.scrollIntoViewIfNeeded();
    await useProgram.click({ trial: true });
    await page.screenshot({ path: info.outputPath(`default-program-${width}.png`) });
  }
});
