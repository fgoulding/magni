import { NextResponse } from "next/server";
import { addDefinitionDayForRun } from "@/features/programs/program-service";
import { assertSameOrigin, isBadRequest, jsonError, isUnauthorized, numberParam, readJson } from "@/lib/api";
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
    const body = await readJson<DayCreateBody>(request);

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
    if (isBadRequest(error)) return jsonError(error.message, 400);
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return jsonError(error.message, 403);
    }
    if (error instanceof Error && error.message === "Program not found") {
      return jsonError(error.message, 404);
    }
    return jsonError("Failed to create day", 500);
  }
}
