import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { ProgramDocumentV1 } from "../../src/features/program-editor/document";
import { registerViaApi } from "./helpers";
import { readBuilderDraft, saveBuilder } from "./program-builder-helpers";

async function publicFile() {
  const document: ProgramDocumentV1 = JSON.parse(await readFile("examples/programs/top-backoff.magni.json", "utf8"));
  document.weeks[0].days[0].exercises[0].sets[0].tempo = "3-1-1";
  const { name, description, unit, weeks, cycles, weekdays } = document;
  return { format: "magni.program", schemaVersion: 1, program: { name, description, unit, weeks }, setup: { cycles, weekdays } };
}
async function openImport(page: Page, label: string) {
  await registerViaApi(page, label);
  await page.goto("/programs");
  await page.getByRole("link", { name: "Import JSON", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import JSON", exact: true })).toBeVisible();
}

test("JSON file opens a private builder draft and preserves mixed sets and progression through export", async ({ page }, info) => {
  await openImport(page, "import-rich");
  const file = await publicFile();
  await page.getByLabel("JSON file", { exact: true }).setInputFiles({ name: "mixed.magni.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await page.getByRole("button", { name: "Import as draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Build your program", exact: true })).toBeVisible();
  await expect(page.getByLabel("Program name", { exact: true })).toHaveValue(file.program.name);
  expect(await (await page.request.get("/api/programs")).json()).toEqual([]);
  const imported = await readBuilderDraft(page);
  expect(imported.document.startDate).toBe("");
  const original = file.program.weeks[0].days[0].exercises[0];
  const exercise = imported.document.weeks[0].days[0].exercises[0];
  expect(exercise.id).not.toBe(original.id);
  expect(exercise.rule.condition.setId).toBe(exercise.sets[0].id);
  expect(exercise.sets.map((set: { id: string }) => ({ ...set, id: undefined }))).toEqual(original.sets.map(set => ({ ...set, id: undefined })));
  await expect(page.getByText("Individual sets · 3 sets", { exact: true })).toBeVisible();
  await page.getByLabel("Program name", { exact: true }).fill("My imported top sets");
  await page.getByLabel("Exercise name", { exact: true }).fill("Paused barbell squat");
  await page.getByText("Edit individual sets", { exact: true }).click();
  await page.getByLabel("Working weight (lb)", { exact: true }).fill("142.5");
  await expect(page.getByLabel("Set 1 minimum reps", { exact: true })).toHaveValue("5");
  await saveBuilder(page);
  await page.reload();
  const edited = (await readBuilderDraft(page)).document;
  expect(edited.weeks[0].days[0].exercises[0]).toEqual({ ...exercise, name: "Paused barbell squat", baseLoad: 142.5 });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported).toEqual({ ...file, program: { ...file.program, name: "My imported top sets", weeks: edited.weeks } });
  await page.screenshot({ path: info.outputPath("imported-mixed-sets.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("invalid pasted JSON retains content and gives a field-specific correction before import", async ({ page }) => {
  await openImport(page, "import-invalid");
  const content = page.getByRole("textbox", { name: "JSON content", exact: true });
  await content.fill('{"format":');
  await page.getByRole("button", { name: "Import as draft", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("valid JSON");
  await expect(content).toHaveValue('{"format":');
  const file = await publicFile();
  file.program.weeks[0].days[0].exercises[0].sets[0].repMin = -1;
  await content.fill(JSON.stringify(file));
  await page.getByRole("button", { name: "Import as draft", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Week 1, day 1, exercise 1");
  await expect(content).toHaveValue(JSON.stringify(file));
  await expect(content).toBeEnabled();
  file.program.weeks[0].days[0].exercises[0].sets[0].repMin = 5;
  await content.fill(JSON.stringify(file));
  await page.getByRole("button", { name: "Import as draft", exact: true }).click();
  await expect(page.getByLabel("Program name", { exact: true })).toHaveValue(file.program.name);
  expect(await (await page.request.get("/api/programs")).json()).toEqual([]);
});

test("lost import response and temporary sign-in rejection recover the same draft after reload", async ({ page }) => {
  await openImport(page, "import-retry");
  const file = await publicFile();
  await page.getByRole("textbox", { name: "JSON content", exact: true }).fill(JSON.stringify(file));
  const keys = new Set<string>();
  const draftIds = new Set<string>();
  let attempts = 0;
  await page.route("**/api/program-imports", async route => {
    keys.add(route.request().postDataJSON().requestKey);
    attempts++;
    if (attempts === 2) { await route.fulfill({ status: 401, json: { error: "Please sign in again." } }); return; }
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    draftIds.add((await response.json()).draftId);
    if (attempts === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Import as draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry import", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Retry import", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("sign in");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "JSON content", exact: true })).toHaveValue(JSON.stringify(file));
  await page.getByRole("button", { name: "Retry import", exact: true }).click();
  await expect(page.getByLabel("Program name", { exact: true })).toHaveValue(file.program.name);
  expect(keys.size).toBe(1);
  expect(draftIds.size).toBe(1);
  await page.goto("/programs");
  await expect(page.getByRole("region", { name: "Your drafts", exact: true }).getByText(file.program.name, { exact: true })).toHaveCount(1);
});

test("direct upload credential creates only owned drafts, replays safely and stops after revocation", async ({ page, baseURL, browser }, info) => {
  test.setTimeout(90_000);
  await openImport(page, "import-token");
  await page.getByText("Direct upload", { exact: true }).click();
  await page.getByLabel("Credential name", { exact: true }).fill("My program generator");
  const created = page.waitForResponse(response => response.url().endsWith("/api/program-import-tokens") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create credential", exact: true }).click();
  expect((await created).ok()).toBe(true);
  const secret = await page.getByRole("textbox", { name: "New credential secret", exact: true }).inputValue();
  expect(secret).toMatch(/^magni_import_/);
  const agent = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${secret}` } });
  const otherContext = await browser.newContext({ baseURL });
  const other = await otherContext.newPage();
  try {
    const file = await publicFile();
    const requestKey = randomUUID();
    const response = await agent.post("/api/program-imports", { data: { requestKey, file } });
    expect(response.status()).toBe(201);
    const imported = await response.json();
    const replay = await agent.post("/api/program-imports", { data: { requestKey, file } });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({ draftId: imported.draftId, replayed: true });
    expect((await agent.post("/api/program-imports", { data: { requestKey, file: { ...file, program: { ...file.program, name: "Different content" } } } })).status()).toBe(409);
    expect((await agent.get(`/api/program-drafts/${imported.draftId}`)).status()).toBe(401);
    expect((await agent.post(`/api/program-drafts/${imported.draftId}/activate`, { data: { expectedRevision: imported.revision } })).status()).toBe(401);
    expect((await agent.get("/api/program-import-tokens")).status()).toBe(401);
    expect(await (await page.request.get("/api/programs")).json()).toEqual([]);
    await registerViaApi(other, "foreign-import");
    expect((await other.request.get(`/api/program-drafts/${imported.draftId}`)).status()).toBe(404);
    await page.goto(imported.reviewUrl);
    await expect(page.getByLabel("Program name", { exact: true })).toHaveValue(file.program.name);
    await page.goto("/programs/import");
    await page.getByText("Direct upload", { exact: true }).click();
    await expect(page.getByRole("textbox", { name: "New credential secret", exact: true })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Import credentials", exact: true })).toContainText("My program generator");
    await page.getByRole("button", { name: "Revoke My program generator", exact: true }).click();
    await expect(page.getByRole("list", { name: "Import credentials", exact: true })).toContainText("Revoked");
    expect((await agent.post("/api/program-imports", { data: { requestKey: randomUUID(), file } })).status()).toBe(401);
    await page.screenshot({ path: info.outputPath("import-credential-revoked.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await agent.dispose(); await otherContext.close(); }
});

test("legacy rich JSON imports into the same builder without changing prescriptions", async ({ page }) => {
  await openImport(page, "import-legacy");
  const file = JSON.parse(await readFile("examples/programs/double.magni.json", "utf8"));
  await page.getByRole("textbox", { name: "JSON content", exact: true }).fill(JSON.stringify(file));
  await page.getByRole("button", { name: "Import as draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Build your program", exact: true })).toBeVisible();
  await expect(page.getByLabel("Sets", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Working weight (lb)", { exact: true })).toHaveValue("40");
  await expect(page.getByLabel("Minimum reps", { exact: true })).toHaveValue("8");
  await expect(page.getByLabel("Maximum reps", { exact: true })).toHaveValue("12");
  const { document } = await readBuilderDraft(page);
  expect(document.weeks[0].days[0].exercises[0].rule).toEqual(file.weeks[0].days[0].exercises[0].rule);
});
