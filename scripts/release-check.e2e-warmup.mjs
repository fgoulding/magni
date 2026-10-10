import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export function routeWarmupRequests(files) {
  const seen = new Set();
  return files.map(file => {
    if (!/(^|\/)(page\.tsx|route\.ts)$/.test(file) || file.includes("...") || file.includes("@")) {
      throw new Error(`Unsupported E2E warmup route: ${file}`);
    }
    const segments = file.split("/").slice(0, -1).filter(segment => !/^\([^)]*\)$/.test(segment));
    if (segments.some(segment => !/^(?:[a-zA-Z0-9_-]+|\[[a-zA-Z0-9_]+\])$/.test(segment))) throw new Error(`Unsupported E2E warmup route: ${file}`);
    const pathname = "/" + segments.map(segment => /^\[[^\]]+\]$/.test(segment) ? "1" : segment).join("/");
    if (seen.has(pathname)) throw new Error(`Colliding E2E warmup route: ${file}`);
    seen.add(pathname);
    const method = file.endsWith("route.ts") ? "OPTIONS" : "GET";
    return { pathname, method, ...(method === "GET" && file.includes("[") ? { allowNotFound: true } : {}) };
  });
}

function localOrigin(baseURL) {
  const url = new URL(baseURL);
  if (url.protocol !== "http:" || url.hostname !== "localhost" || url.username || url.password || url.pathname !== "/") {
    throw new Error("E2E preparation requires the disposable localhost server");
  }
  return url.origin;
}

export function assertAutomaticOptions(source, file) {
  if (/\bOPTIONS\b|export\s*\*/.test(source)) throw new Error(`Review custom OPTIONS handler before warming ${file}`);
}

export async function warmE2ERoutes({ baseURL, requests, cookie, fetchRoute = fetch }) {
  const origin = localOrigin(baseURL);
  const deadline = AbortSignal.timeout(300_000);
  for (const { pathname, method, allowNotFound } of requests) {
    if (!pathname.startsWith("/") || pathname.startsWith("//") || !["GET", "OPTIONS"].includes(method)) throw new Error("Invalid route preparation request");
    const response = await fetchRoute(origin + pathname, {
      method, headers: cookie ? { cookie } : {}, redirect: "manual",
      signal: AbortSignal.any([deadline, AbortSignal.timeout(30_000)]),
    });
    // Missing placeholder records are expected; auth rejection/server errors
    // mean preparation did not reach a handler and must fail the run.
    const valid = method === "OPTIONS"
      ? response.status === 204 && response.headers.get("allow")?.includes("OPTIONS")
      : [200, 307, 308, ...(allowNotFound ? [404] : [])].includes(response.status);
    if (!valid) throw new Error(`E2E preparation ${method} ${pathname}: ${response.status}`);
    const location = response.headers.get("location");
    if (location) {
      const target = new URL(location, origin);
      if (target.origin !== origin || target.pathname === "/login") throw new Error(`E2E preparation rejected redirect: ${pathname}`);
    }
    await response.arrayBuffer();
  }
}

export default async function prepareE2E(config) {
  const started = performance.now();
  const baseURL = config.projects[0].use.baseURL;
  localOrigin(baseURL);
  // Use ordinary registration, since the proxy rejects protected routes before
  // Next compiles them. This account belongs only to the launcher's fresh DB.
  const registered = await fetch(baseURL + "/api/auth/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `warmup-${randomUUID()}@example.test`, password: randomUUID() }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!registered.ok) throw new Error(`E2E preparation registration: ${registered.status}`);
  const account = await registered.json();
  const cookie = registered.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  if (!cookie.includes("auth_token=")) throw new Error("E2E preparation registration did not create a session");
  const authenticated = await fetch(baseURL + "/api/auth/me", { headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  if (!authenticated.ok || (await authenticated.json()).id !== account.id) throw new Error("E2E preparation session did not authenticate its account");
  const app = path.resolve("src/app");
  const files = readdirSync(app, { recursive: true }).filter(file => /(^|\/)(page\.tsx|route\.ts)$/.test(file)).sort();
  for (const file of files.filter(file => file.endsWith("route.ts"))) {
    assertAutomaticOptions(readFileSync(path.join(app, file), "utf8"), file);
  }
  await warmE2ERoutes({ baseURL, requests: routeWarmupRequests(files), cookie });
  console.log(`Prepared ${files.length} compiled routes in ${((performance.now() - started) / 1000).toFixed(1)}s before browser test deadlines`);
}
