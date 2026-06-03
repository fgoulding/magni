import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearSessionCookie, deleteSession } from "@/lib/auth";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (token) {
    deleteSession(token);
  }

  await clearSessionCookie();

  return NextResponse.json({ success: true });
}
