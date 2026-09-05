import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { registerViaApi } from "./helpers";

function watchHydration(page: Page) {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" && /hydrat|server rendered/i.test(message.text())) hydrationErrors.push(message.text()); });
  return hydrationErrors;
}

function historyScreenshots(page: Page, testInfo: TestInfo) {
  return async (name: string) => {
    if (testInfo.project.name !== "mobile-safari") return;
    fs.mkdirSync(".playwright/production-goal", { recursive: true });
    await page.screenshot({ path: `.playwright/production-goal/history-${name}-iphone.png`, fullPage: true, animations: "disabled", caret: "initial" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  };
}

async function startPastWorkout(page: Page) {
  // Compile the dynamic detail and history surfaces before the browser connects to dev HMR.
  await page.request.get("/workouts/999999");
  await page.request.get("/workouts");
  await page.request.get("/history");
  await page.goto("/workouts/new?date=2026-09-01");
  await page.getByLabel("Workout name", { exact: true }).fill("September pull");
  await page.getByLabel("Workout units").selectOption("kg");
  await page.getByRole("button", { name: "Quick workout", exact: true }).click();
  await expect(page.getByRole("heading", { name: "September pull", exact: true })).toBeVisible();
}

test("past workout preserves lost add responses and structural edits through reload", async ({ page }, testInfo) => {
  const hydrationErrors = watchHydration(page);
  const shot = historyScreenshots(page, testInfo);
  await registerViaApi(page, "history-edit-recovery");
  await startPastWorkout(page);
  await page.getByRole("button", { name: "Add exercise", exact: true }).click();
  await page.getByLabel("New exercise name").fill("Dumbbell Row");
  await page.getByLabel("Weight", { exact: true }).fill("40");
  await shot("picker");
  await page.route("**/api/sessions/*/sets", async (route) => {
    if (route.request().method() === "POST") { expect((await route.fetch()).status()).toBe(201); await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "Add to workout", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry adding exercise" })).toBeVisible();
  await page.unroute("**/api/sessions/*/sets");
  const sessions = await (await page.request.get("/api/sessions")).json();
  const id = sessions[0].id;
  await expect(page).toHaveURL(new RegExp(`/workouts/${id}$`));
  await page.reload();
  await page.getByRole("button", { name: "Retry adding exercise" }).click();
  await expect(page.getByRole("spinbutton", { name: /Reps for set/ })).toHaveCount(3);
  await page.getByRole("button", { name: "Add exercise", exact: true }).click();
  await page.getByLabel("New exercise name").fill("Goblet Squat");
  await page.getByLabel("Sets", { exact: true }).fill("1");
  await page.getByLabel("Weight", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Add to workout", exact: true }).click();
  await page.getByRole("button", { name: "Edit workout", exact: true }).click();
  await page.getByRole("button", { name: "Move exercise 2 up" }).click();
  await page.getByRole("button", { name: "Remove exercise", exact: true }).first().click();
  await page.getByRole("button", { name: "Confirm remove exercise", exact: true }).click();
  await page.getByLabel("Exercise name 1", { exact: true }).fill("Cable Row");
  await page.getByLabel("Workout date", { exact: true }).fill("2026-09-02");
  await page.getByRole("button", { name: "Remove set 3", exact: true }).click();
  await page.getByRole("button", { name: "Confirm remove set", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Finish workout", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Edit workout", exact: true }).click();
  await expect(page.getByLabel("Workout date", { exact: true })).toHaveValue("2026-09-02");
  await shot("editor");
  await page.getByRole("button", { name: "Save workout changes", exact: true }).click();
  await expect(page.getByText("Cable Row", { exact: true })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: /Reps for set/ })).toHaveCount(2);
  await page.getByRole("button", { name: "Log set 1", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await shot("logging");
  await page.getByRole("button", { name: "Finish workout", exact: true }).click();
  await expect(page.getByText(/400 kg total/)).toBeVisible();
  await page.getByRole("link", { name: "View workout", exact: true }).click();
  await expect(page.getByText(/1 of 2 sets logged · 400 kg volume/)).toBeVisible();
  expect(hydrationErrors).toEqual([]);
});

test("create, log, finish, find, correct and repeat a past workout with a reusable routine", async ({ page }, testInfo) => {
  const hydrationErrors = watchHydration(page);
  const shot = historyScreenshots(page, testInfo);
  await registerViaApi(page, "history-complete-loop");
  await startPastWorkout(page);
  await page.getByRole("button", { name: "Add exercise", exact: true }).click();
  await page.getByLabel("New exercise name").fill("Cable Row");
  await page.getByLabel("Sets", { exact: true }).fill("2");
  await page.getByLabel("Weight", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Add to workout", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: /Reps for set/ })).toHaveCount(2);
  const id = Number(new URL(page.url()).pathname.split("/").at(-1));
  expect(Number.isInteger(id)).toBe(true);
  await page.getByRole("button", { name: "Log set 1", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish workout", exact: true }).click();
  await expect(page.getByText(/400 kg total/)).toBeVisible();
  await page.goto("/workouts");
  await expect(page.getByRole("heading", { name: "Workout history", exact: true })).toBeVisible();
  await page.locator(`a[href="/workouts/${id}"]`).click();
  await expect(page.getByText(/1 of 2 sets logged · 400 kg volume/)).toBeVisible();
  await page.getByRole("button", { name: "Correct workout", exact: true }).click();
  await page.getByLabel("Correct reps for set 1", { exact: true }).fill("8");
  await page.reload();
  await expect(page.getByLabel("Correct reps for set 1", { exact: true })).toHaveValue("8");
  await page.getByRole("button", { name: "Preview correction", exact: true }).click();
  await expect(page.getByText(/Future progression and completed downstream workouts remain unchanged/)).toBeVisible();
  const contrast = await page.getByRole("button", { name: "Save correction", exact: true }).evaluate((button) => ({ color: getComputedStyle(button).color, background: getComputedStyle(button).backgroundColor }));
  expect(contrast.color).not.toEqual(contrast.background);
  await shot("correction");
  await page.route("**/api/sessions/*/corrections", async (route) => { if (!route.request().postDataJSON().preview) { expect((await route.fetch()).status()).toBe(200); await route.abort("failed"); } else await route.continue(); });
  await page.getByRole("button", { name: "Save correction", exact: true }).click();
  await expect(page.getByRole("status").first()).toBeVisible();
  await page.unroute("**/api/sessions/*/corrections");
  await page.getByRole("button", { name: "Save correction", exact: true }).click();
  await expect(page.getByText(/1 of 2 sets logged · 320 kg volume/)).toBeVisible();
  await expect(page.getByText("Prescribed: 10 reps at 40 kg")).toHaveCount(2);
  const corrected = await (await page.request.get(`/api/sessions/${id}`)).json();
  expect(corrected.corrections).toHaveLength(1);
  await page.getByLabel("Routine name", { exact: true }).fill("Pull routine");
  await page.getByRole("button", { name: "Save as routine", exact: true }).click();
  await expect(page.getByText("Routine saved. Find it in Workout history.")).toBeVisible();
  await page.getByLabel("Repeat workout date", { exact: true }).fill("2026-09-04");
  await page.getByRole("button", { name: "Repeat workout", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Reps for set 1", exact: true })).toHaveValue("8");
  await expect(page.getByText("Not logged", { exact: true })).toHaveCount(2);
  await page.goto("/workouts");
  await expect(page.getByRole("heading", { name: "Workout history", exact: true })).toBeVisible();
  await expect(page.getByText("Pull routine · 1 exercise")).toBeVisible();
  expect(hydrationErrors).toEqual([]);
});

test("history and Stats preserve kg values and readable light and dark themes", async ({ page }, testInfo) => {
  const hydrationErrors = watchHydration(page);
  const shot = historyScreenshots(page, testInfo);
  await registerViaApi(page, "history-themes");
  // This visual journey has its own completed fixture; the complete UI loop is
  // exercised above and does not share a cumulative timeout with theme checks.
  const created = await page.request.post("/api/sessions", { data: { name: "September pull", date: "2026-09-02", unit: "kg", newWorkout: true, requestKey: randomUUID() } });
  expect(created.status()).toBe(201);
  const session = await created.json();
  const added = await page.request.post(`/api/sessions/${session.id}/sets`, { data: { name: "Cable Row", sets: 2, reps: 10, weight: 40, requestKey: randomUUID() } });
  expect(added.status()).toBe(201);
  const set = (await added.json()).sets[0];
  expect((await page.request.put(`/api/sessions/${session.id}/sets`, { data: { setId: set.id, actualReps: 8, actualWeight: 40 } })).ok()).toBe(true);
  expect((await page.request.patch(`/api/sessions/${session.id}`)).ok()).toBe(true);
  expect((await page.request.post("/api/workout-routines", { data: { sessionId: session.id, name: "Pull routine", requestKey: randomUUID() } })).status()).toBe(201);
  await page.goto("/workouts");
  await expect(page.getByRole("heading", { name: "Workout history", exact: true })).toBeVisible();
  await expect(page.getByText("Pull routine · 1 exercise")).toBeVisible();
  await expect(page.getByText("1/2 sets · 320 kg volume", { exact: true })).toBeVisible();
  await shot("list");
  await page.getByRole("navigation").getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.goto("/workouts");
  await shot("list-dark");
  await page.getByRole("navigation").getByRole("link", { name: "Stats", exact: true }).click();
  await expect(page.getByText(/Combined volume, loads and estimated maxes use lb equivalent/)).toBeVisible();
  await shot("stats");
  expect(hydrationErrors).toEqual([]);
});
