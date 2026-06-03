import { NextResponse } from "next/server";
import { assertSameOrigin, jsonError, isUnauthorized, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

type RouteContext = {
  params: Promise<{ dayId: string }>;
};

type DayUpdateBody = {
  name?: unknown;
  move?: unknown;
};

type DayRow = {
  id: number;
  program_id: number;
  day_number: number;
  sort_order: number;
  shared_day_key: string | null;
  program_definition_id: number | null;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { dayId } = await context.params;
    const id = numberParam(dayId);
    const body = (await request.json()) as DayUpdateBody;

    if (
      body.move !== "up" &&
      body.move !== "down" &&
      (typeof body.name !== "string" || body.name.trim() === "")
    ) {
      return jsonError("name is required", 400);
    }
    const dayName = typeof body.name === "string" ? body.name.trim() : "";

    const day = db
      .prepare(
        `SELECT d.id, d.program_id, d.day_number, d.sort_order, d.shared_day_key, p.program_definition_id
         FROM days d
         JOIN programs p ON p.id = d.program_id
         WHERE d.id = ?
           AND d.archived_at IS NULL
           AND p.user_id = ?
           AND p.archived_at IS NULL`,
      )
      .get(id, user.id) as DayRow | undefined;
    if (!day) return jsonError("Day not found", 404);

    db.transaction(() => {
      if (body.move === "up" || body.move === "down") {
        const direction = body.move;
        const sibling = db
          .prepare(
            `
              SELECT id, sort_order, shared_day_key
              FROM days
              WHERE program_id = ?
                AND archived_at IS NULL
                AND sort_order ${direction === "up" ? "<" : ">"} ?
              ORDER BY sort_order ${direction === "up" ? "DESC" : "ASC"}, id ${direction === "up" ? "DESC" : "ASC"}
              LIMIT 1
            `,
          )
          .get(day.program_id, day.sort_order) as { id: number; sort_order: number; shared_day_key: string | null } | undefined;
        if (!sibling) return;

        db.prepare("UPDATE days SET sort_order = ? WHERE id = ?").run(sibling.sort_order, day.id);
        db.prepare("UPDATE days SET sort_order = ? WHERE id = ?").run(day.sort_order, sibling.id);
        if (day.program_definition_id && day.shared_day_key && sibling.shared_day_key) {
          db.prepare(
            "UPDATE program_definition_days SET sort_order = ? WHERE program_definition_id = ? AND stable_key = ?",
          ).run(sibling.sort_order, day.program_definition_id, day.shared_day_key);
          db.prepare(
            "UPDATE program_definition_days SET sort_order = ? WHERE program_definition_id = ? AND stable_key = ?",
          ).run(day.sort_order, day.program_definition_id, sibling.shared_day_key);
        }
      } else {
        db.prepare("UPDATE days SET name = ? WHERE id = ?").run(dayName, id);
        if (day.program_definition_id && day.shared_day_key) {
          db.prepare(
            "UPDATE program_definition_days SET name = ? WHERE program_definition_id = ? AND stable_key = ?",
          ).run(dayName, day.program_definition_id, day.shared_day_key);
        }
      }
    })();
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to update day", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { dayId } = await context.params;
    const id = numberParam(dayId);
    const day = db
      .prepare(
        `SELECT d.id, d.shared_day_key, p.program_definition_id
         FROM days d
         JOIN programs p ON p.id = d.program_id
         WHERE d.id = ?
           AND d.archived_at IS NULL
           AND p.user_id = ?
           AND p.archived_at IS NULL`,
      )
      .get(id, user.id) as { id: number; shared_day_key: string | null; program_definition_id: number | null } | undefined;
    if (!day) return jsonError("Day not found", 404);

    db.transaction(() => {
      db.prepare("UPDATE days SET archived_at = datetime('now') WHERE id = ?").run(id);
      if (day.program_definition_id && day.shared_day_key) {
        db.prepare(
          "UPDATE program_definition_days SET archived_at = datetime('now') WHERE program_definition_id = ? AND stable_key = ?",
        ).run(day.program_definition_id, day.shared_day_key);
      }
    })();
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to delete day", 500);
  }
}
