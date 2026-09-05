import type { Database } from "better-sqlite3";

/**
 * Workout dates may use a fake JS clock, while auth lookup uses SQLite's clock.
 * Keep authenticated workout fixtures valid relative to that same SQLite clock;
 * auth.test.ts tests the actual session lifetime and expiration separately.
 */
export function createUnexpiredAuthSession(
  db: Database,
  auth: Pick<typeof import("@/lib/auth"), "createSession">,
  userId: number,
): string {
  const { token } = auth.createSession(userId);
  db.prepare(
    "UPDATE auth_sessions SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days') WHERE token = ?",
  ).run(token);
  return token;
}
