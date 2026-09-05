import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { assertSameOrigin, isBadRequest, isUnauthorized, jsonError, readJson } from "@/lib/api";
import { activateEditorDraft, EditorRepositoryError } from "@/features/program-editor/repository";

export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { draftId } = await context.params;
    const body = await readJson<{ expectedRevision: number }>(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError("Invalid request body", 400);
    return NextResponse.json(activateEditorDraft({ userId: user.id, id: draftId, expectedRevision: body.expectedRevision }));
  } catch (error) {
    if (error instanceof EditorRepositoryError) return NextResponse.json({ error: error.message, code: error.code, issues: error.issues }, { status: error.status });
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (isBadRequest(error)) return jsonError(error.message, 400);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") return jsonError(error.message, 403);
    console.error("[program-activation] Failed", error);
    return jsonError("Could not activate this program. Retry safely.", 500);
  }
}
