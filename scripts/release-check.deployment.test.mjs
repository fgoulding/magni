import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

test("tracked deployment guards pass offline configuration, preservation and promotion checks", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const result = spawnSync("python3", ["-B", "scripts/deployment/guards_test.py"], {
    cwd: root, encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
