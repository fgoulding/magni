import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { RELEASE_CHECKS, runReleaseChecks } from "./release-check.mjs";
import { createE2EServerOptions } from "./release-check.e2e-server.mjs";
import { assertAutomaticOptions, routeWarmupRequests, warmE2ERoutes } from "./release-check.e2e-warmup.mjs";

test("release contract includes current coverage, strict lint, production build and both browser projects", () => {
  assert.deepEqual(RELEASE_CHECKS.map(check => check.name), ["gate-policy", "dependency-audit", "route-types", "typecheck", "lint", "tests-and-coverage", "production-build", "e2e"]);
  assert.deepEqual(RELEASE_CHECKS.find(check => check.name === "dependency-audit").args, ["audit", "--omit=dev"]);
  assert.deepEqual(RELEASE_CHECKS.find(check => check.name === "tests-and-coverage").args, ["run", "test:coverage"]);
  assert.ok(RELEASE_CHECKS.find(check => check.name === "lint").args.includes("--max-warnings=0"));
  assert.deepEqual(RELEASE_CHECKS.at(-1).args, ["run", "test:e2e", "--", "--project=chromium", "--project=mobile-safari", "--fail-on-flaky-tests"]);
});

test("a failed check blocks subsequent stages and persists its exit code and output", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "magni-gate-test-"));
  const marker = path.join(directory, "must-not-run");
  try {
    const result = await runReleaseChecks({ outputDirectory: directory, quiet: true, env: {}, checks: [
      { name: "reject", command: process.execPath, args: ["-e", "console.error('deliberate gate failure'); process.exit(7)"] },
      { name: "blocked", command: process.execPath, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`] },
    ] });
    assert.equal(result.status, "failed");
    assert.deepEqual(result.checks.map(check => check.status), ["failed", "skipped"]);
    assert.equal(result.checks[0].exitCode, 7);
    assert.equal(existsSync(marker), false);
    assert.match(readFileSync(path.join(directory, "reject.log"), "utf8"), /deliberate gate failure/);
    const saved = JSON.parse(readFileSync(path.join(directory, "result.json"), "utf8"));
    assert.equal(saved.status, "failed");
    assert.match(saved.source.commit, /^[a-f0-9]{40}$/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("release identity does not call a checkout clean when it contains new source files", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "magni-source-identity-test-"));
  const outputDirectory = mkdtempSync(path.join(os.tmpdir(), "magni-source-identity-output-"));
  const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  try {
    git("init");
    writeFileSync(path.join(directory, "package.json"), '{"version":"1.0.0"}\n');
    git("add", "package.json");
    git("-c", "user.name=Release test", "-c", "user.email=release@example.test", "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${path.join(directory, "no-hooks")}`, "commit", "-m", "Fixture");
    const clean = await runReleaseChecks({ cwd: directory, outputDirectory, quiet: true, env: {}, checks: [] });
    assert.equal(clean.source.dirty, false);
    writeFileSync(path.join(directory, "new-route.ts"), "export const candidate = true;\n");
    const withNewSource = await runReleaseChecks({ cwd: directory, outputDirectory, quiet: true, env: {}, checks: [] });
    assert.equal(withNewSource.source.commit, clean.source.commit);
    assert.equal(withNewSource.source.dirty, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("E2E runs always get separate disposable databases and isolated Next output", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "magni-e2e-launcher-test-"));
  const personalDatabase = path.join(directory, "personal.sqlite");
  writeFileSync(personalDatabase, "preserve personal data");
  try {
    const env = { DB_PATH: personalDatabase, NODE_ENV: "production", REGISTER_ALLOWLIST: "owner@example.com", NEXT_DIST_DIR: ".next" };
    const first = createE2EServerOptions({ cwd: directory, env });
    const second = createE2EServerOptions({ cwd: directory, env });
    assert.notEqual(first.env.DB_PATH, second.env.DB_PATH);
    assert.ok(first.env.DB_PATH.startsWith(path.join(directory, ".playwright", "e2e-")));
    assert.equal(readFileSync(personalDatabase, "utf8"), "preserve personal data");
    assert.notEqual(first.env.NEXT_DIST_DIR, ".next");
    assert.notEqual(first.env.NEXT_DIST_DIR, second.env.NEXT_DIST_DIR);
    assert.equal(first.env.NODE_ENV, "development");
    assert.equal(first.env.MAGNI_E2E_KEEP_ROUTES, "1");
    assert.equal(first.env.REGISTER_ALLOWLIST, "");
    assert.equal(first.args.at(-1), "3108");
    assert.equal(first.args[0], path.join(directory, "node_modules/next/dist/bin/next"));
    assert.equal(JSON.parse(readFileSync(path.join(directory, first.env.NEXT_TSCONFIG_PATH), "utf8")).compilerOptions.baseUrl, directory);
    assert.throws(() => createE2EServerOptions({ cwd: directory, env: { E2E_PORT: "3108;echo unsafe" } }), /valid TCP port/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("E2E preparation compiles pages and API handlers without invoking write methods", async () => {
  assertAutomaticOptions("export async function POST() {}", "safe/route.ts");
  for (const source of ["export function OPTIONS() {}", "export { handler as OPTIONS }", "export * from './handlers'"]) {
    assert.throws(() => assertAutomaticOptions(source, "unsafe/route.ts"), /custom OPTIONS/);
  }
  const routes = ["login/page.tsx", "page.tsx", "workouts/[sessionId]/page.tsx", "api/sessions/[sessionId]/route.ts", "api/auth/logout/route.ts", "(account)/settings/page.tsx"];
  const requests = routeWarmupRequests(routes);
  assert.deepEqual(requests, [
    { pathname: "/login", method: "GET" }, { pathname: "/", method: "GET" },
    { pathname: "/workouts/1", method: "GET", allowNotFound: true }, { pathname: "/api/sessions/1", method: "OPTIONS" },
    { pathname: "/api/auth/logout", method: "OPTIONS" }, { pathname: "/settings", method: "GET" },
  ]);
  assert.throws(() => routeWarmupRequests(["api/[...path]/route.ts"]), /Unsupported/);
  assert.throws(() => routeWarmupRequests(["(account)/settings/page.tsx", "settings/page.tsx"]), /Colliding/);
  const seen = [];
  await warmE2ERoutes({ baseURL: "http://localhost:3108", requests, fetchRoute: async (url, options) => {
    seen.push([url, options.method]); return options.method === "OPTIONS" ? new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } }) : new Response("");
  } });
  assert.deepEqual(seen, requests.map(request => [`http://localhost:3108${request.pathname}`, request.method]));
  await assert.rejects(warmE2ERoutes({ baseURL: "https://magni.tylergould.ing", requests, fetchRoute: () => { throw new Error("must not request live"); } }), /localhost/);
  await assert.rejects(warmE2ERoutes({ baseURL: "http://localhost:3108", requests, fetchRoute: async () => new Response("failed", { status: 500 }) }), /500/);
  await assert.rejects(warmE2ERoutes({ baseURL: "http://localhost:3108", requests, fetchRoute: async () => new Response("", { status: 404 }) }), /404/);
  await assert.rejects(warmE2ERoutes({ baseURL: "http://localhost:3108", requests: [requests[3]], fetchRoute: async () => new Response("") }), /200/);
  await assert.rejects(warmE2ERoutes({ baseURL: "http://localhost:3108", requests, fetchRoute: async () => new Response(null, { status: 307, headers: { location: "/login" } }) }), /redirect/);
  await warmE2ERoutes({ baseURL: "http://localhost:3108", requests: [requests[2]], fetchRoute: async () => new Response("", { status: 404 }) });
});

test("E2E teardown restores generated route types without overwriting another build", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "magni-e2e-types-test-"));
  const nextEnv = path.join(directory, "next-env.d.ts");
  const original = 'import "./.next/types/routes.d.ts";\n';
  writeFileSync(nextEnv, original);
  try {
    const options = createE2EServerOptions({ cwd: directory, env: {} });
    assert.equal(typeof options.restoreGeneratedTypes, "function");
    writeFileSync(nextEnv, `import "./${options.env.NEXT_DIST_DIR}/dev/types/routes.d.ts";\n`);
    options.restoreGeneratedTypes();
    assert.equal(readFileSync(nextEnv, "utf8"), original);
    writeFileSync(nextEnv, 'import "./another-build/types/routes.d.ts";\n');
    options.restoreGeneratedTypes();
    assert.equal(readFileSync(nextEnv, "utf8"), 'import "./another-build/types/routes.d.ts";\n');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
