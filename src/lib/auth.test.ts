import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createUnexpiredAuthSession } from "@/__tests__/auth-fixture";

let auth: typeof import("./auth");
let dbModule: typeof import("./db");

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-auth-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("./db");
  auth = await import("./auth");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("password hashing", () => {
  it("hashes passwords and verifies only the matching password", async () => {
    const hash = await auth.hashPassword("correct horse battery staple");

    expect(hash).not.toBe("correct horse battery staple");
    expect(await auth.verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await auth.verifyPassword("wrong password", hash)).toBe(false);
  });
});

describe("session tokens", () => {
  it("creates sessions with the configured 30-day lifetime", () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("session-lifetime@example.com", "hash");
    const before = Date.now();
    const { token, expiresAt } = auth.createSession(Number(user.lastInsertRowid));
    const after = Date.now();
    const lifetime = 30 * 24 * 60 * 60 * 1000;

    expect(Date.parse(expiresAt)).toBeGreaterThanOrEqual(before + lifetime);
    expect(Date.parse(expiresAt)).toBeLessThanOrEqual(after + lifetime);
    expect(auth.getUserByToken(token)?.id).toBe(Number(user.lastInsertRowid));
  });

  it("rejects and cleans up expired tokens while retaining valid tokens", () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("session-expiration@example.com", "hash");
    const valid = auth.createSession(Number(user.lastInsertRowid));
    const expired = auth.createSession(Number(user.lastInsertRowid));
    dbModule.db.prepare("UPDATE auth_sessions SET expires_at = datetime('now', '-1 day') WHERE token = ?")
      .run(expired.token);

    expect(auth.getUserByToken(expired.token)).toBeNull();
    expect(auth.getUserByToken(valid.token)?.id).toBe(Number(user.lastInsertRowid));
    auth.cleanupExpiredSessions();
    expect(dbModule.db.prepare("SELECT token FROM auth_sessions WHERE token = ?").get(expired.token)).toBeUndefined();
    expect(auth.getUserByToken(valid.token)?.id).toBe(Number(user.lastInsertRowid));
  });

  it("keeps workout authentication fixtures valid independently of a past workout clock", () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("workout-clock@example.com", "hash");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2000-01-01T12:00:00Z"));
    const token = createUnexpiredAuthSession(dbModule.db, auth, Number(user.lastInsertRowid));

    expect(auth.getUserByToken(token)?.id).toBe(Number(user.lastInsertRowid));
    expect(new Date().getUTCFullYear()).toBe(2000);
    dbModule.db.prepare("UPDATE auth_sessions SET expires_at = datetime('now', '-1 day') WHERE token = ?")
      .run(token);
    expect(auth.getUserByToken(token)).toBeNull();
  });

  it("generates unique 64-character hex tokens", () => {
    const first = auth.generateToken();
    const second = auth.generateToken();

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });

  it("deleting a server session invalidates token lookup", () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("session@example.com", "hash");

    const { token } = auth.createSession(Number(user.lastInsertRowid));

    expect(auth.getUserByToken(token)).toEqual({
      id: Number(user.lastInsertRowid),
      email: "session@example.com",
    });

    auth.deleteSession(token);

    expect(auth.getUserByToken(token)).toBeNull();
  });
});
