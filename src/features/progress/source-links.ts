import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { findExerciseAlias, registerExerciseAlias, resolveCatalogRedirect } from "./aliases";

export const PROGRESS_SET_JOINS = `
  LEFT JOIN exercise_set_sources pes ON pes.session_set_id=ss.id AND pes.user_id=s.user_id
  LEFT JOIN exercise_sources ps ON ps.user_id=pes.user_id AND ps.source_key=pes.source_key
  LEFT JOIN exercise_catalog pc ON pc.id=pes.exercise_id AND pc.user_id=s.user_id`;

export type SourceRow = { id: number; session_id: number; user_id: number; program_id: number | null; program_run_id: number | null; program_definition_exercise_id: number | null; shared_exercise_key: string | null; exercise_key: string | null; exercise_name: string; progression_type: string; editor_json: string | null };
function textKey(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 200; }
function metadataFor(row:SourceRow):{historyKey?:unknown;exerciseId?:unknown;set?:{role?:unknown;loadMode?:unknown}}|null {
  try {const value=row.editor_json?JSON.parse(row.editor_json):null;return value&&typeof value==="object"&&!Array.isArray(value)?value:null;}catch{return null;}
}
function slotKey(row:SourceRow):string {return String(metadataFor(row)?.exerciseId??row.program_definition_exercise_id??row.exercise_key??`set:${row.id}`);}
function family(row:SourceRow):string {
  const mode=metadataFor(row)?.set?.loadMode;
  return mode==="bodyweight"||mode==="added"?mode:["working","fixed","percent"].includes(String(mode))?"external":row.progression_type==="bodyweight"?"bodyweight-or-added":"unknown";
}
function sourceFor(row: SourceRow, measurement:string): { key: string; observation: string; kind: "editor" | "legacy" | "quick" | "unlinked"; origin: "lineage" | "unlinked" } {
  const metadata=metadataFor(row);
  const variant=JSON.stringify([row.exercise_name,measurement]);
  if (metadata && textKey(metadata.exerciseId)) return { key: `editor:${textKey(metadata.historyKey) ? metadata.historyKey : metadata.exerciseId}:${variant}`, observation: `editor:${metadata.exerciseId}:${variant}`, kind: "editor", origin: "lineage" };
  if (row.program_definition_exercise_id !== null || row.shared_exercise_key) {
    const scope = row.program_run_id !== null ? `run:${row.program_run_id}` : row.program_id !== null ? `program:${row.program_id}` : null;
    const key = scope ? `legacy:${scope}:${row.shared_exercise_key ? `key:${row.shared_exercise_key}` : `exercise:${row.program_definition_exercise_id}`}`
      : row.program_definition_exercise_id !== null ? `legacy:definition-exercise:${row.program_definition_exercise_id}` : null;
    if (key) return { key:`${key}:${variant}`, observation: `legacy:${row.program_definition_exercise_id ?? row.shared_exercise_key}:${variant}`, kind: "legacy", origin: "lineage" };
    // A shared label alone cannot prove lineage after its owning source has disappeared.
  }
  if (row.exercise_key) return { key: `quick:${row.session_id}:${row.exercise_key}:${variant}`, observation: `quick:${row.exercise_key}:${variant}`, kind: "quick", origin: "unlinked" };
  return { key: `unlinked:${row.session_id}:${row.id}`, observation: `set:${row.id}`, kind: "unlinked", origin: "unlinked" };
}

export function sessionSourceDescriptions(rows: SourceRow[]) {
  const families = new Map<string, Set<string>>();
  for (const row of rows) if (metadataFor(row)?.set?.role !== "warmup") {
    const key = slotKey(row), values = families.get(key) ?? new Set<string>();
    values.add(family(row)); families.set(key, values);
  }
  return rows.map(row => {
    const measurement = [...(families.get(slotKey(row)) ?? new Set([family(row)]))].sort().join("+");
    return { row, measurement, source: sourceFor(row, measurement) };
  });
}

/** Called only during migration or a caller-owned workout write transaction. */
export function attachSessionExerciseSources(database: Database.Database, userId: number, sessionId: number, preferred = new Map<number, string>(), useAliases = true): void {
  const rows = database.prepare(`SELECT ss.*,s.user_id,s.program_id,s.program_run_id FROM session_sets ss JOIN sessions s ON s.id=ss.session_id
    LEFT JOIN exercise_set_sources x ON x.session_set_id=ss.id WHERE s.user_id=? AND s.id=? AND x.session_set_id IS NULL ORDER BY ss.id`).all(userId, sessionId) as SourceRow[];
  for (const { row, measurement, source } of sessionSourceDescriptions(rows)) {
    let assignment = database.prepare("SELECT exercise_id FROM exercise_sources WHERE user_id=? AND source_key=?").get(userId, source.key) as { exercise_id: string } | undefined;
    const chosen = preferred.get(row.id);
    if (!assignment) {
      const known = chosen ?? (useAliases ? findExerciseAlias(database, userId, row.exercise_name, measurement) : null);
      assignment = { exercise_id: known ?? randomUUID() };
      if (!known) database.prepare("INSERT INTO exercise_catalog(id,user_id,name,origin) VALUES (?,?,?,?)").run(assignment.exercise_id, userId, row.exercise_name.trim() || "Unnamed exercise", source.origin);
      database.prepare("INSERT INTO exercise_sources(user_id,source_key,exercise_id,kind) VALUES (?,?,?,?)").run(userId, source.key, assignment.exercise_id, source.kind);
    }
    if (useAliases) {
      assignment.exercise_id = resolveCatalogRedirect(database, userId, chosen ?? assignment.exercise_id);
      registerExerciseAlias(database, userId, row.exercise_name, measurement, assignment.exercise_id);
    }
    database.prepare("INSERT INTO exercise_set_sources(session_set_id,user_id,source_key,observation_key,exercise_id) VALUES (?,?,?,?,?)")
      .run(row.id, userId, source.key, source.observation, assignment.exercise_id);
  }
}
