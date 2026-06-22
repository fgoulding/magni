import { NextResponse } from "next/server";
import { assertSameOrigin, isBadRequest, readJson } from "@/lib/api";
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

// A real argon2id hash of a throwaway value. When the email doesn't exist we
// still run a verify against this so the response time matches the user-exists
// path, closing the timing oracle that would otherwise enumerate valid emails.
const DECOY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$b/RnU2ZKlWrmKHNTi34cfg$RLGy9BY/S0K8fxLZ7b1xDELrRg44H8yjoaBFFUu5rIo";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const limited = enforceAuthRateLimit(request, "login");
    if (limited) return limited;

    const body = await readJson<LoginBody>(request);

    if (typeof body.email !== "string" || typeof body.password !== "string") {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const email = body.email.trim().toLowerCase();
    const user = db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").get(email) as
      | UserRow
      | undefined;

    if (!user) {
      await verifyPassword(body.password, DECOY_HASH); // equalize timing; result discarded
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    if (!(await verifyPassword(body.password, user.password_hash))) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    cleanupExpiredSessions();
    const { token, expiresAt } = createSession(user.id);
    await setSessionCookie(token, expiresAt, request);

    return NextResponse.json({ id: user.id, email: user.email });
  } catch (error) {
    if (isBadRequest(error)) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
