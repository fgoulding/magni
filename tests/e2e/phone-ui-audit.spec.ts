import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { registerViaApi } from "./helpers";

for (const kind of ["quick", "planned"] as const) {
  test(`${kind} exercise entry keeps decimal weights readable on both phones`, async ({ page }, info) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript(() => localStorage.setItem("install-help-dismissed", "1"));
    await registerViaApi(page, `phone-input-${kind}`);
    let sessionId: number;
    if (kind === "quick") {
      const response = await page.request.post("/api/sessions", { data: { name: "Phone input check", date: "2026-10-11", unit: "kg", newWorkout: true, requestKey: randomUUID() } });
      expect(response.status()).toBe(201);
      sessionId = (await response.json()).id;
      await page.goto(`/workouts/${sessionId}`);
    } else {
      const program = await (await page.request.post("/api/programs", { data: { name: "Phone input check", numWeeks: 2 } })).json();
      const day = await (await page.request.post(`/api/programs/${program.id}/days`, { data: { name: "Strength" } })).json();
      expect((await page.request.post(`/api/days/${day.id}/exercises`, { data: { name: "Squat", trainingMax: 100, progressionType: "linear" } })).ok()).toBe(true);
      const response = await page.request.post(`/api/programs/${program.id}/sessions`, { data: { dayId: day.id, weekNumber: 1 } });
      expect(response.status()).toBe(201);
      sessionId = (await response.json()).id;
      await page.goto(`/workouts/${sessionId}/resume`);
    }
    await page.getByRole("button", { name: "Add exercise", exact: true }).click();
    await page.getByLabel("New exercise name", { exact: true }).fill("Dumbbell row");
    const weight = page.getByRole("spinbutton", { name: "Weight", exact: true });
    await weight.fill("225.25");
    for (const width of [375, 393]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 852 });
      for (const fontSize of [16, 20, 32]) {
        await page.evaluate(fontSize => {
          document.documentElement.style.fontSize = `${fontSize}px`;
          document.documentElement.dataset.theme = fontSize === 16 ? "light" : "dark";
          document.documentElement.style.setProperty("--safe-bottom", "34px", "important");
        }, fontSize);
        await weight.evaluate(input => input.scrollIntoView({ block: "center" }));
        await page.screenshot({ path: info.outputPath(`${kind}-${width}-text-${fontSize}.png`), animations: "disabled" });
        const sizes = await weight.evaluate(input => {
          const style = getComputedStyle(input);
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d")!;
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          return {
            available: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            needed: context.measureText((input as HTMLInputElement).value).width,
            height: input.getBoundingClientRect().height,
            font: parseFloat(style.fontSize),
          };
        });
        expect.soft(sizes.available).toBeGreaterThanOrEqual(sizes.needed + 4);
        expect(sizes.height).toBeGreaterThanOrEqual(44);
        expect(sizes.font).toBeGreaterThanOrEqual(16);
        expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
    await expect(weight.locator("..")).toContainText(kind === "quick" ? "Weight (kg)" : "Weight (lb)");
    await page.getByRole("button", { name: "Add to workout", exact: true }).click();
    await expect(page.getByLabel("New exercise name", { exact: true })).toBeHidden();
    const saved = await (await page.request.get(`/api/sessions/${sessionId}`)).json();
    const added = saved.sets.filter((set: { exercise_name: string }) => set.exercise_name === "Dumbbell row");
    expect(added).toHaveLength(3);
    for (const set of added) expect(set).toMatchObject({ reps: 10, calculated_weight: 225.25 });
  });
}

test("Calendar context survives quick creation, reload, completion and the recap link", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await registerViaApi(page, "calendar-quick-return");
  const returnTo = "/calendar?month=2026-09&date=2026-09-02&view=month";
  await page.goto(`/workouts/new?date=2026-09-02&returnTo=${encodeURIComponent(returnTo)}`);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Calendar", exact: true })).toHaveAttribute("aria-current", "page");
  const creating = page.waitForResponse(response => response.url().endsWith("/api/sessions") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Quick workout", exact: true }).click();
  const created = await creating;
  expect(created.status()).toBe(201);
  const session = await created.json();
  await expect.poll(() => new URL(page.url()).searchParams.get("returnTo")).toBe(returnTo);
  const adding = await page.request.post(`/api/sessions/${session.id}/sets`, { data: { name: "Row", prescription: [{ reps: 10, weight: 40 }], requestKey: randomUUID() } });
  expect(adding.ok()).toBe(true);
  const set = (await adding.json()).sets[0];
  expect((await page.request.put(`/api/sessions/${session.id}/sets`, { data: { setId: set.id, actualReps: 10, actualWeight: 40 } })).ok()).toBe(true);
  await page.reload();
  await expect(nav.getByRole("link", { name: "Calendar", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Finish workout", exact: true }).click();
  const details = page.getByRole("link", { name: "View workout", exact: true });
  await expect(details).toHaveAttribute("href", `/workouts/${session.id}?returnTo=${encodeURIComponent(returnTo)}`);
  await details.click();
  await page.getByRole("link", { name: "← Back to Calendar", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?month=2026-09&date=2026-09-02&view=month$`));
});

test("exercise search reuses an older lift beyond the initial recent list with its identity and converted load", async ({ page }) => {
  await registerViaApi(page, "older-exercise-search");
  for (const older of [true, false]) {
    const response = await page.request.post("/api/sessions", { data: { name: "Search history", date: older ? "2026-09-01" : "2026-09-02", unit: "kg", newWorkout: true, requestKey: randomUUID() } });
    expect(response.status()).toBe(201);
    const session = await response.json();
    const names = older ? ["Old cable row"] : Array.from({ length: 30 }, (_, index) => `Accessory ${index + 1}`);
    for (const name of names) {
      const added = await page.request.post(`/api/sessions/${session.id}/sets`, { data: { name, prescription: [{ reps: 10, weight: 40 }], requestKey: randomUUID() } });
      expect(added.status()).toBe(201);
      const set = (await added.json()).sets[0];
      expect((await page.request.put(`/api/sessions/${session.id}/sets`, { data: { setId: set.id, actualReps: 10, actualWeight: 40 } })).ok()).toBe(true);
    }
    expect((await page.request.patch(`/api/sessions/${session.id}`)).ok()).toBe(true);
  }
  const initial = await (await page.request.get("/api/sessions/recent-exercises?unit=lb")).json();
  expect(initial).toHaveLength(30);
  expect(initial.some((item: { name: string }) => item.name === "Old cable row")).toBe(false);
  const old = (await (await page.request.get("/api/sessions/recent-exercises?unit=lb&q=Old%20cable%20row")).json())[0];
  expect(old.sets).toEqual([{ reps: 10, weight: 88.1849 }]);
  const created = await page.request.post("/api/sessions", { data: { name: "Reuse older lift", date: "2026-10-11", unit: "lb", newWorkout: true, requestKey: randomUUID() } });
  expect(created.status()).toBe(201);
  const current = await created.json();
  await page.goto(`/workouts/${current.id}`);
  await page.getByRole("button", { name: "Add exercise", exact: true }).click();
  await page.getByLabel("New exercise name", { exact: true }).fill("Old cable row");
  // A restored name should run the same server search after navigation/reload.
  await page.reload();
  await expect(page.getByLabel("New exercise name", { exact: true })).toHaveValue("Old cable row");
  const adding = page.waitForResponse(response => response.url().endsWith(`/api/sessions/${current.id}/sets`) && response.request().method() === "POST");
  await page.getByRole("button", { name: /^Old cable row/ }).click();
  const added = await adding;
  expect(added.ok()).toBe(true);
  expect(added.request().postDataJSON()).toMatchObject({ name: old.name, catalogExerciseId: old.catalogExerciseId, prescription: old.sets });
  const saved = await (await page.request.get(`/api/sessions/${current.id}`)).json();
  expect(saved.sets).toHaveLength(1);
  expect(saved.sets[0]).toMatchObject({ exercise_name: "Old cable row", reps: 10, calculated_weight: 88.1849, actual_reps: null });
});
