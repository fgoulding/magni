import { NextResponse } from "next/server";
import { assertSameOrigin, isUnauthorized, jsonError } from "@/lib/api";
import {
  createSession,
  hashPassword,
  requireUser,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { db } from "@/lib/db";

type ChangePasswordBody = {
  currentPassword?: unknown;
  newPassword?: unknown;
};

/**
 * Change the signed-in user's password. Verifies the current password, then
 * revokes every existing session (logging out other devices) and issues a fresh
 * one for this device so the caller stays logged in. Pairs with the admin
 * `reset-password` script: reset → log in with the temp password → change here.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();

    const body = (await request.json()) as ChangePasswordBody;
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (newPassword.length < 6) {
      return jsonError("New password must be at least 6 characters", 400);
    }

    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as
      | { password_hash: string }
      | undefined;
    if (!row) return jsonError("User not found", 404);

    if (!(await verifyPassword(currentPassword, row.password_hash))) {
      return jsonError("Current password is incorrect", 403);
    }

    const passwordHash = await hashPassword(newPassword);
    db.transaction(() => {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, user.id);
      // Revoke all sessions — changing the password logs out every device.
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(user.id);
    })();

    // Re-issue a session for this device so the user isn't kicked out.
    const session = createSession(user.id);
    await setSessionCookie(session.token, session.expiresAt, request);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return jsonError(error.message, 403);
    }
    return jsonError("Failed to change password", 500);
  }
}
