import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("runs the production operator CLI contract without TypeScript dependencies", () => {
  const result = spawnSync(process.execPath, ["--test", "scripts/program-template.test.mjs"], { encoding: "utf8" });
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
