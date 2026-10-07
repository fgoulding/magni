import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getProgressHome } from "@/features/progress/queries";
import { PinControl } from "@/components/progress/PinControl";
import { ProgressBack, progressButton } from "@/components/progress/ProgressChrome";
import { exerciseHref } from "@/components/progress/ExerciseRows";

import { progressReturnTo, progressUrl, single, type ProgressSearch } from "@/components/progress/navigation";

export default async function PinsPage({ searchParams }: { searchParams: Promise<ProgressSearch> }) {
  const returnTo = progressReturnTo(single((await searchParams).returnTo));
  const currentHref = progressUrl("/history/pins", { returnTo });
  const user = await requireUser().catch(() => redirect("/login"));
  const home = getProgressHome(user.id, {});
  return <div className="safe-x flex flex-col gap-4 py-5"><ProgressBack href={returnTo} /><h1 className="display text-4xl">Manage pins</h1><p className="text-muted">Keep up to four exercises on your overview. Unpinning keeps all your recorded workouts.</p>
    <ul className="card divide-y divide-line px-4">{home.pinned.map(pin => <li key={pin.id} className="py-4"><Link href={exerciseHref(`e:${pin.id}`, currentHref)} className="touch-target mb-2 flex items-center display break-words text-2xl">{pin.name}</Link><PinControl key={home.pinned.map(item => item.id).join()} exerciseId={pin.id} name={pin.name} pinned pins={home.pinned} /></li>)}</ul>
    {!home.pinned.length && <p className="text-muted">No exercises pinned yet.</p>}<Link href={progressUrl("/history/exercises", { returnTo })} className={`${progressButton} self-start`}>Find an exercise</Link>
  </div>;
}
