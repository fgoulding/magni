import { NextResponse } from "next/server";
import { reverseMaterializeProgram } from "@/features/shared-programs/reverse-materialize";
import { jsonError, isUnauthorized, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const programId = numberParam(id);

    const snapshot = reverseMaterializeProgram(programId, user.id);

    return NextResponse.json(snapshot);
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Program not found") {
      return jsonError("Program not found", 404);
    }
    return jsonError("Failed to build program snapshot", 500);
  }
}
