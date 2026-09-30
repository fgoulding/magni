"use client";

import { useState } from "react";
import type { ProgramDocumentV1, ProgramExerciseV1 } from "@/features/program-editor/document";
import { copyProgressionRule, listProgressionGroups, previewProgressionRuleCopy, ProgressionAuthoringError } from "@/features/program-editor/progression-authoring";

const button = "touch-target rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold disabled:opacity-50";

export function ProgressionRuleCopy({ document, source, onChange }: {
  document: ProgramDocumentV1;
  source: ProgramExerciseV1;
  onChange: (update: (document: ProgramDocumentV1) => void) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const groups = listProgressionGroups(document).filter(group => group.progressionKey !== source.progressionKey);
  const preview = previewProgressionRuleCopy(document, source.id, selected);

  function apply() {
    try {
      // Preflight before entering the workspace mutation/Undo path. Repeat on
      // its current document so no stale selection can partially edit a draft.
      copyProgressionRule(document, source.id, selected);
      onChange(current => Object.assign(current, copyProgressionRule(current, source.id, selected)));
      setFeedback(`Rule copied to ${preview.groups.length} independent progression ${preview.groups.length === 1 ? "group" : "groups"} (${preview.appearanceCount} ${preview.appearanceCount === 1 ? "appearance" : "appearances"}). Undo restores the whole change.`);
      setError("");
    } catch (failure) {
      setError(failure instanceof ProgressionAuthoringError ? failure.issues.map(issue => issue.message).join(" ") : failure instanceof Error ? failure.message : "Could not copy this rule. Review the selected lifts.");
    }
  }

  return <details className="min-w-0 rounded-xl border border-line p-3">
    <summary className="touch-target cursor-pointer text-sm font-semibold">Copy rule to other lifts</summary>
    <div className="mt-3 flex flex-col gap-3">
      <p className="text-sm text-muted">Use {source.name || "this exercise"}’s rule on other lifts. Each keeps its starting load, training max, set prescriptions and independent progress.</p>
      {!groups.length ? <p className="text-sm text-muted">Add another independent exercise to reuse this rule.</p> : <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">Choose lifts</legend>
        {groups.map(group => <label key={group.progressionKey} className="touch-target flex min-w-0 items-start gap-3 rounded-xl bg-surface-muted p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={selected.includes(group.progressionKey)} onChange={event => {
            setSelected(current => event.target.checked ? [...current, group.progressionKey] : current.filter(key => key !== group.progressionKey));
            setFeedback(""); setError("");
          }} />
          <span className="min-w-0 break-words"><span className="block font-semibold">{group.name}</span><span className="text-muted">{group.appearances[0].weekName} · {group.appearances[0].dayName} · {group.appearances.length} {group.appearances.length === 1 ? "appearance" : "appearances"}</span></span>
        </label>)}
      </fieldset>}
      {selected.length > 0 ? <section aria-label="Rule copy preview" className="rounded-xl bg-surface-muted p-3 text-sm">
        <p className="font-semibold">{preview.appearanceCount} {preview.appearanceCount === 1 ? "appearance" : "appearances"} will use {source.rule ? "this rule" : "manual progression"}</p>
        <ul className="mt-2 space-y-1 text-muted">{preview.groups.flatMap(group => group.appearances.map(appearance => <li key={appearance.exerciseId}>{appearance.weekName} · {appearance.dayName} · {appearance.exerciseName}</li>))}</ul>
        <p className="mt-2 text-muted">Every appearance in each selected progression group is included. Separate an appearance first if it needs a different rule.</p>
        {preview.issues.map(issue => <p key={`${issue.path}:${issue.message}`} className="mt-2 text-danger-ink">{issue.message}</p>)}
      </section> : null}
      {error ? <p role="alert" className="text-sm text-danger-ink">{error}</p> : null}
      {feedback ? <p role="status" className="text-sm text-success-ink">{feedback}</p> : null}
      <button type="button" className={button} disabled={!preview.appearanceCount || preview.issues.length > 0} onClick={apply}>Apply rule to selected lifts</button>
    </div>
  </details>;
}
