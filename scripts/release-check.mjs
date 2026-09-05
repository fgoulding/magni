import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finished } from "node:stream/promises";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
export const RELEASE_CHECKS = [
  { name: "gate-policy", command: process.execPath, args: ["--test", ".github/tests/release-policy.test.cjs", "scripts/release-check.test.mjs", "scripts/database-maintenance.test.mjs"] },
  { name: "dependency-audit", command: npm, args: ["audit", "--omit=dev"] },
  { name: "route-types", command: process.execPath, args: ["node_modules/next/dist/bin/next", "typegen"] },
  { name: "typecheck", command: npm, args: ["run", "typecheck"] },
  { name: "lint", command: npm, args: ["run", "lint", "--", "--max-warnings=0"] },
  { name: "tests-and-coverage", command: npm, args: ["run", "test:coverage"] },
  { name: "production-build", command: npm, args: ["run", "build"] },
  { name: "e2e", command: npm, args: ["run", "test:e2e", "--", "--project=chromium", "--project=mobile-safari", "--fail-on-flaky-tests"] },
];

function sourceIdentity(cwd, env) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const commit = git("rev-parse", "HEAD");
  if (env.GITHUB_SHA && env.GITHUB_SHA !== commit) throw new Error("Checkout does not match GITHUB_SHA");
  return {
    commit,
    ref: env.GITHUB_REF ?? git("rev-parse", "--abbrev-ref", "HEAD"),
    packageVersion: JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")).version,
    dirty: git("status", "--porcelain", "--untracked-files=normal") !== "",
    runId: env.GITHUB_RUN_ID ?? null,
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
  };
}

async function runCheck(check, { cwd, env, logPath, quiet }) {
  const log = createWriteStream(logPath);
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const child = spawn(check.command, check.args, { cwd, env, shell: process.platform === "win32" && check.command.endsWith(".cmd") });
      for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
        log.write(chunk);
        if (!quiet) process.stdout.write(chunk);
      });
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ exitCode: code ?? 1, signal }));
    });
  } catch (error) {
    log.write(`${error.message}\n`);
    result = { exitCode: 1, error: error.message };
  } finally {
    log.end();
    await finished(log);
  }
  return result;
}

/** Fail closed: no later stage starts after a failed check. No CLI skip flags. */
export async function runReleaseChecks({ cwd = process.cwd(), outputDirectory = path.join(cwd, ".playwright/release-checks"), checks = RELEASE_CHECKS, env = process.env, quiet = false } = {}) {
  mkdirSync(outputDirectory, { recursive: true });
  const databaseDirectory = mkdtempSync(path.join(outputDirectory, "build-data-"));
  const checkEnv = { ...env, DB_PATH: path.join(databaseDirectory, "build.sqlite"), NEXT_TELEMETRY_DISABLED: "1" };
  const result = {
    source: sourceIdentity(cwd, env),
    startedAt: new Date().toISOString(),
    status: "running",
    checks: checks.map(check => ({ name: check.name, command: [check.command, ...check.args], status: "pending" })),
  };
  const save = () => writeFileSync(path.join(outputDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  save();
  for (let index = 0; index < checks.length; index++) {
    const check = checks[index];
    const record = result.checks[index];
    record.status = "running";
    save();
    if (!quiet) console.log(`\nRelease check: ${check.name}`);
    Object.assign(record, await runCheck(check, { cwd, env: checkEnv, logPath: path.join(outputDirectory, `${check.name}.log`), quiet }));
    record.status = record.exitCode === 0 ? "passed" : "failed";
    if (record.status === "failed") {
      result.status = "failed";
      result.checks.slice(index + 1).forEach(pending => { pending.status = "skipped"; });
      break;
    }
    save();
  }
  if (result.status === "running") result.status = "passed";
  result.finishedAt = new Date().toISOString();
  save();
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runReleaseChecks();
  process.exitCode = result.status === "passed" ? 0 : 1;
}
