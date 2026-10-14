import { expect, test } from "@playwright/test";
import type { ProgramDocumentV1 } from "../../src/features/program-editor/document";
import { registerViaApi } from "./helpers";
import { readBuilderDraft, saveBuilder, selectBuilderDay } from "./program-builder-helpers";

test("collapse stays local while reusing an exercise preserves its source and supports undo", async ({ page }, info) => {
  test.setTimeout(120_000);
  await registerViaApi(page, "builder-polish");
  await page.goto("/programs/editor/new?template=full-body-supersets-3-day");
  const pair = page.getByRole("region", { name: "Superset A", exact: true });
  await pair.getByLabel("Working weight (lb)", { exact: true }).nth(1).fill("42.5");
  await saveBuilder(page);
  const initial = await readBuilderDraft(page);
  const initialDocument: ProgramDocumentV1 = initial.document;
  const source = initialDocument.weeks[0].days[0].exercises[1];

  await pair.getByRole("button", { name: "Collapse Superset A", exact: true }).click();
  await expect(pair.getByLabel("Exercise name", { exact: true }).first()).toBeHidden();
  const summary = pair.getByLabel("Superset A summary", { exact: true });
  await expect(summary).toContainText(source.name);
  await expect(summary).toContainText("42.5 lb");
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  expect(await readBuilderDraft(page)).toEqual(initial);

  await selectBuilderDay(page, 1);
  await selectBuilderDay(page, 0);
  await expect(pair.getByRole("button", { name: "Expand Superset A", exact: true })).toHaveAttribute("aria-expanded", "false");
  await pair.getByRole("button", { name: "Move superset A later", exact: true }).click();
  await expect(pair.getByRole("button", { name: "Expand Superset A", exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await saveBuilder(page);
  expect((await readBuilderDraft(page)).document).toEqual(initialDocument);

  await selectBuilderDay(page, 1);
  const destination = page.getByRole("region", { name: "Superset C", exact: true });
  await destination.getByRole("button", { name: "Collapse Superset C", exact: true }).click();
  await page.getByText("Reuse an exercise", { exact: true }).click();
  await page.getByRole("combobox", { name: "Exercise to reuse", exact: true }).selectOption(source.id);
  await page.getByRole("button", { name: "Add independent copy", exact: true }).click();
  await expect(page.getByLabel("Exercise name", { exact: true }).last()).toBeFocused();
  await saveBuilder(page);
  const copied: ProgramDocumentV1 = (await readBuilderDraft(page)).document;
  const copy = copied.weeks[0].days[1].exercises.at(-1)!;
  expect(copied.weeks[0].days[0]).toEqual(initialDocument.weeks[0].days[0]);
  expect(copy.id).not.toBe(source.id);
  expect(copy.progressionKey).not.toBe(source.progressionKey);
  expect(copy.historyKey).toBe(source.historyKey ?? source.id);
  expect(copy.supersetGroup).toBe("");
  expect(copy.sets.map(set => ({ ...set, id: "" }))).toEqual(source.sets.map(set => ({ ...set, id: "" })));
  expect(copy.sets.every(set => !source.sets.some(original => original.id === set.id))).toBe(true);
  expect(copy.baseLoad).toBe(42.5);

  const reused = page.getByRole("group", { name: `Exercise 1: ${source.name}`, exact: true }).last();
  await reused.locator("summary").filter({ hasText: /^Details$/ }).click();
  await reused.getByLabel("Superset group", { exact: true }).fill("C");
  await expect(destination.getByRole("button", { name: "Collapse Superset C", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(destination.getByLabel("Superset group", { exact: true }).last()).toBeFocused();
  await expect(destination.getByLabel("Exercise name", { exact: true }).last()).toHaveValue(source.name);
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();

  await page.getByRole("button", { name: "Undo last edit", exact: true }).click();
  await saveBuilder(page);
  expect((await readBuilderDraft(page)).document).toEqual(initialDocument);
  await page.reload();
  await selectBuilderDay(page, 0);
  await expect(pair.getByLabel("Working weight (lb)", { exact: true }).nth(1)).toHaveValue("42.5");

  for (const [width, height, fontSize] of [[375, 812, 20], [393, 852, 16], [1280, 900, 16]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ fontSize, theme }) => { document.documentElement.style.fontSize = `${fontSize}px`; document.documentElement.dataset.theme = theme; }, { fontSize, theme: width === 393 ? "light" : "dark" });
    const weight = pair.getByLabel("Working weight (lb)", { exact: true }).nth(1);
    const minimum = pair.getByLabel("Minimum reps", { exact: true }).nth(1);
    const maximum = pair.getByLabel("Maximum reps", { exact: true }).nth(1);
    for (const field of [weight, minimum, maximum]) {
      await expect(field).toBeVisible();
      expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(Math.abs((await minimum.boundingBox())!.y - (await maximum.boundingBox())!.y)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await pair.screenshot({ path: info.outputPath(`editor-fields-${width}.png`), animations: "disabled" });
  }
  await pair.getByRole("button", { name: "Collapse Superset A", exact: true }).click();
  await page.screenshot({ path: info.outputPath("editor-collapsed-desktop.png"), fullPage: true, animations: "disabled" });
});

test("collapsed mixed prescriptions remain accurate and review corrections precede workouts", async ({ page }, info) => {
  await registerViaApi(page, "builder-mixed-summary");
  await page.goto("/programs/editor/new?preset=top-backoff");
  const name = await page.getByLabel("Exercise name", { exact: true }).first().inputValue();
  await page.getByRole("button", { name: `Collapse ${name}`, exact: true }).first().click();
  const summary = page.getByLabel(`${name} summary`, { exact: true }).first();
  await expect(summary).toContainText("Individual sets");
  await expect(summary).toContainText("Top set");
  await expect(summary).toContainText("Back-off");
  await page.setViewportSize({ width: 393, height: 852 });
  await summary.screenshot({ path: info.outputPath("editor-mixed-summary-393.png") });
  const expand = page.getByRole("button", { name: `Expand ${name}`, exact: true }).first();
  await expand.focus();
  await page.keyboard.press("Space");
  await expect(expand).toHaveCount(0);
  await expect(page.getByLabel("Exercise name", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Program name", { exact: true }).fill("");
  await page.getByRole("button", { name: "Review & start", exact: true }).first().click();
  const warnings = page.getByLabel("Program validation", { exact: true });
  await expect(warnings).toContainText("Before you start");
  await expect(page.getByRole("button", { name: "Start program", exact: true })).toBeDisabled();
  expect((await warnings.boundingBox())!.y).toBeLessThan((await page.getByRole("button", { name: /^Edit / }).first().boundingBox())!.y);
  await page.screenshot({ path: info.outputPath("editor-review-corrections-393.png"), fullPage: true });
});
