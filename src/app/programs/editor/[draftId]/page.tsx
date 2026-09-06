import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { userDateKey } from "@/lib/user-date";
import { getEditorDraft, isEditorDraftDeleted } from "@/features/program-editor/repository";
import { createBlankDocument } from "@/features/program-editor/document";
import { ProgramWorkspace } from "@/components/ProgramWorkspace";

export default async function EditorPage({ params, searchParams }: { params: Promise<{ draftId: string }>; searchParams: Promise<{ from?: string }> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const { draftId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) notFound();
  if (isEditorDraftDeleted(user.id, draftId)) notFound();
  const existing = getEditorDraft(user.id, draftId);
  const { from } = await searchParams;
  const source = from ? getEditorDraft(user.id, from) : null;
  const document = existing?.document ?? (source ? { ...source.document, name: `${source.document.name} copy`, startDate: userDateKey(user.id) } : { ...createBlankDocument(), startDate: userDateKey(user.id) });
  return <ProgramWorkspace key={draftId} userId={user.id} draftId={draftId} initialDocument={document} initialRevision={existing?.revision ?? 0} activatedProgramId={existing?.activatedProgramId ?? null} published={existing?.published ?? false} />;
}
