import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { templateHash } from "../src/features/program-templates/storage.mjs";

test("operator CLI previews, publishes, retries and rolls back only matching rehearsed content", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-template-cli-"));
  try {
    const template = JSON.parse(fs.readFileSync("program-templates/full-body-supersets-3-day.json", "utf8"));
    template.revision = 2;
    const candidate = path.join(directory, "candidate.json"); const receipt = path.join(directory, "receipt.json");
    fs.writeFileSync(candidate, JSON.stringify(template));
    fs.writeFileSync(receipt, JSON.stringify({ schemaVersion: 1, status: "passed", templateSha256: templateHash(template), engineRevision: "verified-engine", engineSourceMatches: true }));
    const run = (...args) => spawnSync(process.execPath, ["scripts/program-template.mjs", ...args], { encoding: "utf8", env: { ...process.env, PROGRAM_TEMPLATES_DIR: path.join(directory, "catalog"), APP_REVISION: "verified-engine" } });
    const preview = run("preview", candidate); assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).days[0].sets, 26);
    assert.notEqual(run("publish", candidate, "--expect-current", "1").status, 0);
    const publish = run("publish", candidate, "--expect-current", "1", "--receipt", receipt);
    assert.equal(publish.status, 0, publish.stderr); assert.equal(JSON.parse(publish.stdout).revision, 2);
    assert.equal(JSON.parse(run("publish", candidate, "--expect-current", "1", "--receipt", receipt).stdout).unchanged, true);
    assert.equal(JSON.parse(run("list").stdout)[0].revision, 2);
    const rollback = run("rollback", template.id, "--revision", "1", "--expect-current", "2");
    assert.equal(rollback.status, 0, rollback.stderr); assert.equal(JSON.parse(run("list").stdout)[0].revision, 1);
    const changed = { ...template, title: "Changed after rehearsal" }; fs.writeFileSync(candidate, JSON.stringify(changed));
    assert.notEqual(run("publish", candidate, "--expect-current", "1", "--receipt", receipt).status, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
