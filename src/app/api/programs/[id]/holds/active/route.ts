import { NextResponse } from "next/server";
import { cancelActiveProgramRunHold } from "@/features/programs/program-service";
import { assertSameOrigin, isUnauthorized, jsonError, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const programId = numberParam(id);
    const canceled = cancelActiveProgramRunHold({ userId: user.id, legacyProgramId: programId });

    return NextResponse.json({ success: true, canceled });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Program not found") return jsonError("Program not found", 404);
    return jsonError("Failed to cancel hold", 500);
  }
}
