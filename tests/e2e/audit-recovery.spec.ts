import { expect, test } from "@playwright/test";
import { registerViaApi } from "./helpers";

test("a lost add-set response replays the original command after editing and reloading", async ({ page }, info) => {
  await registerViaApi(page, "immutable-append");
  const created = await page.request.post("/api/sessions", {
    data: { name: "Append recovery", newWorkout: true, requestKey: crypto.randomUUID() },
  });
  expect(created.ok()).toBe(true);
  const session = await created.json() as { id: number };
  const endpoint = `/api/sessions/${session.id}/sets`;
  const added = await page.request.post(endpoint, {
    data: { name: "Dumbbell row", sets: 1, reps: 6, weight: 40, requestKey: crypto.randomUUID() },
  });
  expect(added.ok()).toBe(true);
  await page.goto(`/workouts/${session.id}`);
  await page.getByRole("button", { name: "Edit workout", exact: true }).click();
  const attempts: string[] = [];
  await page.route(`**${endpoint}`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push(route.request().postData()!);
    const committed = await route.fetch();
    expect(committed.status()).toBe(201);
    if (attempts.length <= 2) await route.abort("failed");
    else await route.fulfill({ response: committed });
  });
  await page.getByRole("button", { name: "Add similar set", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry add set", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Hide workout editor", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Reps for set 1", exact: true }).fill("8");
  await page.getByRole("button", { name: "Save set 1", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  // Retry before reload so mutable source actuals differ from the original
  // command. Lose this acknowledgement too, then recover across a remount.
  await page.getByRole("button", { name: "Edit workout", exact: true }).click();
  await page.getByRole("button", { name: "Retry add set", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry add set", exact: true })).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: "Edit workout", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry add set", exact: true })).toBeEnabled();
  if (info.project.name === "mobile-safari") {
    for (const width of [375, 393]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 852 });
      await page.screenshot({ path: info.outputPath(`append-recovery-${width}.png`), fullPage: true, animations: "disabled" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
  await page.getByRole("button", { name: "Retry add set", exact: true }).click();
  await expect(page.getByRole("button", { name: "Finish workout", exact: true })).toBeEnabled();
  expect(attempts).toHaveLength(3);
  expect(attempts[1]).toBe(attempts[0]);
  expect(attempts[2]).toBe(attempts[0]);
  const saved = await page.request.get(`/api/sessions/${session.id}`);
  expect(saved.ok()).toBe(true);
  const workout = await saved.json() as { sets: { reps: number; actual_reps: number | null }[] };
  expect(workout.sets).toHaveLength(2);
  expect(workout.sets.map(set => set.reps)).toEqual([6, 6]);
  expect(workout.sets[0].actual_reps).toBe(8);
});

test("a lost Calendar duplicate response is recovered once after reload", async ({ page }, info) => {
  await registerViaApi(page, "calendar-command-recovery");
  const programResponse = await page.request.post("/api/programs", { data: { name: "Recovery strength", numWeeks: 2 } });
  expect(programResponse.ok()).toBe(true);
  const program = await programResponse.json() as { id: number };
  const dayResponse = await page.request.post(`/api/programs/${program.id}/days`, { data: { name: "Lower" } });
  expect(dayResponse.ok()).toBe(true);
  const day = await dayResponse.json() as { id: number };
  expect((await page.request.post(`/api/days/${day.id}/exercises`, {
    data: { name: "Squat", trainingMax: 200, progressionType: "linear" },
  })).ok()).toBe(true);
  expect((await page.request.put(`/api/programs/${program.id}`, {
    data: { scheduleWeekdays: [0, 1, 2, 3, 4, 5, 6], startDate: "2090-06-05" },
  })).ok()).toBe(true);
  await page.goto("/calendar?month=2090-06&date=2090-06-05");
  const attempts: string[] = [];
  let releaseRetry!: () => void;
  const heldRetry = new Promise<void>(resolve => { releaseRetry = resolve; });
  await page.route("**/api/calendar/actions", async route => {
    const body = route.request().postDataJSON() as { type: string; preview?: boolean };
    if (body.type !== "duplicate" || body.preview) return route.continue();
    attempts.push(route.request().postData()!);
    const committed = await route.fetch();
    expect(committed.ok()).toBe(true);
    if (attempts.length === 1) await route.abort("failed");
    else { await heldRetry; await route.fulfill({ response: committed }); }
  });
  await page.locator('[data-calendar-date="2090-06-05"]').getByRole("button", { name: "More options for Lower" }).click();
  await page.getByRole("button", { name: "Duplicate workout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Fri, Jun 9", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry calendar change", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry calendar change", exact: true })).toBeEnabled();
  if (info.project.name === "mobile-safari") {
    for (const width of [375, 393]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 852 });
      await page.screenshot({ path: info.outputPath(`calendar-recovery-${width}.png`), fullPage: true, animations: "disabled" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
  const otherTab = await page.context().newPage();
  await otherTab.goto("/calendar?month=2090-06&date=2090-06-05");
  expect(await otherTab.evaluate(() => !!navigator.locks)).toBe(true);
  try {
    await page.getByRole("button", { name: "Retry calendar change", exact: true }).click();
    await expect.poll(() => attempts.length).toBe(2);
    await otherTab.getByRole("button", { name: "Retry calendar change", exact: true }).click();
    await expect(otherTab.getByText("Another tab is confirming a calendar change. Retry when it finishes.", { exact: true })).toBeVisible();
  } finally {
    releaseRetry();
    await otherTab.close();
  }
  await expect(page.getByRole("button", { name: "Retry calendar change", exact: true })).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toBe(attempts[0]);
  await expect(page.locator('[data-calendar-date="2090-06-09"]').locator("article")).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-calendar-date="2090-06-09"]').locator("article")).toHaveCount(1);
});
