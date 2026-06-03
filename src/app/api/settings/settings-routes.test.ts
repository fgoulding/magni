import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const cookieMock = vi.hoisted(() => {
  const store = new Map<string, string>();

  return {
    store,
    cookies: {
      get: vi.fn((name: string) => {
        const value = store.get(name);
        return value ? { name, value } : undefined;
      }),
      set: vi.fn((name: string, value: string) => {
        store.set(name, value);
      }),
      delete: vi.fn((name: string) => {
        store.delete(name);
      }),
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => cookieMock.cookies,
}));

let dbModule: typeof import("@/lib/db");
let auth: typeof import("@/lib/auth");
let settingsRoute: typeof import("./route");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-settings-routes-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("@/lib/db");
  auth = await import("@/lib/auth");
  settingsRoute = await import("./route");
});

beforeEach(() => {
  cookieMock.store.clear();
  vi.clearAllMocks();
  dbModule.db.exec(
    "DELETE FROM session_sets; DELETE FROM sessions; DELETE FROM week_settings; DELETE FROM exercises; DELETE FROM days; DELETE FROM programs; DELETE FROM user_settings; DELETE FROM auth_sessions; DELETE FROM users;",
  );
});

describe("settings routes", () => {
  it("reads and updates settings for the authenticated user", async () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("settings@example.com", "hash");
    const { token } = auth.createSession(Number(user.lastInsertRowid));
    cookieMock.store.set("auth_token", token);

    const updateResponse = await settingsRoute.POST(jsonRequest({ rounding: 5 }));
    expect(updateResponse.status).toBe(200);

    const getResponse = await settingsRoute.GET();
    const settings = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(settings.rounding).toBe("5");
  });

  it("rejects invalid rounding values", async () => {
    const user = dbModule.db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run("bad-settings@example.com", "hash");
    const { token } = auth.createSession(Number(user.lastInsertRowid));
    cookieMock.store.set("auth_token", token);

    const response = await settingsRoute.POST(jsonRequest({ rounding: -1 }));

    expect(response.status).toBe(400);
  });

  it("requires authentication", async () => {
    expect((await settingsRoute.GET()).status).toBe(401);
    expect((await settingsRoute.POST(jsonRequest({ rounding: 5 }))).status).toBe(401);
  });
});
