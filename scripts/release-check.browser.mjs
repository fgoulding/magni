import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runCheck, sourceIdentity } from "./release-check.mjs";
import { compactBrowserReport, parseBrowserShard } from "./release-check.evidence.mjs";
import { assertFullReleaseEnvironment } from "./release-check.profile.mjs";

assertFullReleaseEnvironment();
const cwd = process.cwd();
const selection = parseBrowserShard(process.argv.slice(2));
const outputDirectory = path.join(cwd, ".playwright/release-browser");
mkdirSync(outputDirectory, { recursive: true });
const reportPath = path.join(cwd, ".playwright/e2e-results.json");
// Never accept a stale passing report after a new browser invocation fails.
rmSync(reportPath, { force: true });
const result = { source: sourceIdentity(cwd, process.env), ...selection, status: "running", startedAt: new Date().toISOString() };
const save = () => writeFileSync(path.join(outputDirectory, "result.json"), JSON.stringify(result, null, 2) + "\n");
save();
try {
  const command = {
    command: process.execPath,
    args: ["node_modules/playwright/cli.js", "test", `--project=${selection.project}`, `--shard=${selection.shard.current}/${selection.shard.total}`, "--fail-on-flaky-tests"],
  };
  result.command = [command.command, ...command.args];
  Object.assign(result, await runCheck(command, { cwd, env: { ...process.env, CI: "true", PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath }, logPath: path.join(outputDirectory, "e2e.log") }));
  assert.equal(result.exitCode, 0, "Browser shard failed");
  result.browser = compactBrowserReport(JSON.parse(readFileSync(reportPath, "utf8")));
  assert.deepEqual(result.browser.shard, selection.shard, "Browser shard configuration changed");
  assert.ok(result.browser.tests.every(test => test.project === selection.project), "Unexpected browser project ran");
  assert.deepEqual(sourceIdentity(cwd, process.env), result.source, "Source changed during browser checks");
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.error = error.message;
  console.error(error);
}
result.finishedAt = new Date().toISOString();
save();
process.exitCode = result.status === "passed" ? 0 : 1;
