import { expect, test } from "@playwright/test";
import { registerViaApi } from "./helpers";

test("failed saves allow leaving with local work and invalid drafts can be deleted", async ({ page }) => {
  await registerViaApi(page, "draft-invalid-exit");
  await page.goto("/programs/editor/new");
  await page.getByLabel("Program name", { exact: true }).fill("Saved draft");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  const draftId = new URL(page.url()).pathname.split("/").at(-1)!;
  const invalidName = "x".repeat(141);
  await page.getByLabel("Program name", { exact: true }).fill(invalidName);
  await page.getByRole("link", { name: "Back to programs", exact: true }).click();
  await expect(page.getByRole("button", { name: "Leave editor", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Leave editor", exact: true }).click();
  await expect(page).toHaveURL(/\/programs$/);
  expect(await page.evaluate(id => Object.entries(localStorage).some(([key, value]) => key.endsWith(id) && JSON.parse(value).document?.name === "x".repeat(141)), draftId)).toBe(true);
  await expect(page.getByRole("region", { name: "Your drafts", exact: true })).toContainText("Saved draft");
  await page.getByRole("button", { name: "Delete draft", exact: true }).click();
  await page.getByRole("group", { name: "Delete draft confirmation" }).getByRole("button", { name: "Delete draft", exact: true }).click();
  await expect(page.getByRole("region", { name: "Your drafts", exact: true })).toHaveCount(0);
});

test("back saves a new draft and Programs offers cancel and permanent draft removal", async ({ page }, info) => {
  await registerViaApi(page, "draft-delete-library");
  await page.goto("/programs/editor/new");
  await page.getByLabel("Program name", { exact: true }).fill("Draft to remove");
  const draftUrl = page.url();
  await page.getByRole("link", { name: "Back to programs", exact: true }).click();
  await expect(page).toHaveURL(/\/programs$/);
  const drafts = page.getByRole("region", { name: "Your drafts", exact: true });
  await expect(drafts).toContainText("Draft to remove");
  await drafts.getByRole("button", { name: "Delete draft", exact: true }).click();
  await expect(page.getByRole("group", { name: "Delete draft confirmation" })).toContainText("Draft to remove");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(drafts).toContainText("Draft to remove");
  await drafts.getByRole("button", { name: "Delete draft", exact: true }).click();
  await page.screenshot({ path: info.outputPath("draft-delete-confirmation.png"), fullPage: true });
  const deleted = page.waitForResponse(response => response.request().method() === "DELETE");
  await page.getByRole("group", { name: "Delete draft confirmation" }).getByRole("button", { name: "Delete draft", exact: true }).click();
  expect((await deleted).status()).toBe(200);
  await expect(drafts).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Your drafts", exact: true })).toHaveCount(0);
  const response = await page.goto(draftUrl);
  expect(response?.status()).toBe(404);
  await expect(page.getByLabel("Program name", { exact: true })).toHaveCount(0);
});

test("editor labels Undo and deletes its own saved draft", async ({ page }, info) => {
  await registerViaApi(page, "draft-delete-editor");
  await page.goto("/programs/editor/new");
  await page.getByLabel("Program name", { exact: true }).fill("Keep this name");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  const draftUrl = page.url();
  await page.getByLabel("Program name", { exact: true }).fill("Undo this change");
  const undo = page.getByRole("button", { name: "Undo last edit", exact: true });
  await expect(undo).toHaveText("Undo");
  await undo.click();
  await expect(page.getByLabel("Program name", { exact: true })).toHaveValue("Keep this name");
  await expect(page).toHaveURL(draftUrl);
  await page.getByRole("button", { name: "Delete draft", exact: true }).click();
  await page.screenshot({ path: info.outputPath("editor-delete-confirmation.png"), fullPage: true });
  await page.getByRole("group", { name: "Delete draft confirmation" }).getByRole("button", { name: "Delete draft", exact: true }).click();
  await expect(page).toHaveURL(/\/programs$/);
  await expect(page.getByRole("region", { name: "Your drafts", exact: true })).toHaveCount(0);
});

test("workspace has a wide desktop outline and a contained phone fallback", async ({ page }, info) => {
  await registerViaApi(page, "desktop-workspace");
  await page.goto("/programs");
  await page.getByRole("link", { name: "Open workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/programs\/editor$/);
  await page.getByRole("link", { name: "New program", exact: true }).click();
  await page.getByText("Presets and program files", { exact: true }).click();
  await page.getByRole("combobox", { name: "Optional starting structure", exact: true }).selectOption("percentage");
  await page.getByRole("button", { name: "Apply preset", exact: true }).click();
  const desktop = info.project.name === "chromium";
  const outline = page.getByRole("complementary", { name: "Program outline" });
  if (desktop) {
    await expect(outline).toBeVisible();
    expect((await page.locator("main").boundingBox())!.width).toBeGreaterThan(1100);
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeHidden();
    await outline.getByRole("button", { name: "Select week 2, day 1: Day A", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Week", exact: true, includeHidden: true })).toBeHidden();
    await expect(page.getByRole("combobox", { name: "Day", exact: true, includeHidden: true })).toBeHidden();
    await expect(outline.getByRole("button", { name: "Select week 2, day 1: Day A", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Set 1 minimum reps", { exact: true })).toBeVisible();
  } else {
    await expect(outline).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Prescriptions", exact: true }).click();
    await page.getByRole("combobox", { name: "Week", exact: true }).selectOption("1");
    await expect(page.getByRole("combobox", { name: "Day", exact: true })).toBeVisible();
  }
  await expect(page.getByLabel("Set 1 minimum reps", { exact: true })).toHaveValue("7");
  await expect(page.getByLabel("Set 1 rest (seconds)", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("workspace-prescriptions.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.fontSize = "20px"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("workspace-dark-enlarged.png"), fullPage: true });
  await page.getByRole("link", { name: "Back to programs", exact: true }).click();
  await expect(page).toHaveURL(/\/programs$/);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
});

test("prescription rows preserve load bases and advanced fields through copy, reorder and reload", async ({ page }, info) => {
  test.setTimeout(90_000);
  await registerViaApi(page, "prescription-rows");
  await page.goto("/programs/editor/new");
  await page.getByText("Presets and program files", { exact: true }).click();
  await page.getByRole("combobox", { name: "Optional starting structure", exact: true }).selectOption("double");
  await page.getByRole("button", { name: "Apply preset", exact: true }).click();
  await page.getByRole("button", { name: "Prescriptions", exact: true }).click();
  await page.getByRole("button", { name: "Add set", exact: true }).click();
  await page.getByRole("button", { name: "Add set", exact: true }).click();
  const row = (index: number) => page.getByRole("group", { name: `Set ${index}`, exact: true });
  for (const [index, mode, value] of [[1, "fixed", 25], [2, "percent", 65], [3, "added", 10], [4, "bodyweight", null], [5, "working", null]] as const) {
    await row(index).getByRole("button", { name: `Set ${index} details`, exact: true }).click();
    await row(index).getByRole("combobox", { name: "Load basis", exact: true }).selectOption(mode);
    if (value !== null) await row(index).getByLabel(mode === "percent" ? `Set ${index} percent of max` : `Set ${index} load (lb)`, { exact: true }).fill(String(value));
  }
  await row(1).getByLabel("Set 1 minimum reps", { exact: true }).fill("6");
  await row(1).getByLabel("Set 1 maximum reps", { exact: true }).fill("9");
  await row(1).getByLabel("Set 1 rest (seconds)", { exact: true }).fill("90");
  await row(1).getByRole("combobox", { name: "Set role", exact: true }).selectOption("warmup");
  await row(1).getByRole("combobox", { name: "Effort", exact: true }).selectOption("rir");
  await row(1).getByLabel("Effort target", { exact: true }).fill("2");
  await row(1).getByLabel("Tempo", { exact: true }).fill("3-1-1");
  await row(1).getByLabel("Set notes", { exact: true }).fill("Pause at the bottom");
  await row(1).getByRole("button", { name: "Copy set", exact: true }).click();
  await row(2).getByRole("button", { name: "Set 2 details", exact: true }).click();
  await row(2).getByRole("button", { name: "Move set 2 later", exact: true }).click();
  await expect(row(3).getByRole("button", { name: "Set 3 details", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(row(3).getByLabel("Set notes", { exact: true })).toHaveValue("Pause at the bottom");
  await row(3).getByRole("button", { name: "Remove set 3", exact: true }).click();
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Prescriptions", exact: true }).click();
  await expect(row(1).getByLabel("Set 1 minimum reps", { exact: true })).toHaveValue("6");
  await expect(row(1).getByLabel("Set 1 maximum reps", { exact: true })).toHaveValue("9");
  await expect(row(1).getByLabel("Set 1 rest (seconds)", { exact: true })).toHaveValue("90");
  await expect(row(1)).toContainText("RIR 2 · Tempo 3-1-1 · Pause at the bottom");
  for (const [index, mode, value] of [[1, "fixed", 25], [2, "percent", 65], [3, "added", 10], [4, "bodyweight", null], [5, "working", null]] as const) {
    await row(index).getByRole("button", { name: `Set ${index} details`, exact: true }).click();
    await expect(row(index).getByRole("combobox", { name: "Load basis", exact: true })).toHaveValue(mode);
    if (value !== null) await expect(row(index).getByLabel(mode === "percent" ? `Set ${index} percent of max` : `Set ${index} load (lb)`, { exact: true })).toHaveValue(String(value));
    if (index === 1) {
      await expect(row(index).getByRole("combobox", { name: "Set role", exact: true })).toHaveValue("warmup");
      await expect(row(index).getByRole("combobox", { name: "Effort", exact: true })).toHaveValue("rir");
      await expect(row(index).getByLabel("Effort target", { exact: true })).toHaveValue("2");
      await expect(row(index).getByLabel("Tempo", { exact: true })).toHaveValue("3-1-1");
      await expect(row(index).getByLabel("Set notes", { exact: true })).toHaveValue("Pause at the bottom");
    }
    await row(index).getByRole("button", { name: `Set ${index} details`, exact: true }).click();
  }
  await page.getByRole("group", { name: "Set prescriptions", exact: true }).screenshot({ path: info.outputPath("prescription-rows.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const desktop = info.project.name === "chromium";
  const longName = "Paused barbell split squat with a front foot elevation and a controlled three-second descent";
  const longNote = "Keep the whole foot planted, pause at the bottom, and finish each rep with the same controlled range of motion. Allow enough rest to repeat the prescribed tempo without rushing the next set.";
  await page.getByLabel("Exercise name", { exact: true }).fill(longName);
  await row(1).getByRole("button", { name: "Set 1 details", exact: true }).click();
  await row(1).getByLabel("Set notes", { exact: true }).fill(longNote);
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Exercises", exact: true }).getByRole("button", { name: longName, exact: true })).toBeVisible();

  for (const viewport of desktop ? [{ name: "wide", width: 1440, height: 1100 }, { name: "1024", width: 1024, height: 900 }] : [{ name: "phone", width: 393, height: 852 }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const enlarged of [false, true]) {
      await page.evaluate(large => {
        document.documentElement.dataset.theme = large ? "dark" : "light";
        document.documentElement.style.fontSize = large ? "20px" : "";
      }, enlarged);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const outline = page.getByRole("complementary", { name: "Program outline" });
      if (await outline.isVisible()) {
        await expect(page.getByRole("combobox", { name: "Week", exact: true, includeHidden: true })).toBeHidden();
        await expect(page.getByRole("combobox", { name: "Day", exact: true, includeHidden: true })).toBeHidden();
      } else {
        await expect(page.getByRole("combobox", { name: "Week", exact: true })).toBeVisible();
        await expect(page.getByRole("combobox", { name: "Day", exact: true })).toBeVisible();
      }
      const controls = await row(1).locator("input, select, button").evaluateAll(elements => elements.map(element => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height, viewportWidth: window.innerWidth };
      }));
      for (const bounds of controls) {
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1);
      }
      const numberWidths = await row(1).locator('input[type="number"]').evaluateAll(inputs => inputs.map(input => {
        const style = getComputedStyle(input);
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d")!;
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        return {
          label: input.getAttribute("aria-label") ?? input.closest("label")?.textContent,
          contentWidth: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          // Reserve one em for the native spinner as well as the entered digits.
          requiredWidth: context.measureText("88").width + parseFloat(style.fontSize),
        };
      }));
      for (const number of numberWidths) expect(number.contentWidth, `${number.label} must show two digits beside the number spinner`).toBeGreaterThanOrEqual(number.requiredWidth);
      await expect(row(1).getByLabel("Set notes", { exact: true })).toHaveValue(longNote);
      await row(1).getByLabel("Tempo", { exact: true }).fill("3-1-1");
      const appearance = enlarged ? "dark-enlarged" : "light";
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: info.outputPath(`workspace-${viewport.name}-${appearance}-viewport.png`) });
      await page.screenshot({ path: info.outputPath(`workspace-${viewport.name}-${appearance}-full.png`), fullPage: true });
      await row(1).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`workspace-${viewport.name}-${appearance}-details.png`) });
    }
  }
});
