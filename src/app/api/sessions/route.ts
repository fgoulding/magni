import { NextResponse } from "next/server";
import { jsonError, isUnauthorized } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const user = await requireUser();
    const sessions = db
      .prepare(
        `SELECT
           s.*,
           COALESCE(NULLIF(s.program_name, ''), p.name, '') AS program_name,
           COALESCE(NULLIF(s.day_name, ''), d.name, '') AS day_name
         FROM sessions s
         LEFT JOIN programs p ON p.id = s.program_id
         LEFT JOIN days d ON d.id = s.day_id
         WHERE s.user_id = ?
         ORDER BY s.date DESC, s.id DESC
         LIMIT 100`,
      )
      .all(user.id);

    return NextResponse.json(sessions);
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to fetch sessions", 500);
  }
}
