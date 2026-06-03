import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, hashPassword, setSessionCookie } from "@/lib/auth";
import { isEmailAllowedToRegister } from "@/lib/registration";
import { enforceAuthRateLimit } from "@/lib/rate-limit";

type RegisterBody = {
  email?: unknown;
  password?: unknown;
};

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 255 || !normalized.includes("@")) return null;
  return normalized;
}

export async function POST(request: Request) {
  try {
    const limited = enforceAuthRateLimit(request, "register");
    if (limited) return limited;

    const body = (await request.json()) as RegisterBody;
    const email = normalizeEmail(body.email);

    if (!email) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    if (!isEmailAllowedToRegister(email)) {
      // Same message whether the email is off-list — don't reveal the allowlist.
      return NextResponse.json({ error: "Registration is not open for this email" }, { status: 403 });
    }

    if (typeof body.password !== "string" || body.password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    const passwordHash = await hashPassword(body.password);
    const { token, expiresAt, userId } = db.transaction(() => {
      const result = db
        .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
        .run(email, passwordHash);
      const uid = Number(result.lastInsertRowid);
      db.prepare("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'rounding', '2.5')").run(uid);
      const session = createSession(uid);
      return { token: session.token, expiresAt: session.expiresAt, userId: uid };
    })();
    await setSessionCookie(token, expiresAt, request);

    return NextResponse.json({ id: userId, email }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
