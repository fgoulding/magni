import Link from "next/link";
import { DeleteProgramDraft } from "./DeleteProgramDraft";
import type { EditorDraft } from "@/features/program-editor/repository";

export function ProgramDraftList({ userId, drafts }: { userId: number; drafts: EditorDraft[] }) {
  const unfinished = drafts.filter(draft => !draft.published);
  if (!unfinished.length) return null;
  return <section aria-label="Your drafts" className="flex flex-col gap-3">
    <h2 className="eyebrow text-xs text-muted">Your drafts</h2>
    {unfinished.map(draft => <article key={draft.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <Link prefetch={false} href={`/programs/editor/${draft.id}`} className="touch-target flex min-w-0 flex-1 items-center justify-between gap-3">
        <div className="min-w-0"><h3 className="display break-words text-xl">{draft.document.name || "Untitled program"}</h3><p className="mt-1 text-xs text-muted">{draft.document.weeks.length} week(s) · Draft</p></div>
        <span className="text-sm font-semibold text-brand-strong">Open</span>
      </Link>
      <DeleteProgramDraft userId={userId} draftId={draft.id} name={draft.document.name} revision={draft.revision} />
    </article>)}
  </section>;
}
