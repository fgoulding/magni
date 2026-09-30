import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { ProgramDocumentV1 } from "../../src/features/program-editor/document";
import { registerViaApi } from "./helpers";

function program() {
  // Explicit test data keeps production-image checks independent of authoring helpers.
  const keys = [randomUUID(), randomUUID()];
  const document: ProgramDocumentV1 = {
    schemaVersion: 1, name: "Progression workspace", description: "", unit: "lb",
    cycles: 4, weekdays: [1, 3, 5], startDate: "2026-09-30",
    weeks: [0, 1].map(week => ({
      id: randomUUID(), name: `Week ${week + 1}`, block: "", deload: false,
      days: [0, 1].map(day => ({
        id: randomUUID(), name: day ? "Day B" : "Day A",
        exercises: [{
          id: randomUUID(), name: day ? "Squat" : "Row", progressionKey: keys[day],
          baseLoad: day ? 225 : 40, trainingMax: day ? 315 : 100, notes: "", supersetGroup: "",
          rule: day ? null : {
            version: 1, condition: { type: "double_progression" },
            action: { variable: "load", unit: "lb", operation: "add", amount: 2.5, rounding: { mode: "nearest", quantum: 2.5 }, timing: "per_exposure" },
            skipPolicy: "hold", partialPolicy: "hold",
          },
          sets: Array.from({ length: 3 }, () => ({
            id: randomUUID(), role: "work", repMin: 8, repMax: 12, loadMode: "working", load: 0,
            effortKind: "none", effort: 0, restSeconds: 120, tempo: "", notes: "",
          })),
        }],
      })),
    })),
  };
  const source = document.weeks[0].days[0].exercises[0];
  const target = document.weeks[0].days[1].exercises[0];
  return { document, source, target };
}
async function importDraft(page: Page, document: ProgramDocumentV1) {
  await registerViaApi(page, "progression-workspace");
  await page.goto("/programs/editor/new");
  await page.getByText("Presets and program files", { exact: true }).click();
  await page.getByLabel("Import program file", { exact: true }).setInputFiles({ name: "workspace.magni.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Progression & preview", exact: true }).click();
}
async function savedDocument(page: Page): Promise<ProgramDocumentV1> {
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1);
  const response = await page.request.get(`/api/program-drafts/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).document;
}
async function selectDayB(page: Page) {
  const outline = page.getByRole("complementary", { name: "Program outline" });
  if (await outline.isVisible()) await outline.getByRole("button", { name: "Select week 1, day 2: Day B", exact: true }).click();
  else await page.getByRole("combobox", { name: "Day", exact: true }).selectOption("1");
}

test("copy a rule across independent lifts, undo, reload and reuse a complete exercise", async ({ page }, info) => {
  const { document, source, target } = program();
  await importDraft(page, document);
  await page.getByText("Copy rule to other lifts", { exact: true }).click();
  await page.getByRole("checkbox", { name: /Squat/ }).check();
  const preview = page.getByRole("region", { name: "Rule copy preview" });
  await expect(preview).toContainText("2 appearances");
  await expect(preview).toContainText("Week 1"); await expect(preview).toContainText("Week 2");
  await preview.evaluate(element => element.scrollIntoView({ block: "center" }));
  await preview.screenshot({ path: info.outputPath("rule-copy-scope.png") });
  await page.getByRole("button", { name: "Apply rule to selected lifts", exact: true }).click();
  let saved = await savedDocument(page);
  const targets = (value: ProgramDocumentV1) => value.weeks.flatMap(week => week.days.flatMap(day => day.exercises)).filter(exercise => exercise.progressionKey === target.progressionKey);
  for (const exercise of targets(saved)) {
    const before = targets(document).find(item => item.id === exercise.id)!;
    expect(exercise).toEqual({ ...before, rule: source.rule });
  }
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  expect(await savedDocument(page)).toEqual(document);
  await page.getByRole("button", { name: "Apply rule to selected lifts", exact: true }).click();
  saved = await savedDocument(page);
  await page.reload();
  await page.getByRole("button", { name: "Progression & preview", exact: true }).click();
  await selectDayB(page);
  await expect(page.getByRole("combobox", { name: "Progression condition", exact: true })).toHaveValue("double_progression");
  await expect(page.getByLabel("Working load (lb)", { exact: true })).toHaveValue("225");
  await page.getByText("Reuse an exercise", { exact: true }).click();
  await page.getByRole("combobox", { name: "Exercise to reuse", exact: true }).selectOption(source.id);
  await page.getByRole("button", { name: "Add independent copy", exact: true }).click();
  const reused = await savedDocument(page);
  const copy = reused.weeks[0].days[1].exercises[1];
  expect(copy.id).not.toBe(source.id); expect(copy.progressionKey).not.toBe(source.progressionKey);
  expect(copy.sets.map(set => ({ ...set, id: "" }))).toEqual(source.sets.map(set => ({ ...set, id: "" })));
  expect(targets(reused)).toEqual(targets(saved));
  await page.screenshot({ path: info.outputPath("progression-reused-exercise.png"), fullPage: true });
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Progression & preview", exact: true }).click();
  await selectDayB(page);
  await page.getByRole("navigation", { name: "Exercises" }).getByRole("button", { name: "Row", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Progression condition", exact: true })).toHaveValue("double_progression");
  await expect(page.getByLabel("Working load (lb)", { exact: true })).toHaveValue("40");
});

test("refuses an incompatible top-set rule copy before editing the selected lift", async ({ page }, info) => {
  const { document, source, target } = program();
  for (const week of document.weeks) {
    const row = week.days[0].exercises[0];
    row.sets[0].role = "top";
    row.rule!.condition = { type: "designated_set", setId: row.sets[0].id, targetReps: 12 };
  }
  await importDraft(page, document);
  await page.getByText("Copy rule to other lifts", { exact: true }).click();
  await page.getByRole("checkbox", { name: /Squat/ }).check();
  await expect(page.getByRole("region", { name: "Rule copy preview" })).toContainText(/needs top set/i);
  await expect(page.getByRole("button", { name: "Apply rule to selected lifts", exact: true })).toBeDisabled();
  expect(await savedDocument(page)).toEqual(document);
  await page.getByRole("region", { name: "Rule copy preview" }).screenshot({ path: info.outputPath("rule-copy-incompatible.png") });
  expect(source.progressionKey).not.toBe(target.progressionKey);
});

test("explores successive misses and resets without saving hypothetical results", async ({ page }, info) => {
  const { document } = program();
  await importDraft(page, document);
  await page.getByText("Start from a rule preset", { exact: true }).click();
  await page.getByRole("combobox", { name: "Rule starting point", exact: true }).selectOption("reset");
  await page.getByRole("button", { name: "Apply rule preset", exact: true }).click();
  const before = await savedDocument(page);
  let writes = 0;
  page.on("request", request => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes++; });
  await page.getByLabel("Set 1 reps", { exact: true }).fill("7");
  await expect(page.getByRole("status", { name: "Progression preview result", exact: true })).toContainText("consecutive failures: 1");
  await page.getByRole("button", { name: "Add hypothetical workout", exact: true }).click();
  await page.getByLabel("Workout 2, set 1 reps", { exact: true }).fill("7");
  await expect(page.getByRole("status", { name: "Workout 2 preview result", exact: true })).toContainText("consecutive failures: 2");
  await page.getByRole("button", { name: "Add hypothetical workout", exact: true }).click();
  await page.getByLabel("Workout 3, set 1 reps", { exact: true }).fill("7");
  await expect(page.getByRole("status", { name: "Workout 3 preview result", exact: true })).toContainText("Next load: 35 lb");
  const simulator = page.getByRole("complementary", { name: "Hypothetical progression" });
  await simulator.screenshot({ path: info.outputPath("progression-failure-sequence.png") });
  await page.getByLabel("Workout 2 status", { exact: true }).selectOption("skipped");
  await expect(page.getByRole("status", { name: "Workout 3 preview result", exact: true })).toContainText("consecutive failures: 2");
  await page.getByLabel("Workout 2 status", { exact: true }).selectOption("completed");
  await page.getByLabel("Workout 2 deload", { exact: true }).check();
  await expect(page.getByRole("status", { name: "Workout 2 preview result", exact: true })).toContainText("Fixed deload");
  await page.getByRole("button", { name: "Reset simulation", exact: true }).click();
  await page.getByLabel("Set 1 reps", { exact: true }).fill("");
  await expect(page.getByRole("status", { name: "Progression preview result", exact: true })).toContainText("Partial exposure");
  await page.getByLabel("Set 1 reps", { exact: true }).fill("0");
  await expect(page.getByRole("status", { name: "Progression preview result", exact: true })).toContainText("consecutive failures: 1");
  expect(writes).toBe(0);
  const id = new URL(page.url()).pathname.split("/").at(-1);
  expect((await (await page.request.get(`/api/program-drafts/${id}`)).json()).document).toEqual(before);
  await page.reload();
  await page.getByRole("button", { name: "Progression & preview", exact: true }).click();
  await expect(page.getByRole("status", { name: "Progression preview result", exact: true })).toContainText("42.5");
  await expect(page.getByRole("group", { name: "Hypothetical workout 2", exact: true })).toHaveCount(0);
});

test("keeps desktop progression controls and preview readable at wide, enlarged and phone sizes", async ({ page }, info) => {
  const { document } = program();
  await importDraft(page, document);
  await page.getByRole("combobox", { name: "Progression condition", exact: true }).selectOption("weekly");
  await expect(page.getByRole("combobox", { name: "Evaluate", exact: true })).toHaveValue("weekly");
  await page.getByRole("button", { name: "Add hypothetical workout", exact: true }).click();
  await page.getByLabel("Workout 2 logical week", { exact: true }).fill("1");
  await expect(page.getByRole("status", { name: "Workout 2 preview result", exact: true })).toContainText("already been evaluated");
  await page.getByLabel("Workout 2 logical week", { exact: true }).fill("2");
  await expect(page.getByRole("status", { name: "Workout 2 preview result", exact: true })).toContainText("45");
  await page.getByRole("button", { name: "Reset simulation", exact: true }).click();
  const widths = info.project.name === "chromium" ? [1440, 1024] : [393];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const enlarged of [false, true]) {
      await page.evaluate(large => { window.document.documentElement.dataset.theme = large ? "dark" : "light"; window.document.documentElement.style.fontSize = large ? "20px" : ""; }, enlarged);
      expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const numeric = await page.locator('input[type="number"]:visible').evaluateAll(inputs => inputs.map(input => {
        const element = input as HTMLInputElement;
        const style = getComputedStyle(element);
        return { label: element.getAttribute("aria-label") || element.closest("label")?.textContent, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, content: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
      }));
      expect(numeric.filter(input => input.width < 44 || input.height < 44 || input.content < 48)).toEqual([]);
      await page.screenshot({ path: info.outputPath(`progression-${width}-${enlarged ? "dark-enlarged" : "light"}.png`), fullPage: true });
    }
  }
});
