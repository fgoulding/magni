import argon2 from "argon2";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";

class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export { UnauthorizedError };

const COOKIE_NAME = "auth_token";
const SESSION_DAYS = 30;

export type AuthUser = {
  id: number;
  email: string;
};

// Pinned argon2id work factors (OWASP minimum: 19 MiB, t=2, p=1) so the cost is
// explicit and immune to a future library default change. Params are embedded in
// the hash, so existing hashes keep verifying.
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function createSession(userId: number): { token: string; expiresAt: string } {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  db.prepare("INSERT INTO auth_sessions (user_id, token, expires_at) VALUES (?, ?, ?)").run(
    userId,
    token,
    expiresAt,
  );

  return { token, expiresAt };
}

export function cleanupExpiredSessions(): void {
  db.prepare("DELETE FROM auth_sessions WHERE expires_at < datetime('now')").run();
}

export function deleteSession(token: string): void {
  db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
}

function shouldUseSecureCookie(request?: Request): boolean {
  if (!request) return process.env.NODE_ENV === "production";

  const hostname = (() => {
    try {
      return new URL(request.url).hostname.toLowerCase();
    } catch {
      return request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
    }
  })();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  ) {
    return false;
  }

  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto) return forwardedProto === "https";

  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

export async function setSessionCookie(token: string, expiresAt: string, request?: Request): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export function getUserByToken(token: string | undefined): AuthUser | null {
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.email
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as AuthUser | undefined;

  return row ?? null;
}

export async function getUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  return getUserByToken(cookieStore.get(COOKIE_NAME)?.value);
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getUser();
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

export function getSettings(userId: number): Record<string, string> {
  const rows = db
    .prepare("SELECT key, value FROM user_settings WHERE user_id = ?")
    .all(userId) as { key: string; value: string }[];

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function setSetting(userId: number, key: string, value: string): void {
  db.prepare(
    `INSERT INTO user_settings (user_id, key, value)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
  ).run(userId, key, value);
}

export function getSettingNumber(userId: number, key: string, defaultValue: number): number {
  const row = db
    .prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = ?")
    .get(userId, key) as { value: string } | undefined;

  if (!row) return defaultValue;

  const value = Number(row.value);
  return Number.isFinite(value) ? value : defaultValue;
}
