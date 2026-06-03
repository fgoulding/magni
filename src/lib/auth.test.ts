import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let auth: typeof import("./auth");
let dbModule: typeof import("./db");

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-auth-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("./db");
  auth = await import("./auth");
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
