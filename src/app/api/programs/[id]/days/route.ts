import { NextResponse } from "next/server";
import { addDefinitionDayForRun } from "@/features/programs/program-service";
import { assertSameOrigin, jsonError, isUnauthorized, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type DayCreateBody = {
  name?: unknown;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const programId = numberParam(id);
    const body = (await request.json()) as DayCreateBody;

    if (typeof body.name !== "string" || body.name.trim() === "") {
      return jsonError("name is required", 400);
    }

    const day = addDefinitionDayForRun({
      userId: user.id,
      legacyProgramId: programId,
      name: body.name.trim(),
    });

    return NextResponse.json(
      { id: day.legacyDayId, name: body.name.trim(), day_number: day.dayNumber },
      { status: 201 },
    );
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Program not found") {
      return jsonError(error.message, 404);
    }
    return jsonError("Failed to create day", 500);
  }
}
