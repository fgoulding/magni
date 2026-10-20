import Link from "next/link";
import { withWorkoutReturn } from "@/features/workouts/navigation";
import { editorMetadata, isBodyweight, setUnit, type LastPerformance, type WorkoutGroup, type WorkoutSet } from "./workout-card-utils";
import type { SupersetRound } from "./superset-rounds";

export function formatLastPerformance(last: LastPerformance): string {
  const scheme = last.reps.join("/");
  if (last.topWeight === null) return `${scheme} reps · load not recorded`;
  const missing = last.hasMissingWeight ? " · some load not recorded" : "";
  if (last.bodyweight) return `${scheme} BW${last.topWeight > 0 ? ` +${last.topWeight} ${last.unit ?? "lb"}` : ""}${missing}`;
  return `${scheme} @ ${last.topWeight} ${last.unit ?? "lb"}${missing}`;
}

export function workoutTarget(set: WorkoutSet, unit: "lb" | "kg", compact = false): string {
  const spec = editorMetadata(set)?.set;
  const role = spec?.role ?? (set.rep_out_target > set.reps ? "amrap" : "work");
  const roleLabel = { work: "Target", warmup: "Warm-up target", top: "Top-set target", backoff: "Back-off target", amrap: "AMRAP target" }[role];
  const range = set.reps === set.rep_out_target ? String(set.reps) : `${set.reps}–${set.rep_out_target}`;
  const rowUnit = setUnit(set, unit);
  const load = isBodyweight(set) ? `BW${set.calculated_weight > 0 ? ` +${set.calculated_weight} ${rowUnit}` : ""}`
    : compact && spec?.loadMode === "working" && set.calculated_weight === 0 ? "" : `${set.calculated_weight} ${rowUnit}`;
  return `${roleLabel} · ${range} reps${load ? ` · ${load}` : ""}`;
}

type DetailRow = { set: WorkoutSet; label: string };

/** Group by the same appearance used by rounds, never by display/history name. */
function appearanceRows(group: WorkoutGroup, rounds: SupersetRound[] | null): DetailRow[][] {
  const appearances = new Map<string, DetailRow[]>();
  if (rounds) {
    for (const round of rounds) for (const entry of round.entries) {
      const key = entry.label.slice(String(round.number).length);
      const rows = appearances.get(key) ?? [];
      rows.push(entry);
      appearances.set(key, rows);
    }
  } else {
    // Batch groups retain their authored rows and never acquire physical rounds.
    let previousLegacy: WorkoutSet | undefined;
    let legacyRun = 0;
    for (const [index, set] of group.sets.entries()) {
      const editorId = editorMetadata(set)?.exerciseId;
      let key = editorId ? `editor:${editorId}` : set.program_definition_exercise_id != null ? `definition:${set.program_definition_exercise_id}` : set.exercise_key ? `exercise:${set.exercise_key}` : null;
      if (key === null) {
        if (!previousLegacy || previousLegacy.exercise_name !== set.exercise_name || set.set_number <= previousLegacy.set_number) legacyRun++;
        key = `legacy:${legacyRun}`;
        previousLegacy = set;
      } else previousLegacy = undefined;
      const rows = appearances.get(key) ?? [];
      rows.push({ set, label: set.sets > 1 ? `Batch ${index + 1} (${set.sets} sets)` : `Set ${index + 1}` });
      appearances.set(key, rows);
    }
  }
  return [...appearances.values()];
}

function sharedCues(rows: DetailRow[], text: (set: WorkoutSet) => string) {
  const cues = new Map<string, string[]>();
  for (const row of rows) {
    const content = text(row.set);
    if (!content) continue;
    const labels = cues.get(content) ?? [];
    labels.push(row.label);
    cues.set(content, labels);
  }
  return [...cues].map(([content, labels]) => ({ content, prefix: labels.length === rows.length ? "" : `${labels.join(", ")} · ` }));
}

export function WorkoutGroupDetails({ group, rounds, lastPerformance, returnTo, unit }: {
  group: WorkoutGroup; rounds: SupersetRound[] | null; lastPerformance?: Record<string, LastPerformance>; returnTo: string; unit: "lb" | "kg";
}) {
  return <details data-workout-group-details className="mb-2">
    <summary aria-label={`Details for superset ${group.supersetGroup}`} className="touch-target cursor-pointer rounded-xl py-2 text-sm font-semibold text-muted outline-none focus-visible:ring-2 focus-visible:ring-brand">Details</summary>
    <div className="space-y-4 rounded-xl bg-surface-muted p-3">
      {appearanceRows(group, rounds).map(rows => {
        const name = rows[0].set.exercise_name;
        const labels = rows.map(row => row.label).join(", ");
        const metadata = sharedCues(rows, set => {
          const spec = editorMetadata(set)?.set;
          return spec ? [spec.effortKind !== "none" ? `${spec.effortKind.toUpperCase()} ${spec.effort}` : "", `Rest ${spec.restSeconds} s`, spec.tempo ? `Tempo ${spec.tempo}` : ""].filter(Boolean).join(" · ") : "";
        });
        const notes = sharedCues(rows, set => editorMetadata(set)?.set.notes ?? "");
        const previous = new Map<string, LastPerformance>();
        for (const row of rows) {
          const last = lastPerformance?.[String(row.set.id)];
          if (last) previous.set(JSON.stringify(last), last);
        }
        return <div key={rows[0].set.id} role="group" aria-label={`${name} · ${labels}`} className="min-w-0 space-y-1">
          <h4 className="text-sm font-semibold">{name}</h4>
          {rows.map(row => <p key={row.set.id} className="text-xs text-muted">{row.label} · {workoutTarget(row.set, unit)}</p>)}
          {metadata.map(cue => <p key={cue.content} className="text-xs text-muted">{cue.prefix}{cue.content}</p>)}
          {notes.map(cue => <p key={cue.content} className="whitespace-pre-wrap text-sm text-muted">{cue.prefix}{cue.content}</p>)}
          {[...previous.values()].map((last, index) => <Link key={index} href={withWorkoutReturn(`/workouts/${last.sessionId}`, returnTo)} aria-label={`Previous ${name} workout, ${last.date}: ${formatLastPerformance(last)}`}
            className="touch-target flex items-center text-sm text-muted underline decoration-line underline-offset-2">Last: {formatLastPerformance(last)}</Link>)}
        </div>;
      })}
    </div>
  </details>;
}
