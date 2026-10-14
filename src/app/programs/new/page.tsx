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
import { listProgramTemplates } from "@/features/program-templates/catalog";

type NewProgramPageProps = {
  searchParams: Promise<{ from?: string; template?: string }>;
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
  const { from, template } = await searchParams;
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
        <h1 className="display mt-1 text-4xl">{duplicate ? "Duplicate program" : "New program"}</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted">
          {duplicate
            ? "A fresh run from this program, with your latest training maxes carried forward. Edit anything before creating."
            : "Choose a program, confirm your schedule, and start training."}
        </p>
      </header>
      <CreateProgramForm
        programDefaults={listProgramDefaults()}
        latestMaxes={latestMaxes}
        initialSnapshot={duplicate}
        initialSnapshotLabel="Duplicated program"
        programTemplates={from ? [] : listProgramTemplates()}
        initialTemplateId={from ? undefined : template}
        startDate={userDateKey(user.id)}
        userId={user.id}
      />
    </div>
  );
}
