import { NextResponse } from "next/server";
import { assertSameOrigin, clampText, isBadRequest, jsonError, isUnauthorized, numberParam, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type SetUpdateBody = {
  setId?: unknown;
  actualReps?: unknown;
  actualWeight?: unknown;
  notes?: unknown;
};

type AddExerciseBody = {
  name?: unknown;
  sets?: unknown;
  reps?: unknown;
  weight?: unknown;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { sessionId } = await context.params;
    const id = numberParam(sessionId);
    const body = await readJson<AddExerciseBody>(request);

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return jsonError("name is required", 400);

    const setCount = Number(body.sets);
    if (!Number.isInteger(setCount) || setCount < 1 || setCount > 20) {
      return jsonError("sets must be between 1 and 20", 400);
    }

    const reps = Number(body.reps);
    if (!Number.isInteger(reps) || reps < 1 || reps > 100) {
      return jsonError("reps must be between 1 and 100", 400);
    }

    const weight = body.weight === undefined || body.weight === "" ? 0 : Number(body.weight);
    if (!Number.isFinite(weight) || weight < 0) {
      return jsonError("weight must be a non-negative number", 400);
    }

    const session = db
      .prepare("SELECT id, week_number, status FROM sessions WHERE id = ? AND user_id = ?")
      .get(id, user.id) as { id: number; week_number: number; status: string } | undefined;
    if (!session) return jsonError("Session not found", 404);
    if (session.status !== "in_progress") return jsonError("Workout is not in progress", 400);

    const insert = db.prepare(
      `INSERT INTO session_sets (
         session_id, exercise_name, category, progression_type, week_number,
         set_number, intensity_pct, reps, sets, rep_out_target, calculated_weight
       ) VALUES (?, ?, 'accessory', 'custom', ?, ?, 0, ?, ?, ?, ?)`,
    );

    const createdIds = db.transaction(() => {
      const ids: number[] = [];
      for (let setNumber = 1; setNumber <= setCount; setNumber += 1) {
        // One row per physical set, so the `sets` column is 1 — NOT setCount.
        // (Program flat rows store one row with sets=N; consumers multiply by it,
        // so stamping setCount here once per row double-counts volume/reps by N.)
        const result = insert.run(id, name, session.week_number, setNumber, reps, 1, reps, weight);
        ids.push(Number(result.lastInsertRowid));
      }
      return ids;
    })();

    const rows = db
      .prepare(
        `SELECT id, exercise_name, reps, sets, set_number, rep_out_target, calculated_weight,
                actual_reps, actual_weight, superset_group
         FROM session_sets WHERE id IN (${createdIds.map(() => "?").join(",")}) ORDER BY set_number`,
      )
      .all(...createdIds);

    return NextResponse.json({ sets: rows }, { status: 201 });
  } catch (error) {
    if (isBadRequest(error)) return jsonError(error.message, 400);
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to add exercise", 500);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { sessionId } = await context.params;
    const id = numberParam(sessionId);
    const body = await readJson<SetUpdateBody>(request);
    const setId = Number(body.setId);

    if (!Number.isInteger(setId) || setId <= 0) {
      return jsonError("setId is required", 400);
    }

    const session = db
      .prepare("SELECT id, status FROM sessions WHERE id = ? AND user_id = ?")
      .get(id, user.id) as { id: number; status: string } | undefined;
    if (!session) return jsonError("Session not found", 404);
    if (session.status !== "in_progress") return jsonError("Workout is not in progress", 400);

    const sessionSet = db
      .prepare("SELECT id FROM session_sets WHERE id = ? AND session_id = ?")
      .get(setId, id);
    if (!sessionSet) return jsonError("Set not found in this session", 404);

    const actualReps = body.actualReps === undefined ? null : Number(body.actualReps);
    if (actualReps !== null && (!Number.isInteger(actualReps) || actualReps < 0)) {
      return jsonError("actualReps must be a non-negative integer", 400);
    }

    const actualWeight = body.actualWeight === undefined ? null : Number(body.actualWeight);
    if (actualWeight !== null && (!Number.isFinite(actualWeight) || actualWeight < 0)) {
      return jsonError("actualWeight must be a non-negative number", 400);
    }

    const notes = clampText(body.notes, 4000);

    db.prepare("UPDATE session_sets SET actual_reps = ?, actual_weight = ?, notes = ? WHERE id = ?").run(
      actualReps,
      actualWeight,
      notes,
      setId,
    );

    const updated = db
      .prepare(
        `SELECT ss.*, ss.rep_out_target
         FROM session_sets ss
         WHERE ss.id = ?`,
      )
      .get(setId);

    return NextResponse.json(updated);
  } catch (error) {
    if (isBadRequest(error)) return jsonError(error.message, 400);
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to update set", 500);
  }
}
