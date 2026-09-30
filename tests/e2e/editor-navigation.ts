import type { Page } from "@playwright/test";

export async function selectEditorWeek(page: Page, index: number) {
  // The server initially renders only the opening status. Choose a responsive
  // navigation path after the hydrated workspace has mounted both controls.
  await page.getByRole("heading", { name: "Program workspace", exact: true }).waitFor({ state: "visible" });
  const outline = page.getByRole("complementary", { name: "Program outline" });
  if (await outline.isVisible()) {
    await outline.getByRole("button", { name: new RegExp(`^Select week ${index + 1}:`) }).click();
  } else {
    await page.getByRole("combobox", { name: "Week", exact: true }).selectOption(String(index));
  }
}
