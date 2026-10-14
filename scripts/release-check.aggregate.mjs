import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { aggregateReleaseEvidence } from "./release-check.evidence.mjs";
import { sourceIdentity } from "./release-check.mjs";

assert.equal(process.argv.length, 2, "Release aggregation accepts no skip/filter arguments");
const cwd = process.cwd();
const outputDirectory = path.join(cwd, ".playwright/release-checks");
mkdirSync(outputDirectory, { recursive: true });
const read = file => JSON.parse(readFileSync(file, "utf8"));
let result = { status: "failed", source: sourceIdentity(cwd, process.env) };
try {
  const browserDirectory = path.join(cwd, ".playwright/release-input/browser");
  const files = readdirSync(browserDirectory, { recursive: true }).filter(file => file.endsWith("/result.json"));
  result = aggregateReleaseEvidence({
    source: result.source,
    core: read(path.join(cwd, ".playwright/release-core/result.json")),
    manifest: read(path.join(cwd, ".playwright/release-core/browser-manifest.json")),
    shards: files.map(file => read(path.join(browserDirectory, file))),
    jobResults: { core: process.env.RELEASE_CORE_RESULT, browser: process.env.RELEASE_BROWSER_RESULT },
  });
} catch (error) {
  result.error = error.message;
  console.error(error);
}
writeFileSync(path.join(outputDirectory, "result.json"), JSON.stringify(result, null, 2) + "\n");
if (process.env.GITHUB_STEP_SUMMARY && result.status === "passed") {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `Verified ${result.source.commit}\n\nAll ${result.checks.length} release gates passed. ${result.browser.passed}/${result.browser.expected} browser cases passed on their first attempt across ${result.browser.shards.length} isolated shards.\n`);
}
process.exitCode = result.status === "passed" ? 0 : 1;
