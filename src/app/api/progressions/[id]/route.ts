import { NextResponse } from "next/server";
import { assertSameOrigin, isUnauthorized, jsonError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { deleteUserTrainingTemplate } from "@/features/training-templates/user-templates";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    if (!deleteUserTrainingTemplate(id, user.id)) return jsonError("Progression not found", 404);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return jsonError(error.message, 403);
    }
    return jsonError("Failed to delete progression", 500);
  }
}
