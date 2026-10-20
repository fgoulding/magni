import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { ProgramDocumentV1 } from "../../src/features/program-editor/document";
import { registerViaApi } from "./helpers";

test("copied workout guidance stays available without crowding superset logging", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("install-help-dismissed", "1"));
  await registerViaApi(page, "workout-details");
  expect((await page.request.post("/api/settings", { data: { timezone: "UTC" } })).ok()).toBe(true);
  // Existing copies may still contain older, verbose guidance.
  const squatNote = "Allow 3–4 minutes between sets of the main lift, including its partner.";
  const rowNote = "Complete the reps on each side. Support your free hand on a bench; keep your chest free.";
  const programDocument: ProgramDocumentV1 = {
    schemaVersion: 1, name: "Full body copy", description: "", unit: "lb", cycles: 1,
    weekdays: [0, 1, 2, 3, 4, 5, 6], startDate: new Date().toISOString().slice(0, 10),
    weeks: [{ id: randomUUID(), name: "Week 1", block: "", deload: false, days: [{
      id: randomUUID(), name: "Squat day", exercises: [
        { name: "Barbell back squat", repMin: 4, repMax: 6, effort: 2, rest: 45, notes: squatNote },
        { name: "One-arm dumbbell row", repMin: 8, repMax: 12, effort: 3, rest: 120, notes: rowNote },
      ].map(({ name, repMin, repMax, effort, rest, notes }) => ({
        id: randomUUID(), name, progressionKey: randomUUID(), baseLoad: 0, trainingMax: 0,
        notes: "", supersetGroup: "A", rule: null,
        sets: Array.from({ length: 5 }, () => ({
          id: randomUUID(), role: "work", repMin, repMax, loadMode: "working", load: 0,
          effortKind: "rir", effort, restSeconds: rest, tempo: "", notes,
        })),
      })),
    }] }],
  };
  const draft = `/api/program-drafts/${randomUUID()}`;
  expect((await page.request.put(draft, { data: { expectedRevision: 0, document: programDocument } })).ok()).toBe(true);
  expect((await page.request.post(`${draft}/activate`, { data: { expectedRevision: 1 } })).ok()).toBe(true);
  await page.goto("/today");
  await page.getByRole("button", { name: "Start Workout", exact: true }).click();
  const group = page.locator("[data-exercise-log-card]").first();
  const firstRound = page.getByRole("group", { name: "Round 1 of superset A", exact: true });
  await expect(firstRound).toBeVisible();
  await expect(group.getByText(squatNote, { exact: true })).toBeHidden();
  await expect(group.getByText(rowNote, { exact: true })).toBeHidden();
  const weight = group.getByRole("spinbutton", { name: "Barbell back squat set 1a weight (lb)", exact: true });
  await weight.fill("175.5");
  const details = group.getByText("Details", { exact: true });
  await details.click();
  await expect(group.getByText(squatNote, { exact: true })).toBeVisible();
  await expect(group.getByText(rowNote, { exact: true })).toBeVisible();
  await expect(group.getByText(squatNote, { exact: true })).toHaveCount(1);
  await details.click();
  await expect(weight).toHaveValue("175.5");
  await group.getByRole("button", { name: /^Collapse / }).click();
  await expect(group).toContainText("Barbell back squat + One-arm dumbbell row");
  await expect(group).toContainText("Unsaved changes");
  await group.getByRole("button", { name: /^Expand / }).click();
  await expect(weight).toHaveValue("175.5");
  await group.getByRole("button", { name: "Discard set 1a changes", exact: true }).click();
  for (const [width, height, fontSize, theme] of [[375, 629, 16, "light"], [393, 659, 16, "dark"], [375, 812, 20, "dark"]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ fontSize, theme }) => {
      document.documentElement.style.fontSize = `${fontSize}px`;
      document.documentElement.dataset.theme = theme;
    }, { fontSize, theme });
    await group.evaluate(element => element.scrollIntoView({ block: "start" }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const control of [weight, group.getByRole("button", { name: "Save set 1a", exact: true }), group.getByRole("button", { name: "Save round 1 of superset A", exact: true })]) {
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: info.outputPath(`quiet-superset-${width}-${fontSize}.png`), animations: "disabled" });
    await info.attach(`round-height-${width}-${fontSize}`, { body: JSON.stringify(await firstRound.boundingBox()), contentType: "application/json" });
  }
});
