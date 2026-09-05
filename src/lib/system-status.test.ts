import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
let status: typeof import("./system-status");
let db: (typeof import("./db"))["db"];
const directory = fs.mkdtempSync(path.join(os.tmpdir(),"magni-status-"));
beforeAll(async () => { vi.stubEnv("DB_PATH",path.join(directory,"database.db")); status=await import("./system-status"); db=(await import("./db")).db; });
afterAll(() => { db.close(); fs.rmSync(directory,{recursive:true,force:true});vi.unstubAllEnvs(); });
describe("operational status", () => {
  it("reports storage and distinguishes absent backup evidence", () => {
    const result=status.getSystemStatus();expect(result.databaseReady).toBe(true);expect(result.databaseBytes).toBeGreaterThan(0);expect(result.freeBytes).toBeGreaterThan(0);expect(result.backup).toBeNull();
  });
  it("shows current and stale verified backup timestamps", () => {
    fs.writeFileSync(path.join(directory,"backup-status.json"),JSON.stringify({completedAt:"2026-09-05T12:00:00Z",sha256:"a".repeat(64),bytes:4096}));
    expect(status.getSystemStatus(Date.parse("2026-09-06T12:00:00Z")).backup).toMatchObject({ageHours:24,stale:false});
    expect(status.getSystemStatus(Date.parse("2026-09-08T12:00:00Z")).backup).toMatchObject({ageHours:72,stale:true});
  });
  it("rejects malformed backup receipts and reports runtime revision", () => {
    fs.writeFileSync(path.join(directory,"backup-status.json"),"{invalid");vi.stubEnv("APP_REVISION","verified-commit");
    expect(status.getSystemStatus()).toMatchObject({revision:"verified-commit",backup:null});
    fs.writeFileSync(path.join(directory,"backup-status.json"),JSON.stringify({completedAt:"bad",sha256:"x",bytes:0}));expect(status.getSystemStatus().backup).toBeNull();
  });
});
