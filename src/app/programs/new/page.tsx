import { redirect } from "next/navigation";
import { CreateProgramForm } from "@/components/CreateProgramForm";
import { listProgramDefaults } from "@/features/program-defaults/defaults";
import { getLatestTrainingMaxes } from "@/features/programs/program-service";
import { requireUser } from "@/lib/auth";

export default async function NewProgramPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const latestMaxes = Object.fromEntries(
    getLatestTrainingMaxes(user.id).map((max) => [max.name.trim().toLowerCase(), max.trainingMax]),
  );

  return (
    <div className="safe-x flex flex-col gap-5 py-5">
      <header>
        <p className="eyebrow text-[11px] text-brand-strong">Program</p>
        <h1 className="display mt-1 text-4xl">New program</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted">Start blank or preload a training template.</p>
      </header>
      <CreateProgramForm programDefaults={listProgramDefaults()} latestMaxes={latestMaxes} />
    </div>
  );
}
