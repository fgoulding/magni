import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { registerViaApi } from "./helpers";
import { writeFile } from "node:fs/promises";

async function author(page: Page, label: string) {
  await registerViaApi(page, label);
  await page.goto("/programs/editor/new");
  await page.getByText("Presets and program files", { exact: true }).click();
  await page.getByRole("combobox", { name: "Optional starting structure", exact: true }).selectOption("double");
  await page.getByRole("button", { name: "Apply preset", exact: true }).click();
  await page.getByLabel("Program name", { exact: true }).fill(label);
  await page.getByLabel("Repeat cycles", { exact: true }).fill("1");
  await page.getByLabel("Block name", { exact: true }).fill("Build");
  for (const name of ["Week 2", "Week 3"]) {
    await page.getByRole("button", { name: "Copy week", exact: true }).click();
    await page.getByLabel("Week name", { exact: true }).fill(name);
  }
  await page.getByRole("combobox", { name: "Week", exact: true }).selectOption("0");
  await page.getByRole("button", { name: "Review & activate", exact: true }).click();
  for (const weekday of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
    const control = page.getByRole("button", { name: weekday, exact: true });
    if (await control.getAttribute("aria-pressed") !== "true") await control.click();
  }
  const activation = page.waitForResponse(response => response.url().endsWith("/activate") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Activate program", exact: true }).click();
  const activated = await activation; expect(activated.ok()).toBe(true);
  const result = await activated.json();
  await expect(page.getByText("Program activated", { exact: true })).toBeVisible();
  return { programId: result.programId as number, editorUrl: page.url() };
}
async function editLoad(page: Page, value: number) {
  await page.getByRole("button", { name: "Prescriptions", exact: true }).click();
  await page.getByLabel("Working load (lb)", { exact: true }).fill(String(value));
  await page.getByRole("button", { name: "Review & apply", exact: true }).click();
}
function panel(page: Page) { return page.getByRole("region", { name: "Changes to active program", exact: true }); }
async function review(page: Page) {
  const reply = page.waitForResponse(response => response.url().endsWith("/editor-changes") && response.request().method() === "POST" && response.request().postDataJSON().preview === true);
  await panel(page).getByRole("button", { name: "Review changes", exact: true }).click();
  const received = await reply; expect(received.ok()).toBe(true);
  const body = await received.json(); expect(body.success).toBe(true);
  await expect(panel(page).getByRole("button", { name: "Apply reviewed changes", exact: true })).toBeVisible();
  return body;
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await panel(page).screenshot({ path: info.outputPath(`${name}-light.png`) });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.fontSize = "20px"; });
  const layout = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll("body *")].filter(element => {
    const rect = element.getBoundingClientRect(); return rect.width && (rect.right > window.innerWidth || rect.left < 0 || element.scrollWidth > element.clientWidth + 1);
  }).map(element => ({ tag: element.tagName, className: element.className, text: element.textContent?.slice(0, 100), rect: element.getBoundingClientRect().toJSON(), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflow: getComputedStyle(element).overflowX })) }));
  if (layout.scrollWidth > layout.width) {
    await writeFile(info.outputPath("active-panel-overflow.json"), JSON.stringify(layout, null, 2));
    await info.attach("active-panel-overflow", { body: JSON.stringify(layout, null, 2), contentType: "application/json" });
    await page.screenshot({ path: info.outputPath(`${name}-overflow.png`), fullPage: true });
  }
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  const small = await panel(page).locator("button:visible, select:visible, summary:visible").evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height < 44 || element.getBoundingClientRect().width < 44).map(element => element.textContent));
  expect(small).toEqual([]);
  await panel(page).screenshot({ path: info.outputPath(`${name}-dark-enlarged.png`) });
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; document.documentElement.dataset.theme = "light"; });
}

test("recover a scoped apply, preserve a started workout, and update the remaining block", async ({ page }, info) => {
  test.setTimeout(90_000);
  const f = await author(page, "Reviewed active block");
  await editLoad(page, 50);
  await panel(page).getByLabel("Progression values", { exact: true }).selectOption("use_draft");
  const one = await review(page);
  expect(one.affected).toHaveLength(1);
  expect(one.affected[0].before.map((set: { calculated_weight: number }) => set.calculated_weight)).toEqual([40, 40, 40]);
  expect(one.affected[0].after.map((set: { calculated_weight: number }) => set.calculated_weight)).toEqual([50, 50, 50]);
  await panel(page).locator("summary").click();
  await capture(page, info, "active-one-workout-preview");
  let committed: { success: boolean; revisionId: number } | undefined;
  let original: unknown;
  let lost = false;
  await page.route("**/api/programs/*/editor-changes", async route => {
    const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
    if (body?.preview === false && !lost) {
      lost = true; original = body;
      const response = await route.fetch(); expect(response.ok()).toBe(true);
      committed = await response.json(); expect(committed?.success).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await panel(page).getByRole("button", { name: "Apply reviewed changes", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Review & apply", exact: true }).click();
  await expect(panel(page).getByLabel("Change scope")).toBeDisabled();
  await expect(panel(page).getByLabel("Progression values", { exact: true })).toHaveValue("use_draft");
  await capture(page, info, "active-pending-apply-recovered");
  const retried = page.waitForResponse(response => response.url().endsWith("/editor-changes") && response.request().method() === "POST" && response.request().postDataJSON().preview === false);
  await panel(page).getByRole("button", { name: "Retry pending change", exact: true }).click();
  const retry = await retried;
  expect(retry.request().postDataJSON()).toEqual(original);
  expect(await retry.json()).toMatchObject(committed!);
  await expect(panel(page).getByRole("status")).toContainText("1 workout updated");
  await page.unroute("**/api/programs/*/editor-changes");

  await page.getByRole("link", { name: "Train this program", exact: true }).click();
  const started = page.waitForResponse(response => /\/api\/programs\/\d+\/sessions$/.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Start Workout", exact: true }).click();
  const startResponse = await started; expect(startResponse.ok()).toBe(true);
  const session = await startResponse.json();
  expect(session.sets.map((set: { calculated_weight: number }) => set.calculated_weight)).toEqual([50, 50, 50]);
  await page.goto(f.editorUrl);
  await editLoad(page, 60);
  await panel(page).getByLabel("Change scope").selectOption("remaining_block");
  await panel(page).getByLabel("Progression values", { exact: true }).selectOption("use_draft");
  const block = await review(page);
  expect(block.affected).toHaveLength(2);
  expect(block.affected.flatMap((row: { after: Array<{ calculated_weight: number }> }) => row.after.map(set => set.calculated_weight))).toEqual([60, 60, 60, 60, 60, 60]);
  await capture(page, info, "active-remaining-block");
  await panel(page).getByRole("button", { name: "Apply reviewed changes", exact: true }).click();
  await expect(panel(page).getByRole("status")).toContainText("2 workouts updated");
  const frozenResponse = await page.request.get(`/api/sessions/${session.id}`); expect(frozenResponse.ok()).toBe(true);
  const frozen = await frozenResponse.json();
  expect(frozen.sets.map((set: { calculated_weight: number }) => set.calculated_weight)).toEqual([50, 50, 50]);
  await page.goto(`/calendar?date=${block.affected[0].date}`);
  await page.locator(`[data-occurrence-id="${block.affected[0].occurrenceId}"]`).getByRole("link").first().click();
  await expect(page.getByRole("dialog")).toContainText("8–12 @ 60 lb");
  await page.screenshot({ path: info.outputPath("active-next-calendar-prescription.png"), fullPage: true });
});

test("publish an immutable definition and recover copying it after later draft edits", async ({ page }, info) => {
  test.setTimeout(90_000);
  const f = await author(page, "Published active source");
  await editLoad(page, 55);
  await panel(page).getByLabel("Change scope").selectOption("definition");
  const publishing = await review(page); expect(publishing.affected).toEqual([]);
  await panel(page).getByRole("button", { name: "Apply reviewed changes", exact: true }).click();
  await expect(panel(page).getByRole("status")).toContainText("Published for future copies");
  await editLoad(page, 65);
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  const list = await (await page.request.get(`/api/programs/${f.programId}/editor-changes`)).json();
  expect(list.publishedRevisionId).toBeGreaterThan(0);
  let original: unknown;
  let copied: { success: boolean; draftId: string } | undefined;
  let lost = false;
  await page.route("**/api/programs/*/editor-changes", async route => {
    const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
    if (body?.action === "copy_published" && !lost) {
      lost = true; original = body;
      const result = await route.fetch(); expect(result.ok()).toBe(true);
      copied = await result.json(); expect(copied?.success).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await panel(page).getByRole("button", { name: "Copy published definition", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Review & apply", exact: true }).click();
  await expect(panel(page).getByRole("button", { name: "Review changes", exact: true })).toBeDisabled();
  await capture(page, info, "active-pending-copy-recovered");
  const retried = page.waitForResponse(response => response.url().endsWith("/editor-changes") && response.request().method() === "POST");
  await panel(page).getByRole("button", { name: "Retry pending change", exact: true }).click();
  const retry = await retried; expect(retry.ok()).toBe(true);
  expect(retry.request().postDataJSON()).toEqual(original);
  expect(await retry.json()).toEqual(copied);
  await capture(page, info, "active-published-copy-recovered");
  await panel(page).getByRole("link", { name: "Open copied draft", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/programs/editor/${copied!.draftId}$`));
  await page.getByRole("button", { name: "Prescriptions", exact: true }).click();
  await expect(page.getByLabel("Working load (lb)", { exact: true })).toHaveValue("55");
  await page.reload();
  await page.getByRole("button", { name: "Prescriptions", exact: true }).click();
  await expect(page.getByLabel("Working load (lb)", { exact: true })).toHaveValue("55");
});
