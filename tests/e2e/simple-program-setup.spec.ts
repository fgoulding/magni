import { expect, test, type Page } from "@playwright/test";
import { registerViaApi } from "./helpers";
import { readBuilderDraft, reviewBuilderForToday, saveBuilder, selectBuilderDay } from "./program-builder-helpers";

const templateTitle = "Full Body Supersets 3-Day";

async function openSetup(page: Page, label: string) {
  await registerViaApi(page, label);
  expect((await page.request.post("/api/settings", { data: { timezone: "UTC" } })).ok()).toBe(true);
  await page.goto("/programs");
  await page.getByRole("link", { name: "Choose a program", exact: true }).click();
  await expect(page).toHaveURL(/\/programs\/new$/);
  await page.locator('a[href="/programs/editor/new?template=full-body-supersets-3-day"]').click();
  await expect(page.getByLabel("Program name", { exact: true })).toHaveValue(templateTitle);
}

test("template builder creates the full scheduled program and logs its actual prescriptions", async ({ page }, info) => {
  test.setTimeout(120_000);
  await openSetup(page, "simple-full-body");
  await page.getByLabel("Program name", { exact: true }).fill("Simple full body");
  const groupA = page.getByRole("region", { name: "Superset A", exact: true });
  await groupA.getByLabel("Working weight (lb)", { exact: true }).nth(0).fill("135");
  await groupA.getByLabel("Working weight (lb)", { exact: true }).nth(1).fill("42.5");
  await selectBuilderDay(page, 1);
  await page.getByRole("region", { name: "Superset C", exact: true }).getByLabel("Working weight (lb)", { exact: true }).first().fill("35");
  await reviewBuilderForToday(page);
  await saveBuilder(page);
  const { document } = await readBuilderDraft(page);
  expect(document.cycles).toBe(4);
  expect(document.weekdays).toHaveLength(3);
  expect(document.weeks[0].days.map((day: { exercises: { sets: unknown[] }[] }) => day.exercises.map(exercise => exercise.sets.length))).toEqual([[5, 5, 5, 5, 3, 3], [5, 5, 5, 5, 3, 3], [5, 5, 5, 5, 3, 3]]);
  expect(document.weeks[0].days[0].exercises[1].baseLoad).toBe(42.5);
  expect(document.weeks[0].days[1].exercises[4].baseLoad).toBe(35);
  const activated = page.waitForResponse(response => response.url().endsWith("/activate") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Start program", exact: true }).click();
  expect((await activated).ok()).toBe(true);
  await expect(page.getByText("Program activated", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Train this program", exact: true }).click();
  const started = page.waitForResponse(response => /\/api\/programs\/\d+\/sessions$/.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Start Workout", exact: true }).click();
  const start = await started;
  expect(start.ok()).toBe(true);
  const session = await start.json();
  expect(session.sets).toHaveLength(26);
  const spoto = session.sets.filter((set: { exercise_name: string }) => /Spoto/.test(set.exercise_name));
  expect(spoto).toHaveLength(5);
  expect(JSON.parse(spoto[0].editor_json).set).toMatchObject({ repMin: 6, repMax: 8, tempo: "1-second hover pause" });
  await page.getByRole("button", { name: "Save set 1", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Undo set 1", exact: true }).first()).toBeEnabled();
  await page.screenshot({ path: info.outputPath("simple-program-training.png"), fullPage: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "Undo set 1", exact: true }).first()).toBeEnabled();
});

for (const lostOperation of ["save", "activation"] as const) {
  test(`template builder recovers a lost ${lostOperation} response without a second program`, async ({ page }) => {
    await openSetup(page, `simple-lost-${lostOperation}`);
    await reviewBuilderForToday(page);
    await saveBuilder(page);
    const draftIds = new Set<string>();
    const programIds = new Set<number>();
    let dropped = false;
    await page.route("**/api/program-drafts/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const isSave = request.method() === "PUT";
      const isActivation = request.method() === "POST" && path.endsWith("/activate");
      if (!isSave && !isActivation) { await route.continue(); return; }
      draftIds.add(path.split("/")[3]);
      const result = await route.fetch();
      expect(result.ok()).toBe(true);
      if (isActivation) programIds.add((await result.json()).programId);
      if (!dropped && ((lostOperation === "save" && isSave) || (lostOperation === "activation" && isActivation))) {
        dropped = true;
        await route.abort("failed");
      } else await route.fulfill({ response: result });
    });
    const name = `Recovered ${lostOperation}`;
    await page.getByLabel("Program name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Start program", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "Start program", exact: true }).click();
    await expect(page.getByText("Program activated", { exact: true })).toBeVisible();
    expect(dropped).toBe(true);
    expect(draftIds.size).toBe(1);
    expect(programIds.size).toBe(1);
    await page.goto("/programs");
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(1);
  });
}

test("template builder stays readable at small phone, enlarged phone and desktop sizes", async ({ page }, info) => {
  await openSetup(page, "simple-layout");
  for (const [width, height, fontSize] of [[320, 740, 16], [375, 812, 20], [393, 852, 16], [1280, 900, 16]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ size, theme }) => { document.documentElement.style.fontSize = `${size}px`; document.documentElement.dataset.theme = theme; }, { size: fontSize, theme: width === 393 ? "light" : "dark" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const review = page.getByRole("button", { name: "Review & start", exact: true }).last();
    await review.scrollIntoViewIfNeeded();
    await review.click({ trial: true });
    expect((await review.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath(`simple-program-${width}.png`), fullPage: true, animations: "disabled" });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "20px"; document.documentElement.dataset.theme = "dark"; });
  const weight = page.getByRole("region", { name: "Superset A", exact: true }).getByLabel("Working weight (lb)", { exact: true }).nth(1);
  await weight.fill("42.5");
  await expect(weight).toHaveValue("42.5");
  await expect(weight).toHaveAttribute("inputmode", "decimal");
  await weight.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("simple-program-weights-375.png"), animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await reviewBuilderForToday(page);
  const start = page.getByRole("button", { name: "Start program", exact: true });
  await start.scrollIntoViewIfNeeded();
  await start.click({ trial: true });
  await page.screenshot({ path: info.outputPath("simple-program-review-375.png") });
});

test("an interrupted template activation survives reload without a second program", async ({ page }) => {
  await openSetup(page, "simple-reload-recovery");
  await page.getByLabel("Program name", { exact: true }).fill("Interrupted full body");
  await reviewBuilderForToday(page);
  await saveBuilder(page);
  let offline = false;
  let createdProgramId: number | undefined;
  const drafts = new Set<string>();
  await page.route("**/api/program-drafts/**", async route => {
    const request = route.request();
    drafts.add(new URL(request.url()).pathname.split("/")[3]);
    if (offline) { await route.abort("failed"); return; }
    if (request.method() === "POST" && request.url().endsWith("/activate") && !createdProgramId) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      createdProgramId = (await response.json()).programId;
      offline = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Start program", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  expect(createdProgramId).toBeGreaterThan(0);
  offline = false;
  await page.reload();
  await expect(page.getByLabel("Program name", { exact: true })).toHaveValue("Interrupted full body");
  await expect(page.getByText("Program activated", { exact: true })).toBeVisible();
  expect(drafts.size).toBe(1);
  await page.goto("/programs");
  await expect(page.getByRole("heading", { name: "Interrupted full body", exact: true })).toHaveCount(1);
});
