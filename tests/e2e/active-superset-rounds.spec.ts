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

function roundToggle(page: Page, action: "Expand" | "Collapse", round = 1) {
  return page.getByRole("button", { name: `${action} Round ${round} of superset A`, exact: true });
}

async function stored(page: Page, id: number) {
  const response = await page.request.get(`/api/sessions/${id}`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ sets: WorkoutSet[]; status: string; loggedSets: number; volume: number }>;
}

test("active supersets auto-collapse after saving and reopen without undo across Today and Calendar", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 375, height: 629 });
  const { session, pair } = await startSupersets(page);
  const save = async (label: string) => {
    await pair.getByRole("button", { name: `Save set ${label}`, exact: true }).click();
    await expect(pair.getByRole("button", { name: `Undo set ${label}`, exact: true, pressed: true, includeHidden: true })).toHaveAttribute("aria-pressed", "true");
  };
  const undo = async (label: string) => {
    await pair.getByRole("button", { name: `Undo set ${label}`, exact: true }).click();
    await expect(pair.getByRole("button", { name: `Save set ${label}`, exact: true })).toBeEnabled();
  };
  await expect(page.getByRole("button", { name: /^(Save|Undo) round / })).toHaveCount(0);
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
  await expect(pair.getByText("Controlled reps", { exact: true }).first()).toBeHidden();
  await pair.getByText("Details", { exact: true }).click();
  await expect(pair.getByText("Controlled reps", { exact: true }).first()).toBeVisible();
  await pair.getByText("Details", { exact: true }).click();
  await pair.getByRole("spinbutton", { name: "Squat set 1a weight (lb)", exact: true }).fill("137.5");
  await pair.getByRole("spinbutton", { name: "Dumbbell row set 1b reps", exact: true }).fill("9");
  const writes: ActualWrite[] = [];
  await page.route(`**/api/sessions/${session.id}/sets`, async route => {
    if (route.request().method() === "PUT") writes.push(route.request().postDataJSON());
    await route.continue();
  });
  await save("1a");
  await expect(roundToggle(page, "Collapse")).toHaveAttribute("aria-expanded", "true");
  // Keyboard activation exercises focus recovery when the saved control hides.
  await pair.getByRole("button", { name: "Save set 1b", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(roundToggle(page, "Expand")).toContainText("2/2 saved");
  await expect(roundToggle(page, "Expand")).toBeFocused();
  expect(writes.map(write => write.setId)).toEqual([squat[0].id, row[0].id]);
  await expect(page.getByRole("progressbar", { name: "Saved sets", exact: true })).toHaveAttribute("value", "2");
  // Looking at or hiding completed work never changes the logged sets.
  await expect(roundToggle(page, "Expand")).toHaveAttribute("aria-expanded", "false");
  await expect(roundToggle(page, "Expand")).toContainText("Squat");
  await page.screenshot({ path: info.outputPath("auto-collapsed-mini.png"), animations: "disabled" });
  await expect(pair.locator('input[aria-label="Squat set 1a weight (lb)"]')).toBeHidden();
  await expect(pair.locator('input[aria-label="Squat set 1a weight (lb)"]')).toHaveValue("137.5");
  await roundToggle(page, "Expand").click();
  expect(writes).toHaveLength(2);
  await pair.getByRole("spinbutton", { name: "Squat set 2a reps", exact: true }).fill("6");
  await expect(roundToggle(page, "Collapse")).toHaveAttribute("aria-expanded", "true");
  expect(writes).toHaveLength(2);
  await expect(pair.getByRole("button", { name: "Undo set 1a", exact: true })).toHaveAttribute("aria-pressed", "true");
  await undo("1a");
  await expect(roundToggle(page, "Collapse")).toContainText("1/2 saved");
  await expect(pair.getByRole("button", { name: "Undo set 1b", exact: true })).toHaveAttribute("aria-pressed", "true");
  await save("1a");
  await expect(roundToggle(page, "Expand")).toContainText("2/2 saved");
  expect(writes.map(write => write.setId)).toEqual([squat[0].id, row[0].id, squat[0].id, squat[0].id]);
  await roundToggle(page, "Expand").click();
  await undo("1a"); await undo("1b");
  expect(writes.slice(-2).map(write => [write.setId, write.actualReps, write.actualWeight])).toEqual([[squat[0].id, null, null], [row[0].id, null, null]]);
  await expect(pair.getByRole("spinbutton", { name: "Squat set 1a weight (lb)", exact: true })).toHaveValue("137.5");
  await save("1a"); await save("1b");
  await pair.getByRole("spinbutton", { name: "Squat set 2a reps", exact: true }).fill("7");
  const writesBeforeCollapse = writes.length;
  await roundToggle(page, "Collapse", 2).click();
  await expect(roundToggle(page, "Expand", 2)).toContainText("Unsaved changes");
  await expect(pair.locator('input[aria-label="Squat set 2a reps"]')).toBeHidden();
  await pair.getByRole("button", { name: "Collapse Squat + Dumbbell row · Superset A", exact: true }).click();
  await expect(pair).toContainText("Unsaved changes");
  await pair.getByRole("button", { name: "Expand Squat + Dumbbell row · Superset A", exact: true }).click();
  await expect(roundToggle(page, "Expand", 2)).toHaveAttribute("aria-expanded", "false");
  await roundToggle(page, "Expand", 2).click();
  await expect(pair.getByRole("spinbutton", { name: "Squat set 2a reps", exact: true })).toHaveValue("7");
  expect(writes).toHaveLength(writesBeforeCollapse);
  await save("2a"); await save("2b");
  await expect(roundToggle(page, "Expand", 2)).toContainText("2/2 saved");
  await page.reload();
  await expect(roundToggle(page, "Collapse")).toContainText("2/2 saved");
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
    for (const field of [pair.getByRole("spinbutton", { name: "Squat set 1a weight (lb)", exact: true }), roundToggle(page, "Collapse")]) {
      const box = (await field.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: info.outputPath(`superset-rounds-${width}-${fontSize}.png`), animations: "disabled" });
    await roundToggle(page, "Collapse").click();
    await roundToggle(page, "Expand").evaluate(element => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: info.outputPath(`superset-rounds-closed-${width}-${fontSize}.png`), animations: "disabled" });
    await roundToggle(page, "Expand").click();
  }
  await page.goto(`/workouts/${session.id}`);
  await page.getByRole("link", { name: "Resume planned workout", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(roundToggle(page, "Collapse")).toContainText("2/2 saved");
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
  await pair.getByRole("button", { name: "Save set 1a", exact: true }).click();
  await expect(pair.getByRole("button", { name: "Undo set 1a", exact: true })).toHaveAttribute("aria-pressed", "true");
  await pair.getByRole("button", { name: "Save set 1b", exact: true }).click();
  await expect(pair.getByText("Save failed", { exact: true })).toBeVisible();
  await roundToggle(page, "Collapse").click();
  await expect(roundToggle(page, "Expand")).toContainText("Save failed");
  await expect(page.getByRole("button", { name: "Finish Workout", exact: true })).toBeDisabled();
  await page.reload();
  await expect(roundToggle(page, "Collapse")).toContainText("1/2 saved");
  await expect(pair.getByRole("button", { name: "Undo set 1a", exact: true })).toHaveAttribute("aria-pressed", "true");
  await pair.getByRole("button", { name: "Save set 1b", exact: true }).click();
  await expect(roundToggle(page, "Expand")).toContainText("2/2 saved");
  await page.screenshot({ path: info.outputPath("auto-collapsed-iphone16.png"), animations: "disabled" });
  await roundToggle(page, "Expand").click();
  await expect(pair.getByRole("button", { name: "Undo set 1b", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(writes.map(write => write.setId)).toEqual([squat.id, row.id, row.id]);
  expect(writes[2]).toEqual(writes[1]);
  const recovered = await stored(page, session.id);
  expect(recovered.loggedSets).toBe(2);
  expect(recovered.sets.map(set => set.id)).toEqual(session.sets.map(set => set.id));
  await expect(page.getByRole("button", { name: "Finish Workout", exact: true })).toBeEnabled();
  // A genuine concurrent change stays discoverable in a collapsed round.
  await pair.getByRole("spinbutton", { name: "Dumbbell row set 1b weight (lb)", exact: true }).fill("45");
  expect((await page.request.put(`/api/sessions/${session.id}/sets`, { data: { setId: row.id, actualReps: 11, actualWeight: 50, expectedActual: { reps: 10, weight: 42.5 } } })).ok()).toBe(true);
  await pair.getByRole("button", { name: "Save set 1b", exact: true }).click();
  await expect(pair.getByText(/Saved elsewhere: 11 reps at 50 lb/)).toBeVisible();
  await roundToggle(page, "Collapse").click();
  await expect(roundToggle(page, "Expand")).toContainText("Resolve conflicting changes");
  await roundToggle(page, "Expand").click();
  await expect(pair.getByRole("button", { name: "Save set 1b", exact: true })).toBeDisabled();
  await pair.getByRole("button", { name: "Use saved values", exact: true }).click();
  await expect(pair.getByRole("button", { name: "Undo set 1b", exact: true })).toBeEnabled();
  await expect(pair.getByRole("spinbutton", { name: "Dumbbell row set 1b weight (lb)", exact: true })).toHaveValue("50");
  await expect(page.getByText(/This set changed in another tab or device/)).toHaveCount(0);
  await page.getByRole("group", { name: "Round 1 of superset A", exact: true }).evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: info.outputPath("superset-round-recovered.png"), animations: "disabled" });
});

test("completed supersets close after acknowledgement and reopen with their round state and saved values intact", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 375, height: 629 });
  const { session, pair } = await startSupersets(page);
  const parent = (action: "Expand" | "Collapse") => pair.getByRole("button", { name: `${action} Squat + Dumbbell row · Superset A`, exact: true });
  const last = session.sets.filter(set => set.exercise_name === "Squat").at(-1)!;
  const firstInput = await pair.getByRole("spinbutton", { name: "Squat set 1a weight (lb)", exact: true }).elementHandle();
  const writes: ActualWrite[] = [];
  let failFinalSave = true;
  await page.route(`**/api/sessions/${session.id}/sets`, async route => {
    if (route.request().method() !== "PUT") return route.continue();
    const body: ActualWrite = route.request().postDataJSON(); writes.push(body);
    if (body.setId === last.id && failFinalSave) {
      failFinalSave = false;
      return route.fulfill({ status: 500, json: { error: "Temporary save failure" } });
    }
    await route.continue();
  });
  for (const label of ["1a", "1b", "2a", "2b"]) {
    await pair.getByRole("button", { name: `Save set ${label}`, exact: true }).click();
    await expect(pair.getByRole("button", { name: `Undo set ${label}`, exact: true, pressed: true, includeHidden: true })).toBeEnabled();
    await expect(parent("Collapse")).toHaveAttribute("aria-expanded", "true");
  }
  // Manually reopened rounds retain that state when their parent closes.
  await roundToggle(page, "Expand").click();
  await pair.getByRole("button", { name: "Save set 3a", exact: true }).click();
  await expect(pair.getByText("Save failed", { exact: true })).toBeVisible();
  await expect(parent("Collapse")).toContainText("4 of 5 sets saved");
  await expect(roundToggle(page, "Collapse", 3)).toBeVisible();
  await pair.getByRole("button", { name: "Save set 3a", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(parent("Expand")).toContainText("5 of 5 sets saved");
  await expect(parent("Expand")).toBeFocused();
  await expect(pair.getByRole("button", { name: "Expand Round 3 of superset A", exact: true, includeHidden: true })).toBeHidden();
  expect(await firstInput!.evaluate(input => input.isConnected && (input as HTMLInputElement).value === "135")).toBe(true);
  expect(writes.filter(write => write.setId === last.id)).toHaveLength(2);
  expect(writes).toHaveLength(6);
  const completed = await stored(page, session.id);
  expect(completed.loggedSets).toBe(5);
  expect(completed.sets.filter(set => set.actual_reps != null)).toHaveLength(5);
  await parent("Expand").evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: info.outputPath("superset-complete-mini.png"), animations: "disabled" });
  await parent("Expand").click();
  await expect(roundToggle(page, "Collapse")).toBeVisible();
  await expect(roundToggle(page, "Expand", 2)).toBeVisible();
  await expect(roundToggle(page, "Expand", 3)).toBeVisible();
  expect(await pair.getByRole("spinbutton", { name: "Squat set 1a weight (lb)", exact: true }).evaluate((input, original) => input === original, firstInput)).toBe(true);
  expect(writes).toHaveLength(6);
  expect((await stored(page, session.id)).sets).toEqual(completed.sets);

  const triple = page.locator("[data-exercise-log-card]").filter({ has: page.getByRole("heading", { name: "Pull-up + Dumbbell press + Calf raise", exact: true }) });
  const tripleParent = (action: "Expand" | "Collapse") => triple.getByRole("button", { name: `${action} Pull-up + Dumbbell press + Calf raise · Superset B`, exact: true });
  for (const label of ["1a", "1b", "1c"]) {
    await triple.getByRole("button", { name: `Save set ${label}`, exact: true }).click();
    await expect(triple.getByRole("button", { name: `Undo set ${label}`, exact: true, pressed: true, includeHidden: true })).toBeEnabled();
    await expect(parent("Collapse")).toBeVisible();
    if (label !== "1c") await expect(tripleParent("Collapse")).toBeVisible();
  }
  await expect(tripleParent("Expand")).toContainText("3 of 3 sets saved");
  expect(writes).toHaveLength(9);
  const allSaved = await stored(page, session.id);
  expect(allSaved.loggedSets).toBe(8);
  await parent("Collapse").click();
  for (const [width, height, fontSize] of [[393, 659, 16], [375, 812, 20]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(size => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.fontSize = `${size}px`; }, fontSize);
    await parent("Expand").evaluate(element => element.scrollIntoView({ block: "start" }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = (await parent("Expand").boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath(`supersets-complete-${width}-${fontSize}.png`), animations: "disabled" });
  }
  await tripleParent("Expand").click();
  await triple.getByRole("button", { name: "Expand Round 1 of superset B", exact: true }).click();
  await expect(triple.getByRole("button", { name: "Undo set 1c", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(writes).toHaveLength(9);
  expect((await stored(page, session.id)).sets).toEqual(allSaved.sets);
});
