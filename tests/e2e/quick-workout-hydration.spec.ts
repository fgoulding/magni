import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { registerViaApi } from "./helpers";

test("quick workout waits for its draft handlers before accepting a name, date or units", async ({ page }, info) => {
  await registerViaApi(page, "quick-start-hydration");
  let release!: () => void;
  const scripts = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_next/**", async (route) => {
    if (route.request().resourceType() === "script") await scripts;
    await route.continue();
  });
  await page.goto("/workouts/new?date=2026-09-01", { waitUntil: "commit" });
  try {
    await expect(page.getByLabel("Workout name", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Workout date", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Workout units")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Quick workout", exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByLabel("Workout name", { exact: true })).toBeEnabled();
  await page.getByLabel("Workout name", { exact: true }).fill("September pull");
  await page.getByLabel("Workout date", { exact: true }).fill("2026-09-02");
  await page.getByLabel("Workout units").selectOption("kg");
  if (info.project.name === "mobile-safari") {
    fs.mkdirSync(".playwright/production-goal", { recursive: true });
    await page.screenshot({ path: ".playwright/production-goal/quick-start-ready-iphone.png", fullPage: true, caret: "initial" });
  }
  const creating = page.waitForResponse((response) => response.url().endsWith("/api/sessions") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Quick workout", exact: true }).click();
  const response = await creating;
  expect(response.request().postDataJSON()).toMatchObject({ name: "September pull", date: "2026-09-02", unit: "kg" });
  expect(response.status()).toBe(201);
  const session = await response.json();
  await expect(page.getByRole("heading", { name: "September pull", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "September pull", exact: true })).toBeVisible();
  expect(await (await page.request.get(`/api/sessions/${session.id}`)).json()).toMatchObject({ name: "September pull", date: "2026-09-02", unit: "kg" });
});

for (const pendingDraft of [false, true]) test(`active quick workout gates early edits and restores ${pendingDraft ? "a pending local draft" : "saved actuals"} before logging`, async ({ page }, info) => {
  await registerViaApi(page, "active-quick-hydration");
  const created = await page.request.post("/api/sessions", { data: { name: "Active rows", date: "2026-09-01", unit: "kg", newWorkout: true, requestKey: crypto.randomUUID() } });
  expect(created.status()).toBe(201);
  const session = await created.json();
  const added = await page.request.post(`/api/sessions/${session.id}/sets`, { data: { name: "Row", sets: 1, reps: 10, weight: 40, requestKey: crypto.randomUUID() } });
  expect(added.status()).toBe(201);
  const set = (await added.json()).sets[0];
  expect((await page.request.put(`/api/sessions/${session.id}/sets`, { data: { setId: set.id, actualReps: 10, actualWeight: 40 } })).ok()).toBe(true);
  // Seed a pending device draft once; future reloads must read the real saved result.
  if (pendingDraft) await page.addInitScript(({ sessionId, setId }) => {
    if (!sessionStorage.getItem("active-hydration-seeded")) {
      localStorage.setItem(`magni.quick-workout.${sessionId}.draft.v1`, JSON.stringify({ [setId]: { reps: "12", weight: "45", base: { reps: 10, weight: 40 } } }));
      sessionStorage.setItem("active-hydration-seeded", "1");
    }
  }, { sessionId: session.id, setId: set.id });
  let release!: () => void;
  const scripts = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_next/**", async (route) => { if (route.request().resourceType() === "script") await scripts; await route.continue(); });
  await page.goto(`/workouts/${session.id}`, { waitUntil: "commit" });
  try {
    await expect(page.getByRole("spinbutton", { name: "Reps for set 1", exact: true })).toBeDisabled();
    await expect(page.getByRole("spinbutton", { name: "Weight for set 1", exact: true })).toBeDisabled();
    for (const name of ["Edit workout", "Add exercise", "Set 1 saved, tap to update", "Finish workout", "Discard"]) await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole("spinbutton", { name: "Reps for set 1", exact: true })).toBeEnabled();
  await expect(page.getByRole("spinbutton", { name: "Reps for set 1", exact: true })).toHaveValue(pendingDraft ? "12" : "10");
  await expect(page.getByRole("spinbutton", { name: "Weight for set 1", exact: true })).toHaveValue(pendingDraft ? "45" : "40");
  await expect(page.getByText(pendingDraft ? "Unsaved" : "Saved", { exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/sessions/${session.id}`)).json()).sets[0]).toMatchObject({ actual_reps: 10, actual_weight: 40 });
  if (pendingDraft && info.project.name === "mobile-safari") await page.screenshot({ path: ".playwright/production-goal/quick-active-draft-ready-iphone.png", fullPage: true, caret: "initial" });
  await page.getByRole("spinbutton", { name: "Reps for set 1", exact: true }).fill("8");
  await page.getByRole("spinbutton", { name: "Weight for set 1", exact: true }).fill("42.5");
  expect((await (await page.request.get(`/api/sessions/${session.id}`)).json()).sets[0]).toMatchObject({ actual_reps: 10, actual_weight: 40 });
  await page.getByRole("button", { name: "Save set 1", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Reps for set 1", exact: true })).toHaveValue("8");
  await expect(page.getByRole("spinbutton", { name: "Weight for set 1", exact: true })).toHaveValue("42.5");
  expect((await (await page.request.get(`/api/sessions/${session.id}`)).json()).sets[0]).toMatchObject({ id: set.id, actual_reps: 8, actual_weight: 42.5 });
});

test("startup metadata stays fixed while a committed create response is pending", async ({ page }) => {
  await registerViaApi(page, "quick-create-pending");
  await page.goto("/workouts/new?date=2026-09-01");
  await page.getByLabel("Workout name", { exact: true }).fill("Submitted rows");
  await page.getByLabel("Workout date", { exact: true }).fill("2026-09-02");
  await page.getByLabel("Workout units").selectOption("kg");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let committed!: () => void;
  const didCommit = new Promise<void>((resolve) => { committed = resolve; });
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committed();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Quick workout", exact: true }).click();
  await didCommit;
  try {
    await expect(page.getByRole("button", { name: "Starting…", exact: true })).toBeDisabled();
    for (const name of ["Workout name", "Workout date", "Workout units"]) await expect(page.getByLabel(name, { exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole("heading", { name: "Submitted rows", exact: true })).toBeVisible();
  const sessions = await (await page.request.get("/api/sessions")).json();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ name: "Submitted rows", date: "2026-09-02", unit: "kg" });
});

test("unconfirmed startup metadata stays locked through reload and retries the exact create once", async ({ page }, info) => {
  await registerViaApi(page, "quick-create-lost");
  await page.goto("/workouts/new?date=2026-09-01");
  await page.getByLabel("Workout name", { exact: true }).fill("Submitted rows");
  await page.getByLabel("Workout date", { exact: true }).fill("2026-09-02");
  await page.getByLabel("Workout units").selectOption("kg");
  const attempts: unknown[] = [];
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    if (attempts.length === 1) return route.abort("failed");
    await route.fulfill({ response });
  });
  const failure = page.waitForEvent("requestfailed", { predicate: (request) => request.url().endsWith("/api/sessions") && request.method() === "POST" });
  await page.getByRole("button", { name: "Quick workout", exact: true }).click();
  await failure;
  await expect(page.getByRole("button", { name: "Starting…", exact: true })).toHaveCount(0);
  for (const name of ["Workout name", "Workout date", "Workout units"]) await expect(page.getByLabel(name, { exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry starting workout", exact: true })).toBeEnabled();
  await expect(page.getByRole("status")).toContainText("Retry to recover");
  await expect(page.getByLabel("Workout name", { exact: true })).toHaveValue("Submitted rows");
  await expect(page.getByLabel("Workout date", { exact: true })).toHaveValue("2026-09-02");
  await expect(page.getByLabel("Workout units")).toHaveValue("kg");
  for (const name of ["Workout name", "Workout date", "Workout units"]) await expect(page.getByLabel(name, { exact: true })).toBeDisabled();
  if (info.project.name === "mobile-safari") await page.screenshot({ path: ".playwright/production-goal/quick-start-unconfirmed-iphone.png", fullPage: true, caret: "initial" });
  await page.getByRole("button", { name: "Retry starting workout", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Submitted rows", exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  const sessions = await (await page.request.get("/api/sessions")).json();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ name: "Submitted rows", date: "2026-09-02", unit: "kg" });
});

test("confirmed startup validation rejection writes nothing and permits corrected metadata", async ({ page }) => {
  await registerViaApi(page, "quick-create-validation");
  await page.goto("/workouts/new?date=2026-09-01");
  await page.getByLabel("Workout name", { exact: true }).fill("");
  const rejected = page.waitForResponse(response => response.url().endsWith("/api/sessions") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Quick workout", exact: true }).click();
  const rejection = await rejected;
  expect(rejection.status()).toBe(400);
  await expect(page.getByText("Enter a name from 1 to 140 characters.", { exact: true })).toBeVisible();
  expect(await (await page.request.get("/api/sessions")).json()).toEqual([]);
  for (const name of ["Workout name", "Workout date", "Workout units"]) await expect(page.getByLabel(name, { exact: true })).toBeEnabled();
  await page.getByLabel("Workout name", { exact: true }).fill("Corrected rows");
  await page.getByLabel("Workout date", { exact: true }).fill("2026-09-02");
  await page.getByLabel("Workout units").selectOption("kg");
  const corrected = page.waitForResponse(response => response.url().endsWith("/api/sessions") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Quick workout", exact: true }).click();
  const correction = await corrected;
  expect(correction.status()).toBe(201);
  expect(correction.request().postDataJSON().requestKey).not.toBe(rejection.request().postDataJSON().requestKey);
  await expect(page.getByRole("heading", { name: "Corrected rows", exact: true })).toBeVisible();
  const sessions = await (await page.request.get("/api/sessions")).json();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ name: "Corrected rows", date: "2026-09-02", unit: "kg" });
});
