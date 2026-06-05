import { NextResponse } from "next/server";
import { isUnauthorized, jsonError, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSessionPrs } from "@/features/programs/training-stats";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

/** Personal records set in this (owned) session — used for the finish-workout
 *  celebration. Kept out of the completion route so that critical path is
 *  untouched. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { sessionId } = await context.params;
    const id = numberParam(sessionId);

    const session = db.prepare("SELECT id FROM sessions WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!session) return jsonError("Session not found", 404);

    return NextResponse.json({ prs: getSessionPrs(user.id, id) });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to load personal records", 500);
  }
}
