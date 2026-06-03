import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Liveness/readiness probe for the container + reverse proxy. Confirms the
// process is up and the SQLite file is openable. Never cached.
export const dynamic = "force-dynamic";

export function GET() {
  try {
    db.prepare("SELECT 1").get();
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
