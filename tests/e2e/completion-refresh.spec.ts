import { expect, test, type APIResponse, type Page, type Request, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerViaApi } from "./helpers";

async function loggedWorkout(page: Page, preset = "linear", fromEditor = false) {
  await registerViaApi(page, "completion-refresh");
  const document = JSON.parse(await readFile(`examples/programs/${preset}.magni.json`, "utf8"));
  document.startDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  document.weekdays = [0, 1, 2, 3, 4, 5, 6];
  const draft = `/api/program-drafts/${randomUUID()}`;
  expect((await page.request.put(draft, { data: { expectedRevision: 0, document } })).ok()).toBe(true);
  expect((await page.request.post(`${draft}/activate`, { data: { expectedRevision: 1 } })).ok()).toBe(true);
  if (fromEditor) {
    await page.goto(draft.replace("/api/program-drafts/", "/programs/editor/"));
    await page.getByRole("link", { name: "Train this program", exact: true }).click();
  } else await page.goto("/today");
  await page.getByRole("button", { name: "Start Workout", exact: true }).click();
  const saves = page.getByRole("button", { name: /^Save set \d+$/ });
  await expect(saves).toHaveCount(3);
  for (let index = 0; index < 3; index++) {
    await saves.nth(index).click();
    await expect(saves.nth(index)).toHaveAttribute("aria-pressed", "true");
  }
}

async function holdRefresh(page: Page) {
  let release!: () => void;
  let requested!: (response: APIResponse) => void;
  let completionStarted = false;
  const isCompletion = (request: Request) => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/complete-and-advance");
  const markStarted = (request: Request) => {
    if (isCompletion(request)) { completionStarted = true; page.off("request", markStarted); }
  };
  page.on("request", markStarted);
  const completion = page.waitForResponse(response => isCompletion(response.request())).then(async response => ({ response, body: await response.json().catch(() => null) }));
  const pending = new Promise<void>(resolve => { release = resolve; });
  const fetched = new Promise<APIResponse>(resolve => { requested = resolve; });
  const received = completion.then(async ({ response, body }) => {
    await test.info().attach("completion-response", { contentType: "application/json", body: JSON.stringify({ status: response.status(), success: body?.success, error: body?.error }) });
    if (!response.ok()) throw new Error(`Completion request failed (${response.status()}): ${body?.error ?? "No error body"}`);
    if (body?.success !== true) throw new Error("Completion response did not acknowledge success");
    const refresh = await fetched;
    const containsRecap = (await refresh.text()).includes("Workout complete today");
    await test.info().attach("completion-refresh-response", { contentType: "application/json", body: JSON.stringify({ status: refresh.status(), containsRecap }) });
    if (!refresh.ok() || !containsRecap) throw new Error(`Completed Today refresh did not contain the saved recap (${refresh.status()})`);
  });
  // A response may arrive while the test is still completing its click. Keep a
  // rejection handled until the caller awaits the explicit completion boundary.
  void received.catch(() => {});
  const handler = async (route: Route) => {
    if (route.request().headers().rsc !== "1" || !completionStarted) return route.continue();
    // Development/HMR can refresh Today independently. Only hold a response
    // fetched after the actual completion was acknowledged and committed.
    const result = await completion;
    if (!result.response.ok() || result.body?.success !== true) return route.continue();
    const response = await route.fetch();
    requested(response);
    await pending;
    await route.fulfill({ response }).catch(() => {});
  };
  await page.route("**/today?*", handler);
  return { received, release };
}

test("a rejected completion cannot be mistaken for an unrelated Today refresh", async ({ page }) => {
  await loggedWorkout(page);
  await page.route("**/complete-and-advance", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Injected completion rejection" }) }));
  const refresh = await holdRefresh(page);
  try {
    await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Injected completion rejection" })).toBeVisible();
    await page.evaluate(() => { void fetch("/today?_rsc=unrelated-refresh", { headers: { rsc: "1" } }); });
    await expect(refresh.received).rejects.toThrow("Completion request failed (500)");
  } finally { refresh.release(); }
});

test("completion stays pending until the refreshed route commits", async ({ page }, info) => {
  await loggedWorkout(page);
  const refresh = await holdRefresh(page);
  try {
    await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
    await refresh.received;
    await expect(page.getByRole("button", { name: "Finishing…", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Finishing…", exact: true })).toBeDisabled();
    await expect(page.getByRole("spinbutton", { name: "Dumbbell row set 1 reps", exact: true })).toBeDisabled();
    await expect(page.getByText("Workout complete", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("completion-refresh-pending.png"), fullPage: true });
  } finally { refresh.release(); }
  await expect(page.getByText("Workout complete today", { exact: true })).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar$/);
});

test("an immediate Calendar navigation survives the pending completion refresh", async ({ page }) => {
  await loggedWorkout(page);
  const refresh = await holdRefresh(page);
  try {
    await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
    await refresh.received;
    const calendar = page.waitForResponse(response => new URL(response.url()).pathname === "/calendar" && response.request().headers().rsc === "1");
    await page.getByRole("navigation").getByRole("link", { name: "Calendar", exact: true }).click();
    await calendar;
  } finally { refresh.release(); }
  await expect(page.locator('[aria-label="Weekly workout agenda"]')).toBeVisible();
  await expect(page).toHaveURL(/\/calendar$/);
});

for (const phase of ["hover", "press"]) test(`a Calendar ${phase} spanning the completion commit remains a navigation`, async ({ page }, info) => {
  await loggedWorkout(page, "top-backoff");
  await page.evaluate(() => {
    const events: unknown[] = [];
    Object.assign(window, { completionNavigationEvents: events });
    for (const type of ["pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click"]) document.addEventListener(type, event => {
      const target = event.target as Element;
      const pointer = event as MouseEvent;
      const anchor = document.querySelector('nav a[href="/calendar"]');
      events.push({ type, text: target.textContent?.trim(), tag: target.tagName, x: pointer.clientX, y: pointer.clientY, scrollY, nav: anchor?.getBoundingClientRect().toJSON() });
    }, true);
  });
  const refresh = await holdRefresh(page);
  try {
    await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
    await refresh.received;
    const navigation = page.getByRole("navigation").getByRole("link", { name: "Calendar", exact: true });
    const rect = (await navigation.boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (phase === "press") await page.mouse.down();
    refresh.release();
    await expect(page.getByText("Workout complete today", { exact: true })).toBeVisible();
    if (phase === "hover") await page.mouse.down();
    await page.mouse.up();
    await expect(page).toHaveURL(/\/calendar$/);
  } finally {
    refresh.release();
    await info.attach("navigation-events", { body: JSON.stringify(await page.evaluate(() => (window as unknown as { completionNavigationEvents: unknown[] }).completionNavigationEvents)), contentType: "application/json" });
  }
});

test("the first Calendar tap after the completion response opens Calendar", async ({ page }, info) => {
  await loggedWorkout(page, "top-backoff", true);
  const network: unknown[] = [];
  page.on("request", request => { if (/\/(today|calendar)(\?|$)/.test(request.url())) network.push({ type: "request", url: request.url(), rsc: request.headers().rsc, nextUrl: request.headers()["next-url"] }); });
  page.on("response", response => { if (/\/(today|calendar)(\?|$)/.test(response.url())) network.push({ type: "response", url: response.url(), status: response.status() }); });
  await page.evaluate(() => {
    const events: unknown[] = [];
    const initial = document.querySelector('nav a[href="/calendar"]');
    Object.assign(window, { completionNavigationEvents: events });
    for (const type of ["pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click"]) document.addEventListener(type, event => {
      const target = event.target as Element;
      const pointer = event as MouseEvent;
      const anchor = document.querySelector('nav a[href="/calendar"]');
      events.push({ type, text: target.textContent?.trim(), tag: target.tagName, x: pointer.clientX, y: pointer.clientY, scrollY, sameAnchor: initial === anchor, nav: anchor?.getBoundingClientRect().toJSON() });
    }, true);
  });
  try {
    const response = page.waitForResponse(response => response.url().endsWith("/complete-and-advance"));
    await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
    expect((await response).ok()).toBe(true);
    await (await response).json();
    await page.getByRole("navigation").getByRole("link", { name: "Calendar", exact: true }).click();
    await expect(page).toHaveURL(/\/calendar$/);
  } finally {
    await info.attach("navigation-events", { body: JSON.stringify({ network, events: await page.evaluate(() => (window as unknown as { completionNavigationEvents: unknown[] }).completionNavigationEvents) }), contentType: "application/json" });
  }
});

test("a late completion handler cannot replace an already requested Calendar navigation", async ({ page }) => {
  await loggedWorkout(page, "top-backoff", true);
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    Object.assign(window, { releaseCompletionJson: release, completionJsonWaiting: false });
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (String(args[0]).endsWith("/complete-and-advance")) {
        const json = response.json.bind(response);
        response.json = async () => {
          const body = await json();
          Object.assign(window, { completionJsonWaiting: true });
          await pending;
          return body;
        };
      }
      return response;
    };
  });
  let release!: () => void;
  let requested!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const received = new Promise<void>(resolve => { requested = resolve; });
  await page.route("**/calendar?*", async route => {
    const response = await route.fetch();
    requested();
    await pending;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "Finish Workout", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { completionJsonWaiting: boolean }).completionJsonWaiting)).toBe(true);
    await page.getByRole("navigation").getByRole("link", { name: "Calendar", exact: true }).click();
    await received;
    await page.evaluate(() => (window as unknown as { releaseCompletionJson: () => void }).releaseCompletionJson());
  } finally { release(); }
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.locator('[aria-label="Weekly workout agenda"]')).toBeVisible();
});
