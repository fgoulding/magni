import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CORE_RELEASE_CHECKS, RELEASE_CHECKS } from "./release-check.mjs";
import { aggregateReleaseEvidence, compactBrowserReport, discoveryManifest, parseBrowserShard } from "./release-check.evidence.mjs";

const source = { commit: "a".repeat(40), ref: "refs/heads/main", packageVersion: "0.1.0", dirty: false, runId: "123", runAttempt: "1" };
const projects = ["chromium", "mobile-safari"];
const cases = projects.flatMap(project => [1, 2].map(index => ({ id: `${project}-${index}`, project, file: "example.spec.ts", title: `case ${index}` })));

function report(items = cases, shard = null, discovery = false) {
  return {
    config: { metadata: { warmupProfile: "full-release" }, forbidOnly: true, fullyParallel: false, workers: 1, shard, projects: projects.map(name => ({ name, repeatEach: 1 })) },
    suites: [{ title: "example.spec.ts", specs: items.map(item => ({
      id: item.id, file: item.file, title: item.title, line: Number(item.id.at(-1)), column: 1, ok: true,
      tests: [{ projectName: item.project, expectedStatus: "passed", status: discovery ? "skipped" : "expected", results: discovery ? [] : [{ status: "passed", retry: 0, errors: [] }] }],
    })) }],
    errors: [],
    stats: { expected: discovery ? 0 : items.length, unexpected: 0, flaky: 0, skipped: discovery ? items.length : 0, duration: 100 },
  };
}

function fixture() {
  const core = { source: structuredClone(source), status: "passed", startedAt: "2026-10-13T00:00:00Z", checks: CORE_RELEASE_CHECKS.map(check => ({ name: check.name, command: [check.command, ...check.args], status: "passed", exitCode: 0 })) };
  const manifest = { source: structuredClone(source), tests: discoveryManifest(report(cases, null, true)) };
  const shards = projects.flatMap(project => [1, 2].map(current => ({
    source: structuredClone(source), status: "passed", exitCode: 0, project, shard: { current, total: 2 },
    browser: compactBrowserReport(report(cases.filter(item => item.project === project && item.id.endsWith(String(current))), { current, total: 2 })),
  })));
  return { source: structuredClone(source), core, manifest, shards, jobResults: { core: "success", browser: "success" } };
}

test("shard commands accept only both known projects and either half, without filter or skip flags", () => {
  assert.deepEqual(parseBrowserShard(["--project=chromium", "--shard=1/2"]), { project: "chromium", shard: { current: 1, total: 2 } });
  assert.deepEqual(parseBrowserShard(["--project=mobile-safari", "--shard=2/2"]), { project: "mobile-safari", shard: { current: 2, total: 2 } });
  for (const args of [[], ["--project=webkit", "--shard=1/2"], ["--project=chromium", "--shard=1/3"], ["--project=chromium", "--shard=3/2"], ["--project=chromium", "--shard=1/2", "--grep=smoke"]]) assert.throws(() => parseBrowserShard(args));
});

test("grouped multi-project discovery matches separate project reports without trusting spec.id", () => {
  const grouped = report(cases, null, true);
  const specs = grouped.suites[0].specs;
  grouped.suites[0].specs = specs.slice(0, 2).map((spec, index) => ({ ...spec, tests: [...spec.tests, ...specs[index + 2].tests] }));
  const expected = discoveryManifest(grouped);
  const ungrouped = discoveryManifest(report(cases, null, true));
  assert.equal(expected.length, 4);
  assert.equal(new Set(expected.map(item => item.id)).size, 4);
  assert.deepEqual(expected, ungrouped);
  const executed = projects.flatMap(project => [1, 2].flatMap(current => {
    const value = report(cases.filter(item => item.project === project && item.id.endsWith(String(current))), { current, total: 2 });
    value.suites[0].specs[0].id = `arbitrary-${project}-${current}`;
    return compactBrowserReport(value).tests;
  }));
  assert.deepEqual(executed.map(item => item.id).sort(), expected.map(item => item.id).sort());
  const inputs = fixture();
  inputs.manifest.tests = expected;
  assert.equal(aggregateReleaseEvidence(inputs).browser.passed, 4);
  grouped.suites[0].specs[0].tests.push(grouped.suites[0].specs[0].tests[0]);
  assert.throws(() => discoveryManifest(grouped), /Duplicate/);
});

test("discovery records every project-specific ID, including nested suites", () => {
  const value = report(cases, null, true);
  value.suites = [{ suites: value.suites, specs: [] }];
  assert.deepEqual(discoveryManifest(value).map(({ id, ...item }) => item).sort((a, b) => `${a.project}${a.title}`.localeCompare(`${b.project}${b.title}`)), cases.map(({ id, ...item }) => item));
  for (const edit of [value => value.suites = [], value => value.errors.push({ message: "load error" }), value => value.config.shard = { current: 1, total: 2 }, value => value.suites[0].specs[0].tests[0].expectedStatus = "skipped", value => value.suites[0].specs.push(value.suites[0].specs[0])]) {
    const invalid = report(cases, null, true); edit(invalid); assert.throws(() => discoveryManifest(invalid));
  }
});

test("browser compaction accepts only actual first-attempt passes and excludes bulky diagnostics", () => {
  const value = report(cases.slice(0, 1), { current: 1, total: 2 });
  value.suites[0].specs[0].tests[0].results[0].attachments = [{ body: "large", path: "private.png" }];
  const compact = compactBrowserReport(value);
  assert.equal(compact.tests.length, 1);
  assert.match(compact.tests[0].id, /^[a-f0-9]{64}$/);
  assert.equal(compact.tests[0].id, discoveryManifest(report(cases, null, true)).find(item => item.project === cases[0].project && item.title === cases[0].title).id);
  assert.doesNotMatch(JSON.stringify(compact), /large|private\.png/);
  const failures = [
    value => value.stats.skipped++, value => value.stats.flaky++, value => value.stats.unexpected++,
    value => value.errors.push({ message: "global teardown failed" }), value => value.config.workers = 2,
    value => value.config.forbidOnly = false, value => value.config.fullyParallel = true,
    value => value.suites[0].specs[0].ok = false,
    value => value.suites[0].specs[0].tests[0].status = "flaky",
    value => value.suites[0].specs[0].tests[0].expectedStatus = "failed",
    value => value.suites[0].specs[0].tests[0].results[0].retry = 1,
    value => value.suites[0].specs[0].tests[0].results[0].status = "skipped",
    value => value.suites[0].specs[0].tests[0].results[0].errors.push({ message: "failure" }),
    value => value.suites[0].specs[0].tests[0].results = [],
    value => value.suites[0].specs[0].tests[0].results.push(value.suites[0].specs[0].tests[0].results[0]),
  ];
  for (const edit of failures) { const invalid = report(cases.slice(0, 1), { current: 1, total: 2 }); edit(invalid); assert.throws(() => compactBrowserReport(invalid)); }
});

test("local focused preparation cannot become release discovery or execution evidence", () => {
  for (const discovery of [true, false]) {
    const value = report(cases, null, discovery);
    value.config.metadata = { warmupProfile: "local-focused" };
    assert.throws(() => discovery ? discoveryManifest(value) : compactBrowserReport(value), /full-release/);
  }
});

test("case identity preserves describe paths and source locations without collapsing equal titles", () => {
  const original = report([cases[0], cases[2]], null, true);
  original.suites[0] = { title: "example.spec.ts", specs: [], suites: [
    { title: "first group", specs: original.suites[0].specs },
    { title: "second group", specs: structuredClone(original.suites[0].specs) },
  ] };
  const manifest = discoveryManifest(original);
  assert.equal(manifest.length, 4);
  assert.equal(new Set(manifest.map(item => item.id)).size, 4);
  const differentLine = structuredClone(original);
  differentLine.suites[0].suites[0].specs[0].line++;
  assert.notDeepEqual(discoveryManifest(differentLine), manifest);
  const differentColumn = structuredClone(original);
  differentColumn.suites[0].suites[0].specs[0].column++;
  assert.notDeepEqual(discoveryManifest(differentColumn), manifest);
});

test("aggregate retains the eight-gate release contract and proves exact full-suite coverage", () => {
  const result = aggregateReleaseEvidence(fixture());
  assert.equal(result.status, "passed");
  assert.deepEqual(result.checks.map(check => check.name), RELEASE_CHECKS.map(check => check.name));
  assert.ok(result.checks.every(check => check.status === "passed" && check.exitCode === 0));
  assert.ok(result.checks.at(-1).command.includes("--fail-on-flaky-tests"));
  assert.equal(result.browser.expected, 4);
  assert.equal(result.browser.passed, 4);
  assert.equal(result.browser.shards.length, 4);
  assert.deepEqual(result.browser.projects, { chromium: 2, "mobile-safari": 2 });
});

test("aggregate fails closed for missing, duplicate, skipped, foreign and unverified evidence", () => {
  const failures = [
    value => value.shards.pop(), value => value.shards.push(value.shards[0]),
    value => value.shards[1] = value.shards[0], value => value.shards[0].status = "failed",
    value => value.shards[0].exitCode = 1, value => value.shards[0].shard.total = 3,
    value => value.shards[0].browser.tests = [], value => value.shards[0].browser.tests[0].id = "not-discovered",
    value => value.shards[0].browser.tests[0].project = "mobile-safari",
    value => value.shards[0].browser.tests[0].status = "skipped",
    value => value.shards[0].browser.tests[0].retry = 1,
    value => value.shards[0].browser.shard.current = 2,
    value => value.shards[0].source.commit = "b".repeat(40), value => value.shards[0].source.runAttempt = "2",
    value => value.shards[0].source.runId = "456", value => value.shards[0].source.dirty = true,
    value => value.core.source.ref = "refs/tags/v1", value => value.manifest.source.commit = "b".repeat(40),
    value => value.core.checks.pop(), value => value.core.checks[0].status = "skipped",
    value => value.core.checks[0].exitCode = 1, value => value.core.checks[0].command = ["true"],
    value => value.core.status = "failed", value => value.manifest.tests.pop(),
    value => value.manifest.tests.push(value.manifest.tests[0]), value => value.source.dirty = true,
    value => value.jobResults.browser = "skipped", value => value.jobResults.core = "cancelled",
  ];
  for (const edit of failures) { const invalid = fixture(); edit(invalid); assert.throws(() => aggregateReleaseEvidence(invalid), edit.toString()); }
});

test("real Playwright discovery and four isolated shard reports cover each case once", () => {
  // Exercise the installed reporter/sharding protocol without starting an app,
  // opening a browser or touching application data. These tests use no fixtures.
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "magni-shard-protocol-")));
  const root = path.resolve(import.meta.dirname, "..");
  try {
    const config = path.join(directory, "playwright.config.mjs");
    writeFileSync(config, `export default ${JSON.stringify({ metadata: { warmupProfile: "full-release" }, testDir: directory, forbidOnly: true, fullyParallel: false, workers: 1, projects: projects.map(name => ({ name })), outputDir: path.join(directory, "results") })};`);
    for (const file of ["first", "second"]) writeFileSync(path.join(directory, `${file}.spec.mjs`), `import { test } from ${JSON.stringify(path.join(root, "node_modules/@playwright/test/index.mjs"))};\ntest('one', () => {});\ntest('two', () => {});\n`);
    const json = path.join(directory, "report.json");
    const run = args => {
      execFileSync(process.execPath, [path.join(root, "node_modules/playwright/cli.js"), "test", `--config=${config}`, "--reporter=json", ...args], { cwd: directory, env: { ...process.env, CI: "true", PLAYWRIGHT_JSON_OUTPUT_NAME: json }, stdio: "pipe" });
      return JSON.parse(readFileSync(json, "utf8"));
    };
    const manifest = discoveryManifest(run(["--list", "--project=chromium", "--project=mobile-safari"]));
    assert.equal(manifest.length, 8);
    const actual = projects.flatMap(project => [1, 2].flatMap(current => {
      const evidence = compactBrowserReport(run([`--project=${project}`, `--shard=${current}/2`, "--fail-on-flaky-tests"]));
      assert.deepEqual(evidence.shard, { current, total: 2 });
      assert.ok(evidence.tests.every(item => item.project === project));
      return evidence.tests.map(item => item.id);
    }));
    assert.equal(new Set(actual).size, actual.length);
    assert.deepEqual(actual.sort(), manifest.map(item => item.id).sort());
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
