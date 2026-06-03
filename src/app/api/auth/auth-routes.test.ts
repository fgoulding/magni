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
let registerRoute: typeof import("./register/route");
let loginRoute: typeof import("./login/route");
let logoutRoute: typeof import("./logout/route");
let meRoute: typeof import("./me/route");

function jsonRequest(body: unknown, url = "http://localhost/api/auth"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workout-auth-routes-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  dbModule = await import("@/lib/db");
  registerRoute = await import("./register/route");
  loginRoute = await import("./login/route");
  logoutRoute = await import("./logout/route");
  meRoute = await import("./me/route");
});

beforeEach(() => {
  cookieMock.store.clear();
  vi.clearAllMocks();
  dbModule.db.exec(
    "DELETE FROM session_sets; DELETE FROM sessions; DELETE FROM week_settings; DELETE FROM exercises; DELETE FROM days; DELETE FROM programs; DELETE FROM user_settings; DELETE FROM auth_sessions; DELETE FROM users;",
  );
});

describe("auth routes", () => {
  it("registers a user, seeds settings, and sets an auth cookie", async () => {
    const response = await registerRoute.POST(jsonRequest({ email: "USER@Example.com ", password: "secret123" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ email: "user@example.com" });
    expect(cookieMock.store.get("auth_token")).toMatch(/^[a-f0-9]{64}$/);
    expect(cookieMock.cookies.set).toHaveBeenLastCalledWith(
      "auth_token",
      expect.any(String),
      expect.objectContaining({ secure: false }),
    );

    const setting = dbModule.db
      .prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'rounding'")
      .get(body.id) as { value: string } | undefined;

    expect(setting?.value).toBe("2.5");
  });

  it("rejects invalid and duplicate registration attempts", async () => {
    expect((await registerRoute.POST(jsonRequest({ email: "bad", password: "secret123" }))).status).toBe(400);
    expect((await registerRoute.POST(jsonRequest({ email: "dupe@example.com", password: "secret123" }))).status).toBe(201);
    expect((await registerRoute.POST(jsonRequest({ email: "dupe@example.com", password: "secret123" }))).status).toBe(409);
  });

  it("enforces the registration allowlist when REGISTER_ALLOWLIST is set", async () => {
    const previous = process.env.REGISTER_ALLOWLIST;
    process.env.REGISTER_ALLOWLIST = "allowed@example.com";
    try {
      expect((await registerRoute.POST(jsonRequest({ email: "stranger@example.com", password: "secret123" }))).status).toBe(403);
      expect((await registerRoute.POST(jsonRequest({ email: "allowed@example.com", password: "secret123" }))).status).toBe(201);
    } finally {
      if (previous === undefined) delete process.env.REGISTER_ALLOWLIST;
      else process.env.REGISTER_ALLOWLIST = previous;
    }
  });

  it("logs in with a valid password and rejects an invalid password", async () => {
    await registerRoute.POST(jsonRequest({ email: "login@example.com", password: "secret123" }));
    cookieMock.store.clear();

    const badResponse = await loginRoute.POST(jsonRequest({ email: "login@example.com", password: "wrong" }));
    expect(badResponse.status).toBe(401);
    expect(cookieMock.store.get("auth_token")).toBeUndefined();

    const goodResponse = await loginRoute.POST(jsonRequest({ email: "login@example.com", password: "secret123" }));
    const body = await goodResponse.json();

    expect(goodResponse.status).toBe(200);
    expect(body.email).toBe("login@example.com");
    expect(cookieMock.store.get("auth_token")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("marks auth cookies secure only for HTTPS requests", async () => {
    await registerRoute.POST(jsonRequest({ email: "secure-cookie@example.com", password: "secret123" }));
    cookieMock.store.clear();
    vi.clearAllMocks();

    await loginRoute.POST(
      jsonRequest(
        { email: "secure-cookie@example.com", password: "secret123" },
        "https://app.example.test/api/auth",
      ),
    );

    expect(cookieMock.cookies.set).toHaveBeenLastCalledWith(
      "auth_token",
      expect.any(String),
      expect.objectContaining({ secure: true }),
    );

    vi.clearAllMocks();
    await loginRoute.POST(
      new Request("http://app.example.test/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({ email: "secure-cookie@example.com", password: "secret123" }),
      }),
    );

    expect(cookieMock.cookies.set).toHaveBeenLastCalledWith(
      "auth_token",
      expect.any(String),
      expect.objectContaining({ secure: true }),
    );

    vi.clearAllMocks();
    await loginRoute.POST(
      jsonRequest(
        { email: "secure-cookie@example.com", password: "secret123" },
        "http://192.168.1.50:3000/api/auth",
      ),
    );

    expect(cookieMock.cookies.set).toHaveBeenLastCalledWith(
      "auth_token",
      expect.any(String),
      expect.objectContaining({ secure: false }),
    );
  });

  it("returns the current user and invalidates the session on logout", async () => {
    await registerRoute.POST(jsonRequest({ email: "me@example.com", password: "secret123" }));

    const meResponse = await meRoute.GET();
    expect(meResponse.status).toBe(200);
    await expect(meResponse.json()).resolves.toMatchObject({ email: "me@example.com" });

    const token = cookieMock.store.get("auth_token");
    const logoutResponse = await logoutRoute.POST();

    expect(logoutResponse.status).toBe(200);
    expect(cookieMock.store.get("auth_token")).toBeUndefined();

    const session = dbModule.db.prepare("SELECT id FROM auth_sessions WHERE token = ?").get(token);
    expect(session).toBeUndefined();
  });

  it("returns 401 from me when no session exists", async () => {
    const response = await meRoute.GET();

    expect(response.status).toBe(401);
  });
});
