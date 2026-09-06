import type Database from "better-sqlite3";
import { parseProgressionRule, type SerializableProgressionRule } from "./custom-rule";

/** A reusable legacy template is copied as data at assignment, never re-resolved
 * at completion. Migration provenance deliberately does not claim recovery of
 * an older rule that was already edited or deleted before this release. */
export function captureLegacyTemplateSnapshot(db: Database.Database, userId: number, templateId: string, source = "assignment"): string | null {
  if (!templateId.startsWith("custom:")) return null;
  const row = db.prepare("SELECT name,description,weeks_json,rule_json FROM user_training_templates WHERE id=? AND user_id=?").get(templateId, userId) as { name: string; description: string; weeks_json: string; rule_json: string } | undefined;
  try {
    if (!row) throw new Error("Missing template");
    return JSON.stringify({ schemaVersion: 1, templateId, source, available: true, name: row.name, description: row.description, weeks: JSON.parse(row.weeks_json), rule: parseProgressionRule(JSON.parse(row.rule_json)) });
  } catch {
    return JSON.stringify({ schemaVersion: 1, templateId, source, available: false, reason: "The original custom progression template is unavailable. No replacement rule was inferred." });
  }
}

export function frozenLegacyRule(snapshot: string | null | undefined, templateId: string): SerializableProgressionRule | null {
  try {
    const value = JSON.parse(snapshot ?? "null");
    if (value?.schemaVersion !== 1 || value.templateId !== templateId || value.available !== true) return null;
    return parseProgressionRule(value.rule);
  } catch { return null; }
}

export function runLegacyTemplateSnapshotMigration(db: Database.Database): void {
  for (const table of ["program_definition_exercises", "session_sets"]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((column) => column.name === "template_snapshot_json")) db.exec(`ALTER TABLE ${table} ADD COLUMN template_snapshot_json TEXT`);
  }
  if (!(db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).some((column) => column.name === "legacy_completion_json")) db.exec("ALTER TABLE sessions ADD COLUMN legacy_completion_json TEXT");
  db.transaction(() => {
    const definitions = db.prepare(`SELECT e.id,e.progression_type,d.owner_user_id AS user_id FROM program_definition_exercises e
      JOIN program_definition_days day ON day.id=e.program_definition_day_id JOIN program_definitions d ON d.id=day.program_definition_id
      WHERE e.progression_type LIKE 'custom:%' AND e.template_snapshot_json IS NULL`).all() as { id: number; progression_type: string; user_id: number }[];
    for (const row of definitions) db.prepare("UPDATE program_definition_exercises SET template_snapshot_json=? WHERE id=?").run(captureLegacyTemplateSnapshot(db, row.user_id, row.progression_type, "migration-current-template"), row.id);
    // Completed history is deliberately untouched. Active old sessions get an
    // explicit best-available migration snapshot, or an unavailable marker.
    const sets = db.prepare(`SELECT ss.id,ss.progression_type,s.user_id FROM session_sets ss JOIN sessions s ON s.id=ss.session_id
      WHERE s.status='in_progress' AND ss.progression_type LIKE 'custom:%' AND ss.template_snapshot_json IS NULL`).all() as { id: number; progression_type: string; user_id: number }[];
    for (const row of sets) db.prepare("UPDATE session_sets SET template_snapshot_json=? WHERE id=?").run(captureLegacyTemplateSnapshot(db, row.user_id, row.progression_type, "migration-current-template"), row.id);
    const occurrences = db.prepare("SELECT id,user_id,prescription_json FROM workout_occurrences WHERE status IN ('scheduled','in_progress')").all() as { id: number; user_id: number; prescription_json: string }[];
    for (const row of occurrences) {
      const sets = JSON.parse(row.prescription_json) as { progression_type?: string; template_snapshot_json?: string | null }[];
      let changed = false;
      for (const set of sets) if (set.progression_type?.startsWith("custom:") && set.template_snapshot_json == null) {
        set.template_snapshot_json = captureLegacyTemplateSnapshot(db, row.user_id, set.progression_type, "migration-current-template"); changed = true;
      }
      if (changed) db.prepare("UPDATE workout_occurrences SET prescription_json=? WHERE id=?").run(JSON.stringify(sets), row.id);
    }
  }).immediate();
}
