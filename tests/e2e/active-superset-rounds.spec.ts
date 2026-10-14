import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { ProgramDocumentV1 } from "../../src/features/program-editor/document";
import type { WorkoutSet } from "../../src/components/workout-card-utils";
import { registerViaApi } from "./helpers";

type ActualWrite = { setId: number; actualReps: number | null; actualWeight: number | null; expectedActual: { reps: number | null; weight: number | null } };

async function startSupersets(page: Page) {
  await page.addInitScript(() => localStorage.setItem("install-help-dismissed", "1"));
  await registerViaApi(page, "superset-rounds");
  expect((await page.request.post("/api/settings", { data: { timezone: "UTC" } })).ok()).toBe(true);
  const document: ProgramDocumentV1 = {
    schemaVersion: 1, name: "Round logging", description: "", unit: "lb", cycles: 1,
    weekdays: [0, 1, 2, 3, 4, 5, 6], startDate: new Date().toISOString().slice(0, 10),
    weeks: [{ id: randomUUID(), name: "Week 1", block: "", deload: false, days: [{
      id: randomUUID(), name: "Full body pairs", exercises: [
        { name: "Squat", rounds: 3, weight: 135, reps: 5, group: "A" },
        { name: "Dumbbell row", rounds: 2, weight: 42.5, reps: 10, group: "A" },
        { name: "Pull-up", rounds: 1, weight: 0, reps: 6, group: "B" },
        { name: "Dumbbell press", rounds: 1, weight: 35, reps: 8, group: "B" },
        { name: "Calf raise", rounds: 1, weight: 20, reps: 12, group: "B" },
      ].map(({ name, rounds, weight, reps, group }) => ({
        id: randomUUID(), name, progressionKey: randomUUID(), baseLoad: weight, trainingMax: 0,
        notes: "", supersetGroup: group, rule: null,
        sets: Array.from({ length: rounds }, () => ({ id: randomUUID(), role: "work" as const,
          repMin: reps, repMax: reps, loadMode: name === "Pull-up" ? "bodyweight" as const : "working" as const,
          load: 0, effortKind: "rir" as const, effort: 2, restSeconds: 90, tempo: "2-0-1", notes: "Controlled reps",
        })),
      })),
    }] }],
  };
  const draft = `/api/program-drafts/${randomUUID()}`;
  expect((await page.request.put(draft, { data: { expectedRevision: 0, document } })).ok()).toBe(true);
  expect((await page.request.post(`${draft}/activate`, { data: { expectedRevision: 1 } })).ok()).toBe(true);
  await page.goto("/today");
  const started = page.waitForResponse(response => /\/api\/programs\/\d+\/sessions$/.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Start Workout", exact: true }).click();
  const response = await started;
  expect(response.ok()).toBe(true);
  const session = await response.json() as { id: number; sets: WorkoutSet[] };
  const pair = page.locator("[data-exercise-log-card]").filter({ has: page.getByRole("heading", { name: "Squat + Dumbbell row", exact: true }) });
  await expect(pair).toBeVisible();
  return { session, pair };
}

function roundAction(page: Page, action: "Save" | "Undo", round = 1) {
  return page.getByRole("button", { name: `${action} round ${round} of superset A`, exact: true });
}

async function stored(page: Page, id: number) {
  const response = await page.request.get(`/api/sessions/${id}`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ sets: WorkoutSet[]; status: string; loggedSets: number; volume: number }>;
}

test("active supersets interleave rounds and save or undo paired sets across Today and Calendar", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 375, height: 629 });
  const { session, pair } = await startSupersets(page);
  const squat = session.sets.filter(set => set.exercise_name === "Squat");
  const row = session.sets.filter(set => set.exercise_name === "Dumbbell row");
  await expect(pair.locator('[data-set-log-row] input')).toHaveCount(10);
  expect(await pair.locator('[data-set-log-row] input[aria-label$=" reps"]').evaluateAll(inputs => inputs.map(input => input.getAttribute("aria-label")))).toEqual([
    "Squat set 1a reps", "Dumbbell row set 1b reps", "Squat set 2a reps", "Dumbbell row set 2b reps", "Squat set 3a reps",
  ]);
  const triple = page.locator("[data-exercise-log-card]").filter({ has: page.getByRole("heading", { name: "Pull-up + Dumbbell press + Calf raise", exact: true }) });
  expect(await triple.locator('[data-set-log-row] input[aria-label$=" reps"]').evaluateAll(inputs => inputs.map(input => input.getAttribute("aria-label")))).toEqual([
    "Pull-up set 1a reps", "Dumbbell press set 1b reps", "Calf raise set 1c reps",
  ]);
  await expect(pair).toContainText("RIR 2");
  await expect(pair).toContainText("Tempo 2-0-1");
  await pair.getByRole("spinbutton", { name: "Squat set 1a weight (lb)", exact: true }).fill("137.5");
  await pair.getByRole("spinbutton", { name: "Dumbbell row set 1b reps", exact: true }).fill("9");
  const writes: ActualWrite[] = [];
  await page.route(`**/api/sessions/${session.id}/sets`, async route => {
    if (route.request().method() === "PUT") writes.push(route.request().postDataJSON());
    await route.continue();
  });
  await roundAction(page, "Save").click();
  await expect(roundAction(page, "Undo")).toHaveAttribute("aria-pressed", "true");
  expect(writes.map(write => write.setId)).toEqual([squat[0].id, row[0].id]);
  await expect(page.getByRole("progressbar", { name: "Saved sets", exact: true })).toHaveAttribute("value", "2");
  await pair.getByRole("button", { name: "Undo set 1a", exact: true }).click();
  await expect(roundAction(page, "Save")).toBeEnabled();
  await expect(pair.getByRole("button", { name: "Undo set 1b", exact: true })).toHaveAttribute("aria-pressed", "true");
  await roundAction(page, "Save").click();
  await expect(roundAction(page, "Undo")).toBeEnabled();
  expect(writes.map(write => write.setId)).toEqual([squat[0].id, row[0].id, squat[0].id, squat[0].id]);
  await roundAction(page, "Undo").click();
  await expect(pair.getByRole("button", { name: "Save set 1b", exact: true })).toBeEnabled();
  expect(writes.slice(-2).map(write => [write.setId, write.actualReps, write.actualWeight])).toEqual([[squat[0].id, null, null], [row[0].id, null, null]]);
  await expect(pair.getByRole("spinbutton", { name: "Squat set 1a weight (lb)", exact: true })).toHaveValue("137.5");
  await roundAction(page, "Save").click();
  await expect(roundAction(page, "Undo")).toBeEnabled();
  await pair.getByRole("spinbutton", { name: "Squat set 2a reps", exact: true }).fill("7");
  await pair.getByRole("button", { name: "Collapse Squat + Dumbbell row", exact: true }).click();
  await expect(pair).toContainText("Unsaved changes");
  await pair.getByRole("button", { name: "Expand Squat + Dumbbell row", exact: true }).click();
  await expect(pair.getByRole("spinbutton", { name: "Squat set 2a reps", exact: true })).toHaveValue("7");
  await roundAction(page, "Save", 2).click();
  await expect(roundAction(page, "Undo", 2)).toBeEnabled();
  await page.reload();
  await expect(roundAction(page, "Undo")).toBeEnabled();
  await expect(pair.getByRole("spinbutton", { name: "Squat set 2a reps", exact: true })).toHaveValue("7");
  const persisted = await stored(page, session.id);
  expect(persisted.sets.map(set => set.id)).toEqual(session.sets.map(set => set.id));
  expect(persisted.sets.find(set => set.id === squat[0].id)).toMatchObject({ actual_reps: 5, actual_weight: 137.5 });
  expect(persisted.sets.find(set => set.id === row[0].id)).toMatchObject({ actual_reps: 9, actual_weight: 42.5 });
  expect(persisted.sets.find(set => set.id === squat[2].id)?.actual_reps).toBeNull();
  for (const [width, height, fontSize, theme] of [[375, 629, 16, "light"], [393, 659, 16, "dark"], [375, 812, 20, "dark"], [1280, 900, 16, "light"]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ fontSize, theme }) => { document.documentElement.style.fontSize = `${fontSize}px`; document.documentElement.dataset.theme = theme; }, { fontSize, theme });
    await page.getByRole("group", { name: "Round 1 of superset A", exact: true }).evaluate(element => element.scrollIntoView({ block: "start" }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const field of [pair.getByRole("spinbutton", { name: "Squat set 1a weight (lb)", exact: true }), roundAction(page, "Undo")]) {
      const box = (await field.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: info.outputPath(`superset-rounds-${width}-${fontSize}.png`), animations: "disabled" });
  }
  await page.goto(`/workouts/${session.id}`);
  await page.getByRole("link", { name: "Resume planned workout", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(roundAction(page, "Undo")).toBeEnabled();
  await expect(pair.getByRole("spinbutton", { name: "Squat set 1a weight (lb)", exact: true })).toHaveValue("137.5");
  await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
  await expect.poll(async () => (await stored(page, session.id)).status).toBe("completed");
  expect((await stored(page, session.id)).loggedSets).toBe(4);
});

test("a partially saved round recovers a lost response after reload without rewriting its saved partner", async ({ page }, info) => {
  await page.setViewportSize({ width: 393, height: 659 });
  const { session, pair } = await startSupersets(page);
  const squat = session.sets.find(set => set.exercise_name === "Squat")!;
  const row = session.sets.find(set => set.exercise_name === "Dumbbell row")!;
  const writes: ActualWrite[] = [];
  let interrupted = false;
  await page.route(`**/api/sessions/${session.id}/sets`, async route => {
    if (route.request().method() !== "PUT") return route.continue();
    const body: ActualWrite = route.request().postDataJSON(); writes.push(body);
    if (body.setId === row.id && !interrupted) {
      interrupted = true;
      expect((await route.fetch()).ok()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await roundAction(page, "Save").click();
  await expect(pair.getByRole("button", { name: "Undo set 1a", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(pair.getByText("Save failed", { exact: true })).toBeVisible();
  await expect(roundAction(page, "Save")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Finish Workout", exact: true })).toBeDisabled();
  await page.reload();
  await expect(roundAction(page, "Save")).toBeEnabled();
  await expect(pair.getByRole("button", { name: "Undo set 1a", exact: true })).toHaveAttribute("aria-pressed", "true");
  await roundAction(page, "Save").click();
  await expect(roundAction(page, "Undo")).toBeEnabled();
  expect(writes.map(write => write.setId)).toEqual([squat.id, row.id, row.id]);
  expect(writes[2]).toEqual(writes[1]);
  const recovered = await stored(page, session.id);
  expect(recovered.loggedSets).toBe(2);
  expect(recovered.sets.map(set => set.id)).toEqual(session.sets.map(set => set.id));
  await expect(page.getByRole("button", { name: "Finish Workout", exact: true })).toBeEnabled();
  // A genuine concurrent change must block group save until the user chooses.
  await pair.getByRole("spinbutton", { name: "Dumbbell row set 1b weight (lb)", exact: true }).fill("45");
  expect((await page.request.put(`/api/sessions/${session.id}/sets`, { data: { setId: row.id, actualReps: 11, actualWeight: 50, expectedActual: { reps: 10, weight: 42.5 } } })).ok()).toBe(true);
  await roundAction(page, "Save").click();
  await expect(pair.getByText(/Saved elsewhere: 11 reps at 50 lb/)).toBeVisible();
  await expect(roundAction(page, "Save")).toBeDisabled();
  await pair.getByRole("button", { name: "Use saved values", exact: true }).click();
  await expect(roundAction(page, "Undo")).toBeEnabled();
  await expect(pair.getByRole("spinbutton", { name: "Dumbbell row set 1b weight (lb)", exact: true })).toHaveValue("50");
  await expect(page.getByText(/This set changed in another tab or device/)).toHaveCount(0);
  await page.getByRole("group", { name: "Round 1 of superset A", exact: true }).evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: info.outputPath("superset-round-recovered.png"), animations: "disabled" });
});
