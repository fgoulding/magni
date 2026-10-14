import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateProgramForm } from "@/components/CreateProgramForm";
import { listProgramDefaults } from "@/features/program-defaults/defaults";
import { getLatestTrainingMaxes } from "@/features/programs/program-service";
import { reverseMaterializeProgram } from "@/features/shared-programs/reverse-materialize";
import type { SharedProgramSnapshot } from "@/features/shared-programs/types";
import { requireUser } from "@/lib/auth";
import { userDateKey } from "@/lib/user-date";
import { PRESETS } from "@/features/program-editor/operations";
import { listProgramTemplates } from "@/features/program-templates/catalog";

type NewProgramPageProps = {
  searchParams: Promise<{ from?: string; template?: string; system?: string }>;
};

export default async function NewProgramPage({ searchParams }: NewProgramPageProps) {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const latestMaxes = Object.fromEntries(
    getLatestTrainingMaxes(user.id).map((max) => [max.name.trim().toLowerCase(), max.trainingMax]),
  );

  // "Duplicate / next cycle": preload an owned program's structure so a fresh
  // run starts from it, with the latest training maxes carried forward.
  const { from, template, system } = await searchParams;
  const templates = listProgramTemplates();
  if (!from && template && templates.some(item => item.id === template)) redirect(`/programs/editor/new?template=${encodeURIComponent(template)}`);
  let duplicate: SharedProgramSnapshot | undefined;
  if (from && /^\d+$/.test(from)) {
    try {
      const snapshot = reverseMaterializeProgram(Number(from), user.id);
      duplicate = { ...snapshot, name: `${snapshot.name} (copy)` };
    } catch {
      duplicate = undefined; // invalid/not-owned program → just show the blank form
    }
  }

  return (
    <div className="safe-x mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5 py-5">
      <Link href="/programs" className="touch-target inline-flex items-center gap-2 self-start text-sm font-semibold text-muted"><ArrowLeft size={18} aria-hidden="true" />Back to programs</Link>
      <header>
        <p className="eyebrow text-[11px] text-brand-strong">Program</p>
        <h1 className="display mt-1 text-4xl">{duplicate ? "Duplicate program" : system === "1" ? "Original training systems" : "Choose a program"}</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted">
          {duplicate
            ? "A fresh run from this program, with your latest training maxes carried forward. Edit anything before creating."
            : system === "1" ? "Choose a training system and enter your training maxes. These systems keep their original progression rules." : "Choose a starting point. Edit the workouts and schedule before you start."}
        </p>
      </header>
      {!from && system !== "1" ? <>
        <section aria-label="Ready programs" className="flex flex-col gap-3">{templates.map(item => <Link prefetch={false} key={item.id} href={`/programs/editor/new?template=${encodeURIComponent(item.id)}`} className="card touch-target flex flex-col gap-2 p-5"><h2 className="display text-2xl">{item.title}</h2><p className="text-sm text-muted">{item.days.length} days · {item.cycles} weeks</p><p className="text-sm leading-6 text-muted">{item.description.split("\n\n")[0]}</p><span className="mt-1 font-semibold text-brand-strong">Use this program</span></Link>)}</section>
        <details className="card p-4"><summary className="touch-target cursor-pointer font-semibold">More starting points</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{PRESETS.filter(item => item.id !== "full-body-supersets-3-day").map(item => <Link prefetch={false} key={item.id} href={`/programs/editor/new?preset=${item.id}`} className="touch-target rounded-xl border border-line p-3"><p className="font-semibold">{item.title}</p><p className="mt-1 text-sm text-muted">{item.description}</p></Link>)}</div></details>
        <Link aria-label="Original training systems" href="/programs/new?system=1" className="card touch-target p-4"><h2 className="display text-xl">Original training systems</h2><p className="mt-1 text-sm text-muted">Training-max based systems with their original progression and familiar setup.</p></Link>
      </> : <CreateProgramForm
        programDefaults={listProgramDefaults()}
        latestMaxes={latestMaxes}
        initialSnapshot={duplicate}
        initialSnapshotLabel="Duplicated program"
        programTemplates={[]}
        initialTemplateId={from ? undefined : template}
        startDate={userDateKey(user.id)}
        userId={user.id}
      />}
    </div>
  );
}
