import { expect, type Page } from "@playwright/test";

export async function selectBuilderDay(page: Page, index: number) {
  const selector = page.getByRole("combobox", { name: "Day", exact: true });
  if (await selector.isVisible()) await selector.selectOption(String(index));
  else await page.getByRole("complementary", { name: "Program days", exact: true }).getByRole("button").nth(index).click();
}

export async function saveBuilder(page: Page) {
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
}

export async function readBuilderDraft(page: Page) {
  const draftId = new URL(page.url()).pathname.split("/").at(-1)!;
  const response = await page.request.get(`/api/program-drafts/${draftId}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

export async function reviewBuilderForToday(page: Page) {
  await page.getByRole("button", { name: "Review & start", exact: true }).first().click();
  await page.getByLabel("Start date", { exact: true }).fill(new Date().toISOString().slice(0, 10));
  const today = new Date().getUTCDay();
  const chosen = [today, (today + 2) % 7, (today + 4) % 7];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 0; i < days.length; i++) {
    const button = page.getByRole("button", { name: days[i], exact: true });
    if ((await button.getAttribute("aria-pressed") === "true") !== chosen.includes(i)) await button.click();
  }
}
