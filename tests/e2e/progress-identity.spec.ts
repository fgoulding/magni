import { randomUUID } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { registerViaApi } from "./helpers";

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

async function record(page: Page, name: string, date: string, weight: number) {
  const created = await page.request.post("/api/sessions", { data: { name: "Training", date, unit: "lb", newWorkout: true, requestKey: randomUUID() } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const added = await page.request.post(`/api/sessions/${id}/sets`, { data: { name, sets: 1, reps: 5, weight, requestKey: randomUUID() } });
  expect(added.status()).toBe(201);
  const { sets } = await added.json();
  expect((await page.request.put(`/api/sessions/${id}/sets`, { data: { setId: sets[0].id, actualReps: 5, actualWeight: weight } })).ok()).toBe(true);
  expect((await page.request.patch(`/api/sessions/${id}`)).ok()).toBe(true);
  return id as number;
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 659 });
  await page.addInitScript(() => localStorage.setItem("install-help-dismissed", "1"));
});

test("primary lifts lead the chooser without opening the keyboard or requiring favorites", async ({ page }, info) => {
  await registerViaApi(page, "primary-progress");
  await record(page, "Squat", daysAgo(150), 185);
  await record(page, "Bench press", daysAgo(120), 135);
  await record(page, "Deadlift", daysAgo(5), 225);
  await record(page, "Lateral raise", daysAgo(2), 15);
  await page.goto("/history");
  await page.getByRole("link", { name: "One exercise", exact: true }).click();
  await capture(page, info, "primary-default");
  const trigger = page.getByRole("button", { name: "Choose exercise", exact: true });
  await expect(trigger).toContainText("Squat");
  await expect(page.getByRole("combobox", { name: "Period", exact: true })).toHaveValue("all");
  for (const [name, width, height, fontSize] of [["mini", 375, 629, 16], ["iphone16", 393, 659, 16], ["enlarged", 393, 659, 20], ["double-text", 393, 659, 32]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; document.documentElement.dataset.theme = size > 16 ? "dark" : "light"; }, fontSize);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Choose exercise", exact: true });
    const choices = dialog.getByTestId("exercise-choice");
    await expect(choices).toHaveCount(3);
    for (const [index, label] of ["Squat", "Bench", "Deadlift"].entries()) {
      await expect(choices.nth(index)).toContainText(label);
      const box = await choices.nth(index).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(dialog.getByRole("searchbox")).not.toBeFocused();
    await capture(page, info, `chooser-${name}`);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
  await trigger.click();
  await page.getByRole("dialog", { name: "Choose exercise" }).getByTestId("exercise-choice").nth(2).click();
  await expect(trigger).toContainText("Deadlift");
  await record(page, "Newest accessory", daysAgo(1), 10);
  await page.reload();
  await expect(trigger).toContainText("Deadlift");
});

test("typed Deadlift history connects across dates without pins and future sessions extend the same graph", async ({ page }, info) => {
  await registerViaApi(page, "connected-deadlift");
  const sessions = [await record(page, "Deadlift", daysAgo(150), 185), await record(page, "Dead lift", daysAgo(9), 205), await record(page, "deadlift", daysAgo(2), 225)];
  await record(page, "Romanian deadlift", daysAgo(1), 135);
  const before = await Promise.all(sessions.map(async id => (await page.request.get(`/api/sessions/${id}`)).json()));
  const found = await (await page.request.get("/api/progress/exercises?q=deadlift&sort=name")).json();
  const deadlift = found.items.find((item: { name: string }) => item.name.toLowerCase() === "deadlift");
  expect(deadlift).toMatchObject({ kind: "exercise", historyCount: 3, exercise: { sessionCount: 3, pinned: false } });
  await page.goto("/history");
  await page.getByRole("link", { name: "One exercise", exact: true }).click();
  await capture(page, info, "connected-all-time");
  await expect(page.getByRole("button", { name: "Choose exercise", exact: true })).toContainText("Deadlift");
  await expect(page.getByRole("region", { name: "Exercise chart", exact: true })).toBeVisible();
  const dates = await page.getByRole("region", { name: "Exercise chart", exact: true }).locator('svg text[y="158"]').evaluateAll(labels => labels.map(label => {
    const box = label.getBoundingClientRect(); return { left: box.left, right: box.right };
  }));
  for (let index = 1; index < dates.length; index++) expect(dates[index].left - dates[index - 1].right).toBeGreaterThan(4);
  await expect(page.getByRole("link", { name: "All recorded workouts (3)", exact: true })).toBeVisible();
  const period = page.getByRole("combobox", { name: "Period", exact: true });
  await period.selectOption("12w");
  await expect(page).toHaveURL(/period=12w/);
  const filteredHref = page.url();
  await page.getByRole("link", { name: /^All recorded workouts/ }).click();
  expect(new URL(page.url()).searchParams.has("from")).toBe(false);
  expect(new URL(page.url()).searchParams.has("to")).toBe(false);
  await page.getByRole("link", { name: "Back to Progress", exact: true }).click();
  await expect(page).toHaveURL(filteredHref);
  await expect(period).toHaveValue("12w");
  const exerciseId = deadlift.exercise.id;
  for (const pinned of [true, false]) {
    expect((await page.request.post("/api/progress/pins", { data: { exerciseId, pinned } })).ok()).toBe(true);
    const result = await (await page.request.get("/api/progress/exercises?q=deadlift&sort=name")).json();
    expect(result.items.find((item: { key: string }) => item.key === deadlift.key)).toMatchObject({ historyCount: 3 });
  }
  await record(page, " DEADLIFT ", daysAgo(0), 235);
  await page.goto(`/history?exercise=${encodeURIComponent(deadlift.key)}&period=all`);
  await expect(page.getByRole("link", { name: "All recorded workouts (4)", exact: true })).toBeVisible();
  const oldNameKey = `u:${Buffer.from("deadlift").toString("base64url")}`;
  await page.goto(`/history?exercise=${encodeURIComponent(oldNameKey)}&period=all`);
  await expect(page.getByRole("region", { name: "Exercise chart", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "All recorded workouts (4)", exact: true })).toBeVisible();
  const after = await Promise.all(sessions.map(async id => (await page.request.get(`/api/sessions/${id}`)).json()));
  expect(after).toEqual(before);
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await capture(page, info, "connected-dark");
});

test("deliberately separated primary histories stay discoverable instead of looking empty", async ({ page }, info) => {
  await registerViaApi(page, "separate-primary");
  await record(page, "Deadlift", daysAgo(150), 185);
  const second = await record(page, "Dead lift", daysAgo(2), 225);
  const found = await (await page.request.get("/api/progress/exercises?q=deadlift")).json();
  const candidates = await (await page.request.get(`/api/progress/exercises?exerciseId=${found.items[0].exercise.id}&candidates=1`)).json();
  const separate = { mode: "detach", observationIds: [candidates.items.find((item: { sessionId: number }) => item.sessionId === second).id] };
  const preview = await (await page.request.post("/api/progress/identity", { data: { action: "preview", ...separate } })).json();
  const applied = await page.request.post("/api/progress/identity", { data: { action: "apply", ...separate, previewToken: preview.token, requestKey: randomUUID() } });
  expect(applied.ok()).toBe(true);
  const change = await applied.json();
  await page.goto("/history?view=exercise&period=4w&metric=reps");
  const trigger = page.getByRole("button", { name: "Choose exercise", exact: true });
  await expect(trigger).toContainText("Deadlift");
  await expect(page.getByRole("heading", { name: "Choose a variation", exact: true })).toBeVisible();
  await trigger.click();
  const choices = page.getByRole("dialog", { name: "Choose exercise", exact: true }).getByTestId("exercise-choice");
  await expect(choices.nth(0)).toContainText("No recorded history");
  await expect(choices.nth(2)).toContainText("Choose a variation");
  await choices.nth(2).click();
  await expect(page).toHaveURL(/exercise=p%3Adeadlift/);
  const progressHref = page.url();
  await capture(page, info, "separate-primary");
  await page.getByRole("link", { name: "Browse variations", exact: true }).click();
  await expect(page).toHaveURL(/q=dead/);
  expect(new URL(page.url()).searchParams.has("period")).toBe(false);
  expect(new URL(page.url()).searchParams.has("from")).toBe(false);
  await expect(page.getByTestId("progress-exercise-row")).not.toHaveCount(0);
  await page.getByRole("link", { name: "Back to Progress", exact: true }).click();
  await expect(page).toHaveURL(progressHref);
  await expect(page.getByRole("combobox", { name: "Period", exact: true })).toHaveValue("4w");
  expect(new URL(page.url()).searchParams.get("metric")).toBe("reps");
  expect((await page.request.post("/api/progress/identity", { data: { action: "undo", changeId: change.changeId, requestKey: randomUUID() } })).ok()).toBe(true);
  await record(page, "Dead lift", daysAgo(0), 235);
  await page.goto("/history");
  await page.getByRole("link", { name: "One exercise", exact: true }).click();
  await expect(page.getByRole("link", { name: "All recorded workouts (3)", exact: true })).toBeVisible();
});
