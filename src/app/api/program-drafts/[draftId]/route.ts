import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { assertSameOrigin, isBadRequest, isUnauthorized, jsonError, readJson } from "@/lib/api";
import { EditorRepositoryError, getEditorDraft, saveEditorDraft } from "@/features/program-editor/repository";

type Context = { params: Promise<{ draftId: string }> };
function failure(error: unknown) {
  if (error instanceof EditorRepositoryError) return NextResponse.json({ error: error.message, code: error.code, issues: error.issues }, { status: error.status });
  if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
  if (isBadRequest(error)) return jsonError(error.message, 400);
  if (error instanceof Error && error.message === "Forbidden cross-origin request") return jsonError(error.message, 403);
  console.error("[program-draft] Write/read failed", error);
  return jsonError("Could not save the program draft. Your local changes are retained.", 500);
}
export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { draftId } = await context.params;
    const draft = getEditorDraft(user.id, draftId);
    return draft ? NextResponse.json(draft) : jsonError("Draft not found", 404);
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { draftId } = await context.params;
    const body = await readJson<{ document: unknown; expectedRevision: number }>(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError("Invalid request body", 400);
    return NextResponse.json(saveEditorDraft({ userId: user.id, id: draftId, expectedRevision: body.expectedRevision, document: body.document }));
  } catch (error) { return failure(error); }
}
