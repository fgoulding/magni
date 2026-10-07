import { progressButton, progressInput } from "./ProgressChrome";

export function DateFields({ from, to }: { from?: string; to?: string }) {
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="min-w-0 text-sm text-muted">From date<input type="date" name="from" defaultValue={from} className={`${progressInput} mt-1`} /></label><label className="min-w-0 text-sm text-muted">To date<input type="date" name="to" defaultValue={to} className={`${progressInput} mt-1`} /></label></div>;
}
export function DetailDateFilter({ path, from, to, returnTo }: { path: string; from?: string; to?: string; returnTo: string }) {
  return <details className="card px-4"><summary className="touch-target cursor-pointer py-3 font-semibold">Dates{from || to ? ` · ${from || "Start"} to ${to || "Today"}` : " · All recorded workouts"}</summary><form action={path} className="flex flex-col gap-3 pb-4"><input type="hidden" name="returnTo" value={returnTo} /><DateFields from={from} to={to} /><button className={`${progressButton} self-start`}>Apply dates</button></form></details>;
}
