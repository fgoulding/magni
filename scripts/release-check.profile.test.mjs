import assert from "node:assert/strict";
import test from "node:test";
import * as warmup from "./release-check.e2e-warmup.mjs";
import { runReleaseChecks } from "./release-check.mjs";
import { existsSync } from "node:fs";

const focused = {
  MAGNI_E2E_WARMUP_PROFILE: "local-focused",
  MAGNI_E2E_WARMUP_ROUTES: JSON.stringify(["today/page.tsx", "api/auth/login/route.ts"]),
  MAGNI_E2E_FOCUSED_OUTPUT: ".playwright/local-focused-123",
};

test("local profile selects only explicit known routes while default keeps complete discovery", () => {
  assert.equal(typeof warmup.selectWarmupFiles, "function");
  const files = ["today/page.tsx", "calendar/page.tsx", "api/auth/login/route.ts"];
  assert.deepEqual(warmup.selectWarmupFiles(files, {}), files);
  assert.deepEqual(warmup.selectWarmupFiles(files, focused), ["today/page.tsx", "api/auth/login/route.ts"]);
  for (const env of [
    { ...focused, CI: "true" }, { ...focused, GITHUB_ACTIONS: "true" },
    { ...focused, MAGNI_E2E_WARMUP_ROUTES: "[]" },
    { ...focused, MAGNI_E2E_WARMUP_ROUTES: '["missing/page.tsx"]' },
    { ...focused, MAGNI_E2E_WARMUP_ROUTES: '["../today/page.tsx"]' },
    { ...focused, MAGNI_E2E_WARMUP_ROUTES: '["today/page.tsx","today/page.tsx"]' },
    { ...focused, MAGNI_E2E_FOCUSED_OUTPUT: ".playwright/release-checks" },
    { MAGNI_E2E_WARMUP_ROUTES: focused.MAGNI_E2E_WARMUP_ROUTES },
    { MAGNI_E2E_WARMUP_PROFILE: "typo" },
  ]) assert.throws(() => warmup.selectWarmupFiles(files, env));
});

test("release runner rejects a focused environment before creating output or checking Git", async () => {
  await assert.rejects(runReleaseChecks({ cwd: "/does-not-exist", env: focused, checks: [] }), /full-release/);
});

test("focused CLI is local, explicit, isolated and cannot redirect output into release evidence", async () => {
  assert.equal(existsSync(new URL("./release-check.focused.mjs", import.meta.url)), true);
  const { focusedInvocation } = await import("./release-check.focused.mjs");
  const args = ["--route=today/page.tsx", "--", "tests/e2e/workout-save-toggle.spec.ts", "--project=mobile-safari"];
  const result = focusedInvocation(args, { PLAYWRIGHT_JSON_OUTPUT_NAME: ".playwright/release-checks/result.json" }, "fixture");
  assert.equal(result.env.MAGNI_E2E_WARMUP_PROFILE, "local-focused");
  assert.equal(result.env.MAGNI_E2E_FOCUSED_OUTPUT, ".playwright/local-focused-fixture");
  assert.equal(result.env.PLAYWRIGHT_JSON_OUTPUT_NAME, undefined);
  assert.equal(result.env.PLAYWRIGHT_HTML_OPEN, "never");
  assert.deepEqual(result.args, ["node_modules/playwright/cli.js", "test", ...args.slice(2)]);
  for (const input of [[], ["--"], ["--route=today/page.tsx", "--", "--config=other.ts"], ["--route=today/page.tsx", "--", "--output=.playwright/release-checks"], ["--route=today/page.tsx", "--", "--reporter=json"]]) assert.throws(() => focusedInvocation(input, {}, "fixture"));
  assert.throws(() => focusedInvocation(args, { CI: "true" }, "fixture"), /full-release/);
});
