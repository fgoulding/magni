import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api";
import { clearSessionCookie, deleteSession } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "Forbidden cross-origin request" }, { status: 403 });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (token) {
    deleteSession(token);
  }

  await clearSessionCookie();

  return NextResponse.json({ success: true });
}
