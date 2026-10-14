import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { userDateKey } from "@/lib/user-date";
import { getEditorDraft, isEditorDraftDeleted } from "@/features/program-editor/repository";
import { createBlankDocument } from "@/features/program-editor/document";
import { listProgramTemplates } from "@/features/program-templates/catalog";
import { compileProgramTemplate } from "@/features/program-templates/template";
import { ProgramWorkspace } from "@/components/ProgramWorkspace";
import { makePreset, PRESETS } from "@/features/program-editor/operations";

export default async function EditorPage({ params, searchParams }: { params: Promise<{ draftId: string }>; searchParams: Promise<{ from?: string; preset?: string; template?: string; advanced?: string }> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const { draftId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) notFound();
  if (isEditorDraftDeleted(user.id, draftId)) notFound();
  const existing = getEditorDraft(user.id, draftId);
  const { from, preset, template, advanced } = await searchParams;
  const chosenTemplate = !from && template ? listProgramTemplates().find(item => item.id === template) : undefined;
  const source = from ? getEditorDraft(user.id, from) : null;
  const chosenPreset = !from ? PRESETS.find(item => item.id === preset) : undefined;
  const startDate = userDateKey(user.id);
  const document = existing?.document ?? (source
    ? { ...source.document, name: `${source.document.name} copy`, startDate }
    : chosenTemplate ? compileProgramTemplate(chosenTemplate, { startDate }) : chosenPreset ? makePreset(chosenPreset.id, startDate) : { ...createBlankDocument(), startDate });
  return <ProgramWorkspace key={draftId} userId={user.id} draftId={draftId} initialDocument={document} initialRevision={existing?.revision ?? 0} activatedProgramId={existing?.activatedProgramId ?? null} published={existing?.published ?? false} advanced={advanced === "1"} />;
}
