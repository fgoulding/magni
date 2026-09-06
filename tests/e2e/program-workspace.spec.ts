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
    await expect(page.getByRole("combobox", { name: "Week", exact: true })).toHaveValue("1");
    await expect(page.getByLabel("Set 1 minimum reps", { exact: true })).toBeVisible();
  } else {
    await expect(outline).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Prescriptions", exact: true }).click();
  }
  await page.screenshot({ path: info.outputPath("workspace-prescriptions.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.fontSize = "20px"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("workspace-dark-enlarged.png"), fullPage: true });
  await page.getByRole("link", { name: "Back to programs", exact: true }).click();
  await expect(page).toHaveURL(/\/programs$/);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
});
