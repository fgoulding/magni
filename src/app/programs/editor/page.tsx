import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listEditorDrafts } from "@/features/program-editor/repository";
import { ProgramDraftList } from "@/components/ProgramDraftList";

export default async function ProgramWorkspacePage() {
  const user = await requireUser().catch(() => redirect("/login"));
  const drafts = listEditorDrafts(user.id);
  return <div className="safe-x flex flex-col gap-6 py-6 lg:py-10">
    <Link prefetch={false} href="/programs" className="touch-target inline-flex items-center gap-2 self-start text-sm font-semibold text-muted"><ArrowLeft aria-hidden="true" size={18} />Back to programs</Link>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="eyebrow text-xs text-brand-strong">Magni · Program design</p><h1 className="display mt-2 text-4xl lg:text-5xl">Program workspace</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted">Build your training on a larger screen. Arrange weeks and days, edit prescriptions, and preview progression before you train.</p></div>
      <Link prefetch={false} href="/programs/editor/new" className="touch-target inline-flex items-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white"><Plus aria-hidden="true" size={18} />New program</Link>
    </header>
    <ProgramDraftList userId={user.id} drafts={drafts} />
    {!drafts.some(draft => !draft.published) ? <section className="card p-6"><h2 className="display text-2xl">Start your next program</h2><p className="mt-2 text-sm text-muted">Create a blank program, customize a preset, or import a Magni program file.</p></section> : null}
    {drafts.some(draft => draft.activatedProgramId) ? <section className="flex flex-col gap-3"><h2 className="eyebrow text-xs text-muted">Published programs</h2><div className="grid gap-3 lg:grid-cols-2">{drafts.filter(draft => draft.activatedProgramId).map(draft => <Link prefetch={false} key={draft.id} href={`/programs/editor/${draft.id}`} className="card touch-target flex items-center justify-between gap-3 p-4"><span className="display min-w-0 break-words text-xl">{draft.document.name}</span><span className="text-sm font-semibold text-brand-strong">Edit</span></Link>)}</div></section> : null}
  </div>;
}
