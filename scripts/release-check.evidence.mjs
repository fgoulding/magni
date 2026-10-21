import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { CORE_RELEASE_CHECKS, RELEASE_CHECKS } from "./release-check.mjs";

export const BROWSER_PROJECTS = ["chromium", "mobile-safari"];
export const SHARDS_PER_PROJECT = 2;

export function parseBrowserShard(args) {
  assert.equal(args.length, 2, "Exactly one project and shard are required; filters are not accepted");
  const project = args[0].replace(/^--project=/, "");
  assert.ok(args[0].startsWith("--project=") && BROWSER_PROJECTS.includes(project), "Unknown browser project");
  const match = /^--shard=([12])\/2$/.exec(args[1]);
  assert.ok(match, "Browser releases require shard 1/2 or 2/2");
  return { project, shard: { current: Number(match[1]), total: SHARDS_PER_PROJECT } };
}

function assertReportConfig(report) {
  assert.equal(report.config.metadata?.warmupProfile, "full-release", "Browser evidence requires full-release preparation");
  assert.deepEqual(report.errors, [], "Browser collection/teardown must have no errors");
  assert.equal(report.config.forbidOnly, true, "Focused tests must be forbidden");
  assert.equal(report.config.workers, 1, "Each runner must retain one isolated worker");
  assert.equal(report.config.fullyParallel, false, "Tests within a file must retain their order");
  assert.deepEqual(report.config.projects.map(project => project.name).sort(), [...BROWSER_PROJECTS].sort());
  assert.ok(report.config.projects.every(project => project.repeatEach === 1), "Repeated cases are not release evidence");
}

function reportCases(report) {
  const result = [];
  const walk = (suites, parents = []) => {
    for (const suite of suites) {
      const titles = typeof suite.title === "string" ? [...parents, suite.title] : parents;
      for (const spec of suite.specs ?? []) {
        assert.ok(Array.isArray(spec.tests) && spec.tests.length > 0, "A browser spec must contain project cases");
        assert.ok(typeof spec.file === "string" && spec.file && typeof spec.title === "string" && spec.title);
        assert.ok(Number.isInteger(spec.line) && spec.line > 0 && Number.isInteger(spec.column) && spec.column > 0, "Browser cases require source locations");
        for (const test of spec.tests) {
          // JSON reports can merge projects into one spec, retaining only the
          // first project's spec.id. Use source identity plus the project so
          // full discovery and separately executed shards agree in either form.
          const identity = [test.projectName, spec.file, [...titles, spec.title], spec.line, spec.column];
          const id = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
          result.push({ id, project: test.projectName, file: spec.file, title: spec.title, spec, test });
        }
      }
      walk(suite.suites ?? [], titles);
    }
  };
  walk(report.suites);
  assert.ok(result.length > 0, "Browser evidence must contain tests");
  assert.equal(new Set(result.map(item => item.id)).size, result.length, "Duplicate browser test IDs");
  for (const item of result) {
    assert.ok(typeof item.id === "string" && item.id && typeof item.file === "string" && item.file && typeof item.title === "string" && item.title);
    assert.ok(BROWSER_PROJECTS.includes(item.project), "Unexpected browser project");
    assert.equal(item.test.expectedStatus, "passed", "Skipped/expected-failure tests cannot establish a release");
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export function discoveryManifest(report) {
  assertReportConfig(report);
  assert.equal(report.config.shard, null, "Expected cases must be discovered without sharding");
  const tests = reportCases(report);
  assert.ok(tests.every(item => item.test.results.length === 0), "Discovery cannot be substituted with execution results");
  for (const project of BROWSER_PROJECTS) assert.ok(tests.some(item => item.project === project), `No discovered ${project} tests`);
  return tests.map(({ id, project, file, title }) => ({ id, project, file, title }));
}

export function compactBrowserReport(report) {
  assertReportConfig(report);
  const tests = reportCases(report);
  assert.deepEqual([report.stats.unexpected, report.stats.flaky, report.stats.skipped], [0, 0, 0], "Every case must pass without skips or retries");
  assert.equal(report.stats.expected, tests.length, "Report counts disagree with test cases");
  for (const { spec, test } of tests) {
    assert.equal(spec.ok, true);
    assert.equal(test.status, "expected");
    assert.equal(test.results.length, 1, "Retries cannot turn a failure into a release pass");
    assert.equal(test.results[0].status, "passed");
    assert.equal(test.results[0].retry, 0);
    assert.deepEqual(test.results[0].errors, []);
    assert.ok(!test.results[0].error, "Passing result contains an error");
  }
  return {
    shard: report.config.shard,
    durationMs: report.stats.duration,
    tests: tests.map(({ id, project, file, title }) => ({ id, project, file, title, status: "passed", retry: 0 })),
  };
}

function assertSource(actual, expected) {
  assert.equal(actual.dirty, false, "Release evidence requires a clean checkout");
  for (const field of ["commit", "ref", "packageVersion", "runId", "runAttempt"]) assert.equal(actual[field], expected[field], `Mismatched evidence ${field}`);
}

export function aggregateReleaseEvidence({ source, core, manifest, shards, jobResults }) {
  assert.match(source.commit, /^[a-f0-9]{40}$/);
  assert.match(source.runId, /^\d+$/);
  assert.match(source.runAttempt, /^[1-9]\d*$/);
  assertSource(source, source);
  assert.deepEqual(jobResults, { core: "success", browser: "success" }, "All prerequisite jobs must succeed");
  assertSource(core.source, source);
  assertSource(manifest.source, source);
  assert.equal(core.status, "passed");
  assert.deepEqual(core.checks.map(check => check.name), CORE_RELEASE_CHECKS.map(check => check.name), "Core gate set changed");
  for (const [index, check] of core.checks.entries()) {
    const required = CORE_RELEASE_CHECKS[index];
    assert.equal(check.status, "passed");
    assert.equal(check.exitCode, 0);
    assert.equal(path.basename(check.command[0]), path.basename(required.command));
    assert.deepEqual(check.command.slice(1), required.args, `Unverified command for ${check.name}`);
  }
  assert.ok(manifest.tests.length > 0);
  const expected = new Map(manifest.tests.map(item => [item.id, item]));
  assert.equal(expected.size, manifest.tests.length, "Duplicate discovered test IDs");
  const executed = new Set();
  const seenShards = new Set();
  assert.equal(shards.length, BROWSER_PROJECTS.length * SHARDS_PER_PROJECT, "Every browser shard is required");
  for (const receipt of shards) {
    assertSource(receipt.source, source);
    assert.equal(receipt.status, "passed");
    assert.equal(receipt.exitCode, 0);
    const { project, shard, browser } = receipt;
    assert.ok(BROWSER_PROJECTS.includes(project));
    assert.equal(shard.total, SHARDS_PER_PROJECT);
    assert.ok([1, 2].includes(shard.current));
    assert.deepEqual(browser.shard, shard, "Executed shard does not match its receipt");
    const key = `${project}-${shard.current}`;
    assert.ok(!seenShards.has(key), "Duplicate browser shard");
    seenShards.add(key);
    assert.ok(browser.tests.length > 0, "Empty browser shard");
    for (const item of browser.tests) {
      assert.equal(item.project, project, "Shard contains a different project");
      assert.equal(item.status, "passed");
      assert.equal(item.retry, 0);
      assert.ok(!executed.has(item.id), `Duplicate executed case: ${item.id}`);
      const wanted = expected.get(item.id);
      assert.ok(wanted, `Undiscovered executed case: ${item.id}`);
      for (const field of ["project", "file", "title"]) assert.equal(item[field], wanted[field]);
      executed.add(item.id);
    }
  }
  assert.equal(executed.size, expected.size, "Missing browser cases");
  const e2e = RELEASE_CHECKS.at(-1);
  return {
    source, startedAt: core.startedAt, finishedAt: new Date().toISOString(), status: "passed",
    checks: [...core.checks, { name: e2e.name, command: [e2e.command, ...e2e.args], status: "passed", exitCode: 0 }],
    browser: {
      expected: expected.size, passed: executed.size,
      projects: Object.fromEntries(BROWSER_PROJECTS.map(project => [project, manifest.tests.filter(item => item.project === project).length])),
      shards: shards.map(({ project, shard, browser }) => ({ project, ...shard, passed: browser.tests.length, durationMs: browser.durationMs })),
    },
  };
}
