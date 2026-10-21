import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CORE_RELEASE_CHECKS, runCheck, runReleaseChecks, sourceIdentity } from "./release-check.mjs";
import { discoveryManifest } from "./release-check.evidence.mjs";
import { assertFullReleaseEnvironment } from "./release-check.profile.mjs";

// This fixed CI stage cannot publish by itself. The aggregate additionally
// requires every browser shard and exact full-suite coverage for the same SHA.
assert.equal(process.argv.length, 2, "The core release stage accepts no skip/filter arguments");
assertFullReleaseEnvironment();
const cwd = process.cwd();
const outputDirectory = path.join(cwd, ".playwright/release-core");
mkdirSync(outputDirectory, { recursive: true });
const result = await runReleaseChecks({ outputDirectory, checks: CORE_RELEASE_CHECKS });
if (result.status === "passed") {
  try {
    const discoveryPath = path.join(outputDirectory, "discovery.json");
    result.discovery = await runCheck({
      command: process.execPath,
      args: ["node_modules/playwright/cli.js", "test", "--list", "--project=chromium", "--project=mobile-safari", "--reporter=json"],
    }, { cwd, env: { ...process.env, CI: "true", PLAYWRIGHT_JSON_OUTPUT_NAME: discoveryPath }, logPath: path.join(outputDirectory, "discovery.log") });
    assert.equal(result.discovery.exitCode, 0, "Complete browser discovery failed");
    const tests = discoveryManifest(JSON.parse(readFileSync(discoveryPath, "utf8")));
    assert.deepEqual(sourceIdentity(cwd, process.env), result.source, "Source changed during browser discovery");
    writeFileSync(path.join(outputDirectory, "browser-manifest.json"), JSON.stringify({ source: result.source, tests }, null, 2) + "\n");
  } catch (error) {
    result.status = "failed";
    result.error = error.message;
    console.error(error);
  }
}
result.finishedAt = new Date().toISOString();
writeFileSync(path.join(outputDirectory, "result.json"), JSON.stringify(result, null, 2) + "\n");
process.exitCode = result.status === "passed" ? 0 : 1;
