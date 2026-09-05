import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Runs before each test file's static imports. Even a pure helper test may import
// the application database indirectly; never inherit a personal or production DB.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "magni-vitest-isolated-"));
process.env.DB_PATH = path.join(directory, "test.sqlite");
afterAll(() => { fs.rmSync(directory, { recursive: true, force: true }); });
