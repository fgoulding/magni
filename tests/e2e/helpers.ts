import { expect, type Locator, type Page, type Response } from "@playwright/test";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function uniqueEmail(label: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `e2e-${label}-${suffix}@example.com`;
}

async function clickAndWaitForResponse(
  locator: Locator,
  predicate: (response: Response) => boolean,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const responsePromise = locator.page().waitForResponse(predicate, { timeout: 10_000 });
    await locator.click();
    try {
      return await responsePromise;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for response");
}

export async function register(page: Page, label: string): Promise<{ email: string; password: string }> {
  const email = uniqueEmail(label);
  const password = "password123";

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const submit = page.getByRole("button", { name: "Create account" });
  await expect(submit).toBeEnabled();
  const response = await clickAndWaitForResponse(submit, (response) =>
    response.url().endsWith("/api/auth/register") && response.request().method() === "POST",
  );
  expect(response.ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();

  return { email, password };
}

export async function registerViaApi(page: Page, label: string): Promise<{ email: string; password: string }> {
  const email = uniqueEmail(label);
  const password = "password123";
  const response = await page.request.post("/api/auth/register", {
    data: { email, password },
  });
  expect(response.ok()).toBe(true);
  return { email, password };
}

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const submit = page.getByRole("button", { name: "Log in" });
  await expect(submit).toBeEnabled();
  const response = await clickAndWaitForResponse(submit, (response) =>
    response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
  );
  expect(response.ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
}

export async function currentWeekdayLabel(page: Page): Promise<string> {
  const weekday = await page.evaluate(() => new Date().getDay());
  return WEEKDAY_LABELS[weekday];
}

export async function createProgram(page: Page, name: string): Promise<void> {
  await goToTab(page, "Programs");
  await page.getByRole("link", { name: "New" }).click();
  await expect(page).toHaveURL(/\/programs\/new$/);
  await expect(page.getByRole("heading", { name: "New program" })).toBeVisible();
  await page.getByLabel("Program name").fill(name);
  await page.getByLabel("Weeks").fill("4");
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/programs") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create program" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

export async function addDay(page: Page, name: string): Promise<void> {
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Add day" }) });
  await form.getByPlaceholder("Lower").fill(name);
  const responsePromise = page.waitForResponse((response) =>
    /\/api\/programs\/\d+\/days$/.test(response.url()) && response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Add" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

export async function addLinearExercise(page: Page, name: string, trainingMax: string): Promise<void> {
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Add exercise" }) }).last();
  await form.getByPlaceholder("Squat").fill(name);
  await form.getByLabel("Training max").fill(trainingMax);
  await form.getByLabel("Progression").selectOption("linear");
  const responsePromise = page.waitForResponse((response) =>
    /\/api\/days\/\d+\/exercises$/.test(response.url()) && response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Add" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  // Progression id renders lowercase in the exercise meta (the picker shows "Linear").
  await expect(page.getByText("linear", { exact: true }).first()).toBeVisible();
}

export async function scheduleForToday(page: Page): Promise<string> {
  const weekday = await currentWeekdayLabel(page);
  const schedule = page.locator("section").filter({ has: page.getByRole("heading", { name: "Schedule" }) });
  await schedule.getByRole("button", { name: weekday }).click();
  const responsePromise = page.waitForResponse((response) =>
    /\/api\/programs\/\d+$/.test(response.url()) && response.request().method() === "PUT",
  );
  await schedule.getByRole("button", { name: "Save schedule" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  await expect(schedule.getByText("1 day each week")).toBeVisible();
  return weekday;
}

export async function buildScheduledLinearProgram(
  page: Page,
  programName: string,
  dayName = "Today Lower",
  exerciseName = "Squat",
): Promise<void> {
  await createProgram(page, programName);
  await addDay(page, dayName);
  await addLinearExercise(page, exerciseName, "200");
  await scheduleForToday(page);
}

export async function completeVisibleWorkout(page: Page, startButtonName = "Start Workout"): Promise<void> {
  await page.getByRole("button", { name: startButtonName }).click();
  await expect(page.getByRole("heading", { name: "Squat" })).toBeVisible();

  await page.getByRole("button", { name: "Log Set" }).click();
  await expect(page.getByText("3 sets logged")).toBeVisible();
  await page.getByRole("button", { name: "Finish Workout" }).click();

  await expect(page.getByText("Workout complete")).toBeVisible();
  await expect(page.getByText("Squat").first()).toBeVisible();
  await expect(page.getByText("15 reps @ 200 lb")).toBeVisible();
  await expect(page.getByText("3,000 lb total")).toBeVisible();
}

export async function goToTab(page: Page, name: "Today" | "Programs" | "Calendar" | "Stats" | "Settings"): Promise<void> {
  await page.getByRole("navigation").getByRole("link", { name }).click();
  if (name === "Calendar") {
    await expect(page.getByText("Training calendar")).toBeVisible();
    return;
  }
  if (name === "Stats") {
    await expect(page.getByRole("heading", { name: "Statistics" })).toBeVisible();
    return;
  }
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
