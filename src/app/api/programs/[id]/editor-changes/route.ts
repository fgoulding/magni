import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { assertSameOrigin, isBadRequest, isUnauthorized, jsonError, numberParam, readJson } from "@/lib/api";
import { EditorRepositoryError } from "@/features/program-editor/repository";
import { applyActiveEditorChanges, copyPublishedEditorDefinition, listActiveEditorChanges, previewActiveEditorChanges, type ActiveEditorChangeInput } from "@/features/program-editor/active-changes";

type Context = { params: Promise<{ id: string }> };
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function failure(error: unknown) {
  if (error instanceof EditorRepositoryError) return NextResponse.json({ error: error.message, code: error.code, issues: error.issues }, { status: error.status });
  if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
  if (isBadRequest(error)) return jsonError(error.message, 400);
  if (error instanceof Error && error.message === "Forbidden cross-origin request") return jsonError(error.message, 403);
  console.error("[active-editor-changes] Request failed", error);
  return jsonError("Could not confirm this change. Retry the same pending request.", 500);
}
export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const programId = numberParam((await context.params).id);
    if (!positiveInteger(programId)) return jsonError("Invalid program id", 400);
    return NextResponse.json(listActiveEditorChanges(user.id, programId));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const programId = numberParam((await context.params).id);
    if (!positiveInteger(programId)) return jsonError("Invalid program id", 400);
    const body = await readJson<Record<string, unknown>>(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError("Invalid request body", 400);
    if (body.action === "copy_published") {
      if (!positiveInteger(body.publishedRevisionId) || !uuid(body.requestKey)) return jsonError("Choose a published version and valid request key", 400);
      return NextResponse.json({ success: true, ...copyPublishedEditorDefinition({ userId: user.id, programId, publishedRevisionId: body.publishedRevisionId, requestKey: body.requestKey }) });
    }
    if (body.action !== undefined || typeof body.preview !== "boolean" || !uuid(body.draftId) || !positiveInteger(body.expectedDraftRevision)
      || !["occurrence", "remaining_block", "definition"].includes(String(body.scope)) || !["preserve", "use_draft"].includes(String(body.progressionState))
      || (body.scope !== "definition" && !positiveInteger(body.occurrenceId))) return jsonError("Choose a saved draft, edit scope, workout, and progression policy", 400);
    const input: ActiveEditorChangeInput = {
      userId: user.id, programId, draftId: body.draftId, expectedDraftRevision: body.expectedDraftRevision,
      scope: body.scope as ActiveEditorChangeInput["scope"], progressionState: body.progressionState as ActiveEditorChangeInput["progressionState"],
      ...(body.scope === "definition" ? {} : { occurrenceId: body.occurrenceId as number }),
    };
    if (body.preview) return NextResponse.json({ success: true, ...previewActiveEditorChanges(input) });
    if (!uuid(body.requestKey) || typeof body.expectedPreviewToken !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedPreviewToken)) return jsonError("Review these changes before applying them", 400);
    return NextResponse.json({ success: true, ...applyActiveEditorChanges({ ...input, expectedPreviewToken: body.expectedPreviewToken, requestKey: body.requestKey }) });
  } catch (error) { return failure(error); }
}
