import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

/** Whole-name equivalents only. Equipment and movement qualifiers are never stripped. */
const equivalents: Record<string, string> = {
  "bench press": "bench", "barbell bench press": "bench",
  "dead lift": "deadlift", "barbell deadlift": "deadlift", "conventional deadlift": "deadlift",
  "back squat": "squat", "barbell back squat": "squat", "barbell squat": "squat",
};
export function exerciseNameKey(name: string): string {
  const key = name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  return equivalents[key] ?? key;
}
export function exerciseFamilyKey(name: string, measurement: string): string {
  // Quick/legacy rows cannot distinguish weight modes. Bridge only the three
  // named external-load lifts; never infer bodyweight, added load or mixed modes.
  return measurement === "unknown" && ["squat", "bench", "deadlift"].includes(exerciseNameKey(name)) ? "external" : measurement;
}
export function resolveCatalogRedirect(db: Database.Database, userId: number, id: string): string {
  // Redirect targets are canonical at write time; the bounded loop also supports
  // a later migration consolidating a formerly canonical target.
  const seen = new Set<string>();
  while (!seen.has(id)) {
    seen.add(id);
    const row = db.prepare("SELECT exercise_id FROM exercise_catalog_redirects WHERE user_id=? AND old_exercise_id=?").get(userId, id) as { exercise_id: string } | undefined;
    if (!row) return id;
    id = row.exercise_id;
  }
  throw new Error("Exercise identity redirect cycle");
}
export function findExerciseAlias(db: Database.Database, userId: number, name: string, measurement: string): string | null {
  const row = db.prepare("SELECT exercise_id FROM exercise_name_aliases WHERE user_id=? AND name_key=? AND family_key=? AND state='resolved'")
    .get(userId, exerciseNameKey(name), exerciseFamilyKey(name, measurement)) as { exercise_id: string } | undefined;
  return row ? resolveCatalogRedirect(db, userId, row.exercise_id) : null;
}
export function registerExerciseAlias(db: Database.Database, userId: number, name: string, measurement: string, exerciseId: string): void {
  const key = exerciseNameKey(name), family = exerciseFamilyKey(name, measurement);
  const current = db.prepare("SELECT exercise_id,state FROM exercise_name_aliases WHERE user_id=? AND name_key=? AND family_key=?").get(userId, key, family) as { exercise_id: string | null; state: string } | undefined;
  if (!current) db.prepare("INSERT INTO exercise_name_aliases(user_id,name_key,family_key,exercise_id,state) VALUES (?,?,?,?,'resolved')").run(userId, key, family, exerciseId);
  else if (current.state === "resolved" && resolveCatalogRedirect(db, userId, current.exercise_id!) !== exerciseId) {
    db.prepare("UPDATE exercise_name_aliases SET exercise_id=NULL,state='blocked' WHERE user_id=? AND name_key=? AND family_key=?").run(userId, key, family);
  }
}
/** Explicit history edits stop this label from choosing a future identity silently. */
export function blockExerciseAliases(db: Database.Database, userId: number, ids: string[]): void {
  if (!ids.length) return;
  db.prepare(`UPDATE exercise_name_aliases SET exercise_id=NULL,state='blocked' WHERE user_id=? AND exercise_id IN (${ids.map(() => "?").join(",")})`).run(userId, ...ids);
}

export type ExerciseAliasState = {
  nameKey: string; familyKey: string; exerciseId: string | null; state: "resolved" | "blocked"; historyFingerprint: string;
};
/** Capture both the alias and the identity membership that made its resolution
 * safe. There is no schema-level alias revision; set/source revisions also catch
 * decisions that leave an already-blocked alias row looking unchanged. */
export function exerciseAliasStates(db: Database.Database, userId: number, scope: { exerciseIds: string[] } | { aliases: ExerciseAliasState[] }): ExerciseAliasState[] {
  const mappings = db.prepare(`SELECT ss.exercise_name AS name,x.session_set_id AS setId,x.source_key AS sourceKey,
    x.exercise_id AS exerciseId,x.revision,ps.exercise_id AS sourceExerciseId,ps.revision AS sourceRevision
    FROM exercise_set_sources x JOIN session_sets ss ON ss.id=x.session_set_id
    JOIN sessions s ON s.id=ss.session_id AND s.user_id=x.user_id
    JOIN exercise_sources ps ON ps.user_id=x.user_id AND ps.source_key=x.source_key
    WHERE x.user_id=? ORDER BY x.session_set_id`).all(userId) as { name: string; setId: number; sourceKey: string; exerciseId: string; revision: number; sourceExerciseId: string; sourceRevision: number }[];
  const names = "exerciseIds" in scope ? new Set(mappings.filter(row => scope.exerciseIds.includes(row.exerciseId)).map(row => exerciseNameKey(row.name))) : null;
  const rows = db.prepare(`SELECT name_key AS nameKey,family_key AS familyKey,exercise_id AS exerciseId,state
    FROM exercise_name_aliases WHERE user_id=? ORDER BY name_key,family_key`).all(userId) as Omit<ExerciseAliasState, "historyFingerprint">[];
  return rows.filter(row => names ? names.has(row.nameKey) : "aliases" in scope && scope.aliases.some(alias => alias.nameKey === row.nameKey && alias.familyKey === row.familyKey))
    .map(row => ({ ...row, historyFingerprint: createHash("sha256").update(JSON.stringify(mappings.filter(mapping => exerciseNameKey(mapping.name) === row.nameKey))).digest("hex") }));
}
export function restoreExerciseAliases(db: Database.Database, userId: number, states: ExerciseAliasState[]): void {
  for (const state of states) db.prepare("UPDATE exercise_name_aliases SET exercise_id=?,state=? WHERE user_id=? AND name_key=? AND family_key=?")
    .run(state.exerciseId, state.state, userId, state.nameKey, state.familyKey);
}
