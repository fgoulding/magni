import { NextResponse } from "next/server";
import { archiveProgramRun, getProgramDetailForUser, updateProgramRun } from "@/features/programs/program-service";
import { assertSameOrigin, jsonError, isUnauthorized, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ProgramUpdateBody = {
  name?: unknown;
  isActive?: unknown;
  scheduleWeekdays?: unknown;
};

function parseScheduleWeekdays(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("scheduleWeekdays must be an array");
  }
  if (
    value.some((day) => typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("scheduleWeekdays must contain unique weekdays from 0 to 6");
  }

  return [...value].sort((a, b) => a - b);
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const programId = numberParam(id);
    const program = getProgramDetailForUser(programId, user.id);

    if (!program) return jsonError("Program not found", 404);

    return NextResponse.json(program);
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to fetch program", 500);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const programId = numberParam(id);
    const body = (await request.json()) as ProgramUpdateBody;

    const existing = db
      .prepare(
        `
          SELECT p.id
          FROM programs p
          LEFT JOIN program_runs pr ON pr.id = p.program_run_id
          WHERE p.id = ?
            AND p.user_id = ?
            AND COALESCE(pr.archived_at, p.archived_at) IS NULL
            AND COALESCE(pr.status, 'active') != 'archived'
        `,
      )
      .get(programId, user.id);
    if (!existing) return jsonError("Program not found", 404);

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const hasName = name !== "";
    const hasActive = typeof body.isActive === "boolean";
    const scheduleWeekdays = parseScheduleWeekdays(body.scheduleWeekdays);
    const hasSchedule = scheduleWeekdays !== undefined;

    if (!hasName && !hasActive && !hasSchedule) {
      return jsonError("name is required", 400);
    }

    updateProgramRun({
      userId: user.id,
      legacyProgramId: programId,
      name: hasName ? name : undefined,
      status: hasActive ? (body.isActive ? "active" : "paused") : undefined,
      scheduleWeekdays: hasSchedule ? scheduleWeekdays : undefined,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message.startsWith("scheduleWeekdays")) {
      return jsonError(error.message, 400);
    }
    return jsonError("Failed to update program", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const programId = numberParam(id);
    const existing = db
      .prepare(
        `
          SELECT p.id
          FROM programs p
          LEFT JOIN program_runs pr ON pr.id = p.program_run_id
          WHERE p.id = ?
            AND p.user_id = ?
            AND COALESCE(pr.archived_at, p.archived_at) IS NULL
            AND COALESCE(pr.status, 'active') != 'archived'
        `,
      )
      .get(programId, user.id);
    if (!existing) return jsonError("Program not found", 404);

    archiveProgramRun({ userId: user.id, legacyProgramId: programId });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to delete program", 500);
  }
}
