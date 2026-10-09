import type Database from "better-sqlite3";
import { exerciseFamilyKey, exerciseNameKey, resolveCatalogRedirect } from "./aliases";
import { sessionSourceDescriptions, type SourceRow } from "./source-links";

type Mapping = { session_set_id: number; user_id: number; source_key: string; exercise_id: string; revision: number; sourceExerciseId: string };
/** Only identity indexes change. Frozen training rows and user preferences do not. */
export function runExerciseAliasMigration(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS exercise_name_aliases (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name_key TEXT NOT NULL,
        family_key TEXT NOT NULL,
        exercise_id TEXT,
        state TEXT NOT NULL CHECK(state IN ('resolved','blocked')),
        PRIMARY KEY(user_id,name_key,family_key),
        FOREIGN KEY(user_id,exercise_id) REFERENCES exercise_catalog(user_id,id),
        CHECK((state='resolved' AND exercise_id IS NOT NULL) OR (state='blocked' AND exercise_id IS NULL))
      );
      CREATE TABLE IF NOT EXISTS exercise_catalog_redirects (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        old_exercise_id TEXT NOT NULL,
        exercise_id TEXT NOT NULL,
        PRIMARY KEY(user_id,old_exercise_id),
        FOREIGN KEY(user_id,old_exercise_id) REFERENCES exercise_catalog(user_id,id),
        FOREIGN KEY(user_id,exercise_id) REFERENCES exercise_catalog(user_id,id),
        CHECK(old_exercise_id<>exercise_id)
      );
    `);
    const protectedIds = new Set<string>();
    const protect = (user: number, id: string) => protectedIds.add(`${user}:${id}`);
    const audits = db.prepare("SELECT user_id,before_json,after_json FROM exercise_identity_changes").all() as { user_id: number; before_json: string; after_json: string }[];
    for (const audit of audits) for (const json of [audit.before_json, audit.after_json]) {
      const value = JSON.parse(json) as { sets: { exerciseId: string }[]; catalogs: { id: string }[] } | { exerciseId: string }[];
      for (const row of Array.isArray(value) ? value : value.sets) protect(audit.user_id, row.exerciseId);
      if (!Array.isArray(value)) for (const row of value.catalogs ?? []) protect(audit.user_id, row.id);
    }
    for (const row of db.prepare("SELECT user_id,id FROM exercise_catalog WHERE origin='confirmed'").all() as { user_id: number; id: string }[]) protect(row.user_id, row.id);
    const mappings = db.prepare(`SELECT x.*,s.exercise_id AS sourceExerciseId FROM exercise_set_sources x
      JOIN exercise_sources s USING(user_id,source_key) ORDER BY x.session_set_id`).all() as Mapping[];
    for (const row of mappings) if (row.revision > 1 || row.exercise_id !== row.sourceExerciseId) {
      protect(row.user_id, row.exercise_id); protect(row.user_id, row.sourceExerciseId);
    }
    const bySet = new Map(mappings.map(row => [row.session_set_id, row]));
    const sessionRows = db.prepare(`SELECT ss.*,s.user_id,s.program_id,s.program_run_id FROM session_sets ss
      JOIN sessions s ON s.id=ss.session_id ORDER BY ss.session_id,ss.id`).all() as SourceRow[];
    const sessions = new Map<number, SourceRow[]>();
    for (const row of sessionRows) { const rows = sessions.get(row.session_id) ?? []; rows.push(row); sessions.set(row.session_id, rows); }
    type Group = { userId: number; name: string; family: string; ids: Set<string> };
    const groups = new Map<string, Group>();
    const catalogGroups = new Map<string, Set<string>>();
    for (const rows of sessions.values()) for (const { row, measurement } of sessionSourceDescriptions(rows)) {
      const mapping = bySet.get(row.id); if (!mapping) continue;
      const name = exerciseNameKey(row.exercise_name), family = exerciseFamilyKey(name, measurement);
      const key = JSON.stringify([row.user_id, name, family]);
      const group = groups.get(key) ?? { userId: row.user_id, name, family, ids: new Set<string>() };
      group.ids.add(mapping.exercise_id); groups.set(key, group);
      const catalogKey = `${row.user_id}:${mapping.exercise_id}`;
      const keys = catalogGroups.get(catalogKey) ?? new Set<string>(); keys.add(key); catalogGroups.set(catalogKey, keys);
    }
    // An explicitly reused identity with different recorded names/load families
    // cannot be globally redirected based on just one of its labels.
    for (const [id, keys] of catalogGroups) if (keys.size > 1) protectedIds.add(id);
    for (const group of groups.values()) {
      const ids = [...group.ids].map(id => resolveCatalogRedirect(db, group.userId, id));
      const unique = [...new Set(ids)];
      const prior = db.prepare("SELECT exercise_id,state FROM exercise_name_aliases WHERE user_id=? AND name_key=? AND family_key=?").get(group.userId, group.name, group.family) as { exercise_id: string | null; state: string } | undefined;
      // An already established, unambiguous alias is authoritative (including
      // a successful Undo that restored automatic matching). Old audit entries
      // still protect mappings; they must not erase this later alias decision.
      if (prior?.state === "resolved" && unique.length === 1 && unique[0] === resolveCatalogRedirect(db, group.userId, prior.exercise_id!)) continue;
      const blocked = prior?.state === "blocked" || unique.some(id => protectedIds.has(`${group.userId}:${id}`));
      // Previously established aliases win, otherwise oldest catalog insertion
      // gives deterministic migration behavior independent of UUID ordering.
      const eligible = unique.filter(id => !protectedIds.has(`${group.userId}:${id}`));
      const canonical = prior?.state === "resolved" && eligible.includes(prior.exercise_id!) ? prior.exercise_id! : eligible.sort((a, b) => {
        const order = (id: string) => (db.prepare("SELECT rowid AS n FROM exercise_catalog WHERE user_id=? AND id=?").get(group.userId, id) as { n: number }).n;
        return order(a) - order(b);
      })[0];
      if (canonical) for (const id of eligible) if (id !== canonical) {
        db.prepare("UPDATE exercise_set_sources SET exercise_id=? WHERE user_id=? AND exercise_id=?").run(canonical, group.userId, id);
        db.prepare("UPDATE exercise_sources SET exercise_id=? WHERE user_id=? AND exercise_id=?").run(canonical, group.userId, id);
        db.prepare("INSERT INTO exercise_catalog_redirects(user_id,old_exercise_id,exercise_id) VALUES (?,?,?)").run(group.userId, id, canonical);
      }
      db.prepare(`INSERT INTO exercise_name_aliases(user_id,name_key,family_key,exercise_id,state) VALUES (?,?,?,?,?)
        ON CONFLICT(user_id,name_key,family_key) DO UPDATE SET exercise_id=excluded.exercise_id,state=excluded.state`)
        .run(group.userId, group.name, group.family, blocked || !canonical ? null : canonical, blocked || !canonical ? "blocked" : "resolved");
    }
  }).immediate();
}
