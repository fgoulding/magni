import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { registerViaApi } from "./helpers";

async function seed(page: Page, completed: boolean) {
  await registerViaApi(page, "workout-retry");
  const create = await page.request.post("/api/sessions", { data: { name: "Recovery rows", date: "2026-09-01", unit: "kg", newWorkout: true, requestKey: crypto.randomUUID() } });
  expect(create.status()).toBe(201);
  const session = await create.json();
  const add = await page.request.post(`/api/sessions/${session.id}/sets`, { data: { name: "Row", sets: 1, reps: 10, weight: 40, requestKey: crypto.randomUUID() } });
  expect(add.status()).toBe(201);
  const set = (await add.json()).sets[0];
  expect((await page.request.put(`/api/sessions/${session.id}/sets`, { data: { setId: set.id, actualReps: 10, actualWeight: 40 } })).ok()).toBe(true);
  if (completed) expect((await page.request.patch(`/api/sessions/${session.id}`)).ok()).toBe(true);
  return { id: session.id as number, setId: set.id as number };
}
async function shot(page: Page, info: TestInfo, name: string) {
  if (info.project.name !== "mobile-safari") return;
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}-iphone.png`), fullPage: true, caret: "initial" });
}

test("repeat metadata waits for hydration and restores a preexisting device draft", async ({ page }, info) => {
  const session = await seed(page, true);
  await page.addInitScript(({ id }) => localStorage.setItem(`magni.workout.reuse.${id}`, JSON.stringify({ name: "Saved routine draft", date: "2026-09-03" })), session);
  let release!: () => void;
  const scripts = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_next/**", async (route) => { if (route.request().resourceType() === "script") await scripts; await route.continue(); });
  await page.goto(`/workouts/${session.id}`, { waitUntil: "commit" });
  try {
    await expect(page.getByLabel("Repeat workout date")).toBeDisabled();
    await expect(page.getByLabel("Routine name")).toBeDisabled();
  } finally { release(); }
  await expect(page.getByLabel("Repeat workout date")).toBeEnabled();
  await expect(page.getByLabel("Repeat workout date")).toHaveValue("2026-09-03");
  await expect(page.getByLabel("Routine name")).toHaveValue("Saved routine draft");
  await page.getByLabel("Routine name").focus();
  await expect(page.getByLabel("Routine name")).toBeFocused();
  await shot(page, info, "reuse-light");
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.fontSize = "20px"; });
  await shot(page, info, "reuse-dark-enlarged");
  expect(await (await page.request.get("/api/sessions")).json()).toHaveLength(1);
});

test("definite invalid repeat and routine metadata can be corrected without duplicate writes", async ({ page }) => {
  const session = await seed(page, true);
  await page.goto(`/workouts/${session.id}`);
  await page.getByLabel("Routine name").fill("x".repeat(141));
  const rejectedRoutine = page.waitForResponse((r) => r.url().endsWith("/api/workout-routines") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Save as routine", exact: true }).click();
  expect((await rejectedRoutine).status()).toBe(400);
  await expect(page.getByLabel("Routine name")).toBeEnabled();
  await expect(page.getByLabel("Routine name")).toBeFocused();
  expect(await (await page.request.get("/api/workout-routines")).json()).toHaveLength(0);
  await page.getByLabel("Routine name").fill("Valid rows");
  await page.getByRole("button", { name: "Save as routine", exact: true }).click();
  await expect(page.getByText("Routine saved. Find it in Workout history.")).toBeVisible();
  expect(await (await page.request.get("/api/workout-routines")).json()).toHaveLength(1);
  await page.getByLabel("Repeat workout date").fill("");
  const rejectedRepeat = page.waitForResponse((r) => r.url().endsWith(`/api/sessions/${session.id}/repeat`));
  await page.getByRole("button", { name: "Repeat workout", exact: true }).click();
  expect((await rejectedRepeat).status()).toBe(400);
  await expect(page.getByLabel("Repeat workout date")).toBeEnabled();
  await expect(page.getByLabel("Repeat workout date")).toBeFocused();
  expect(await (await page.request.get("/api/sessions")).json()).toHaveLength(1);
  await page.getByLabel("Repeat workout date").fill("2026-09-03");
  await page.getByRole("button", { name: "Repeat workout", exact: true }).click();
  await expect(page.getByLabel("Reps for set 1", { exact: true })).toHaveValue("10");
  const sessions = await (await page.request.get("/api/sessions")).json();
  expect(sessions).toHaveLength(2);
  expect(sessions.find((row: { id: number }) => row.id !== session.id)).toMatchObject({ date: "2026-09-03", unit: "kg", loggedSets: 0 });
});

test("a lost structure response is settled before a newer name is saved", async ({ page }, info) => {
  const session = await seed(page, false);
  await page.goto(`/workouts/${session.id}`);
  await page.getByRole("button", { name: "Edit workout", exact: true }).click();
  await expect(page.getByLabel("Workout name", { exact: true })).toBeFocused();
  await page.getByLabel("Workout name", { exact: true }).fill("First saved name");
  let submitted: unknown;
  await page.route(`**/api/sessions/${session.id}`, async (route) => {
    if (route.request().method() === "PUT") { submitted = route.request().postDataJSON(); expect((await route.fetch()).status()).toBe(200); await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "Save workout changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resolve previous save" })).toBeEnabled();
  await page.unroute(`**/api/sessions/${session.id}`);
  await page.reload();
  await page.getByRole("button", { name: "Edit workout", exact: true }).click();
  await page.getByLabel("Workout name", { exact: true }).fill("Newer local name");
  const retry = page.waitForResponse((r) => r.url().endsWith(`/api/sessions/${session.id}`) && r.request().method() === "PUT");
  await page.getByRole("button", { name: "Resolve previous save" }).click();
  expect((await retry).request().postDataJSON()).toEqual(submitted);
  await expect(page.getByLabel("Workout name", { exact: true })).toHaveValue("Newer local name");
  await shot(page, info, "structure-newer-draft");
  await page.getByRole("button", { name: "Save workout changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Newer local name", exact: true })).toBeVisible();
  const saved = await (await page.request.get(`/api/sessions/${session.id}`)).json();
  expect(saved).toMatchObject({ name: "Newer local name", unit: "kg" });
  expect(saved.sets).toHaveLength(1);
  expect(saved.sets[0]).toMatchObject({ actual_reps: 10, actual_weight: 40 });
});

test("a lost correction response preserves newer actuals and records each correction once", async ({ page }, info) => {
  const session = await seed(page, true);
  await page.goto(`/workouts/${session.id}`);
  await page.getByRole("button", { name: "Correct workout", exact: true }).click();
  await expect(page.getByLabel("Correct workout date")).toBeFocused();
  await page.getByLabel("Correct reps for set 1").fill("8");
  await page.getByRole("button", { name: "Preview correction", exact: true }).click();
  let submitted: unknown;
  await page.route(`**/api/sessions/${session.id}/corrections`, async (route) => {
    if (!route.request().postDataJSON().preview) { submitted = route.request().postDataJSON(); expect((await route.fetch()).status()).toBe(200); await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "Save correction", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resolve previous correction" })).toBeEnabled();
  await page.unroute(`**/api/sessions/${session.id}/corrections`);
  await page.getByLabel("Correct reps for set 1").fill("6");
  await page.reload();
  await expect(page.getByLabel("Correct reps for set 1")).toHaveValue("6");
  const retry = page.waitForResponse((r) => r.url().endsWith(`/api/sessions/${session.id}/corrections`) && !r.request().postDataJSON().preview);
  await page.getByRole("button", { name: "Resolve previous correction" }).click();
  expect((await retry).request().postDataJSON()).toEqual(submitted);
  await expect(page.getByLabel("Correct reps for set 1")).toHaveValue("6");
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.fontSize = "20px"; });
  await shot(page, info, "correction-newer-dark-enlarged");
  await page.getByRole("button", { name: "Preview correction", exact: true }).click();
  await page.getByRole("button", { name: "Save correction", exact: true }).click();
  await expect(page.getByText(/1 of 1 sets logged · 240 kg volume/)).toBeVisible();
  const saved = await (await page.request.get(`/api/sessions/${session.id}`)).json();
  expect(saved.corrections).toHaveLength(2);
  expect(saved.sets[0]).toMatchObject({ reps: 10, calculated_weight: 40, actual_reps: 6, actual_weight: 40 });
});
