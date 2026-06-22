import { NextResponse } from "next/server";
import { assertSameOrigin, isUnauthorized, jsonError, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSessionRecap } from "@/features/programs/training-stats";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

/** Finish an in-progress workout (used by Quick Workout). Setting completed = 1
 *  fires the trigger that marks status='completed' + stamps completed_at; unlogged
 *  sets are treated as skipped by the recap, so a partial workout finishes cleanly.
 *  Returns the session recap for the finished card. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { sessionId } = await context.params;
    const id = numberParam(sessionId);

    const session = db.prepare("SELECT user_id, status FROM sessions WHERE id = ?").get(id) as
      | { user_id: number; status: string }
      | undefined;
    if (!session || session.user_id !== user.id) return jsonError("Session not found", 404);
    if (session.status !== "in_progress") {
      return jsonError("Only an in-progress workout can be finished", 400);
    }

    db.prepare("UPDATE sessions SET completed = 1 WHERE id = ?").run(id);

    return NextResponse.json(getSessionRecap(user.id, id));
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return jsonError(error.message, 403);
    }
    return jsonError("Could not finish workout", 500);
  }
}

/** Cancel an in-progress workout: discard the session (and its logged sets, which
 *  cascade) so the day returns to not-started. Completed/skipped sessions are
 *  historical and never deleted here. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { sessionId } = await context.params;
    const id = numberParam(sessionId);

    const session = db.prepare("SELECT user_id, status FROM sessions WHERE id = ?").get(id) as
      | { user_id: number; status: string }
      | undefined;
    if (!session || session.user_id !== user.id) return jsonError("Session not found", 404);
    if (session.status !== "in_progress") {
      return jsonError("Only an in-progress workout can be canceled", 400);
    }

    // session_sets are removed by ON DELETE CASCADE.
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return jsonError(error.message, 403);
    }
    return jsonError("Could not cancel workout", 500);
  }
}
