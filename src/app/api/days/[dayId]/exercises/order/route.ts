import { NextResponse } from "next/server";
import { assertSameOrigin, isBadRequest, isUnauthorized, jsonError, numberParam, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

type RouteContext = {
  params: Promise<{ dayId: string }>;
};

type OrderItem = { id: number; group: number | null };

type DayRow = { id: number; program_definition_id: number | null };
type ExerciseRow = { id: number; shared_exercise_key: string | null };

function parseItems(value: unknown): OrderItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: OrderItem[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const { id, group } = raw as { id?: unknown; group?: unknown };
    if (!Number.isInteger(id) || (id as number) <= 0) return null;
    if (group !== null && !Number.isInteger(group)) return null;
    items.push({ id: id as number, group: (group as number | null) ?? null });
  }
  return items;
}

/**
 * Persist the full order + superset grouping for a day's exercises in one shot —
 * the write target for drag-to-reorder and drag-to-superset. `items` is the new
 * visual order; `group` is a client-side group index (same index = same
 * superset, null = standalone). The server assigns real UUID tokens and mirrors
 * everything to program_definition_exercises so the definition stays in sync.
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { dayId } = await context.params;
    const id = numberParam(dayId);

    const day = db
      .prepare(
        `SELECT d.id, p.program_definition_id
         FROM days d
         JOIN programs p ON p.id = d.program_id
         WHERE d.id = ?
           AND d.archived_at IS NULL
           AND p.user_id = ?
           AND p.archived_at IS NULL`,
      )
      .get(id, user.id) as DayRow | undefined;
    if (!day) return jsonError("Day not found", 404);

    const body = await readJson<{ items?: unknown }>(request);
    const items = parseItems(body.items);
    if (!items) return jsonError("items must be an array of { id, group }", 400);

    const existing = db
      .prepare("SELECT id, shared_exercise_key FROM exercises WHERE day_id = ? AND archived_at IS NULL")
      .all(id) as ExerciseRow[];

    // The payload must be an exact permutation of the day's current exercises.
    const existingIds = new Set(existing.map((e) => e.id));
    const payloadIds = new Set(items.map((it) => it.id));
    if (
      existingIds.size !== payloadIds.size ||
      items.length !== existing.length ||
      [...payloadIds].some((pid) => !existingIds.has(pid))
    ) {
      return jsonError("items must list every exercise in the day exactly once", 400);
    }

    // Singleton groups aren't supersets — drop them to null.
    const groupCounts = new Map<number, number>();
    for (const it of items) {
      if (it.group !== null) groupCounts.set(it.group, (groupCounts.get(it.group) ?? 0) + 1);
    }
    const tokenByGroup = new Map<number, string>();
    const groupFor = (group: number | null): string | null => {
      if (group === null || (groupCounts.get(group) ?? 0) < 2) return null;
      let token = tokenByGroup.get(group);
      if (!token) {
        token = crypto.randomUUID();
        tokenByGroup.set(group, token);
      }
      return token;
    };

    const keyById = new Map(existing.map((e) => [e.id, e.shared_exercise_key]));
    const definitionId = day.program_definition_id;

    db.transaction(() => {
      const updateExercise = db.prepare("UPDATE exercises SET sort_order = ?, superset_group = ? WHERE id = ? AND day_id = ?");
      const updateDefinition = db.prepare(
        `UPDATE program_definition_exercises
         SET sort_order = ?, superset_group = ?
         WHERE stable_key = ?
           AND program_definition_day_id IN (
             SELECT id FROM program_definition_days WHERE program_definition_id = ?
           )`,
      );
      items.forEach((it, index) => {
        const token = groupFor(it.group);
        updateExercise.run(index, token, it.id, id);
        const key = keyById.get(it.id);
        if (definitionId && key) {
          updateDefinition.run(index, token, key, definitionId);
        }
      });
    })();

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isBadRequest(error)) return jsonError(error.message, 400);
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return jsonError(error.message, 403);
    }
    return jsonError("Failed to reorder exercises", 500);
  }
}
