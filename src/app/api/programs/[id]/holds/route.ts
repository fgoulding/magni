import { NextResponse } from "next/server";
import { createProgramRunHold } from "@/features/programs/program-service";
import { assertSameOrigin, isUnauthorized, jsonError, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type CreateHoldBody = {
  startDate?: unknown;
  endDate?: unknown;
  reason?: unknown;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const programId = numberParam(id);
    const body = (await request.json()) as CreateHoldBody;

    if (typeof body.startDate !== "string" || typeof body.endDate !== "string") {
      return jsonError("startDate and endDate are required", 400);
    }

    const hold = createProgramRunHold({
      userId: user.id,
      legacyProgramId: programId,
      startDate: body.startDate,
      endDate: body.endDate,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });

    return NextResponse.json(hold, { status: 201 });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error) {
      if (
        error.message.includes("YYYY-MM-DD") ||
        error.message.includes("endDate") ||
        error.message.includes("overlaps")
      ) {
        return jsonError(error.message, 400);
      }
      if (error.message === "Program not found") return jsonError("Program not found", 404);
    }
    return jsonError("Failed to hold program", 500);
  }
}
