import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cleanupExpiredSessions, createSession, setSessionCookie, verifyPassword } from "@/lib/auth";
import { enforceAuthRateLimit } from "@/lib/rate-limit";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

type UserRow = {
  id: number;
  email: string;
  password_hash: string;
};

export async function POST(request: Request) {
  try {
    const limited = enforceAuthRateLimit(request, "login");
    if (limited) return limited;

    const body = (await request.json()) as LoginBody;

    if (typeof body.email !== "string" || typeof body.password !== "string") {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();
    const user = db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").get(email) as
      | UserRow
      | undefined;

    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    cleanupExpiredSessions();
    const { token, expiresAt } = createSession(user.id);
    await setSessionCookie(token, expiresAt, request);

    return NextResponse.json({ id: user.id, email: user.email });
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
