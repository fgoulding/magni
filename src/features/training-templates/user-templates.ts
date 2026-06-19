import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  evaluateProgressionRule,
  parseProgressionRule,
  ruleAutoProgresses,
  type SerializableProgressionRule,
} from "@/features/training-templates/custom-rule";
import { getTrainingTemplate, isTrainingTemplateId } from "@/features/training-templates/registry";
import type { ExerciseCategory, TemplateWeek, TrainingTemplate } from "@/features/training-templates/types";

/** User-defined progression ids are namespaced so they never collide with built-ins. */
export const CUSTOM_TEMPLATE_PREFIX = "custom:";

export function isUserTemplateId(id: string): boolean {
  return id.startsWith(CUSTOM_TEMPLATE_PREFIX);
}

/** One row of the loading grid: N sets at one intensity, with a rep-out target on the top set. */
export type CustomTemplateWeek = Readonly<{
  weekNumber: number;
  sets: number;
  reps: number;
  intensityPct: number;
  repOutTarget: number;
}>;

export type UserTrainingTemplate = Readonly<{
  id: string;
  name: string;
  description: string;
  weeks: CustomTemplateWeek[];
  rule: SerializableProgressionRule;
}>;

function assertPositiveInt(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 999) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

/** Validate an untrusted weekly grid (request body or stored JSON). */
export function parseGrid(value: unknown): CustomTemplateWeek[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 52) {
    throw new Error("weeks must be a non-empty array (max 52)");
  }
  return value.map((raw, index) => {
    const week = (raw ?? {}) as Record<string, unknown>;
    const intensityPct = Number(week.intensityPct);
    if (!Number.isFinite(intensityPct) || intensityPct <= 0 || intensityPct > 1) {
      throw new Error("intensityPct must be between 0 and 1");
    }
    return {
      weekNumber: index + 1,
      sets: assertPositiveInt(week.sets, "sets"),
      reps: assertPositiveInt(week.reps, "reps"),
      intensityPct,
      repOutTarget: assertPositiveInt(week.repOutTarget, "repOutTarget"),
    };
  });
}

type TemplateRow = { id: string; name: string; description: string; weeks_json: string; rule_json: string };

function rowToTemplate(row: TemplateRow): UserTrainingTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    weeks: parseGrid(JSON.parse(row.weeks_json)),
    rule: parseProgressionRule(JSON.parse(row.rule_json)),
  };
}

const SELECT = "SELECT id, name, description, weeks_json, rule_json FROM user_training_templates";

export function listUserTrainingTemplates(userId: number): UserTrainingTemplate[] {
  return (db.prepare(`${SELECT} WHERE user_id = ? ORDER BY name`).all(userId) as TemplateRow[]).map(rowToTemplate);
}

export function getUserTrainingTemplate(id: string, userId: number): UserTrainingTemplate | null {
  const row = db.prepare(`${SELECT} WHERE id = ? AND user_id = ?`).get(id, userId) as TemplateRow | undefined;
  return row ? rowToTemplate(row) : null;
}

export function createUserTrainingTemplate(input: {
  userId: number;
  name: unknown;
  description?: unknown;
  weeks: unknown;
  rule: unknown;
}): UserTrainingTemplate {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("name is required");
  const description = String(input.description ?? "").trim();
  const weeks = parseGrid(input.weeks);
  const rule = parseProgressionRule(input.rule);
  const id = `${CUSTOM_TEMPLATE_PREFIX}${randomUUID()}`;

  db.prepare(
    `INSERT INTO user_training_templates (id, user_id, name, description, weeks_json, rule_json, auto_progression)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.userId, name, description, JSON.stringify(weeks), JSON.stringify(rule), ruleAutoProgresses(rule) ? 1 : 0);

  return { id, name, description, weeks, rule };
}

export function deleteUserTrainingTemplate(id: string, userId: number): boolean {
  return db.prepare("DELETE FROM user_training_templates WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

const ALL_CATEGORIES: ExerciseCategory[] = ["main", "aux", "accessory"];

/** Project a user template onto the built-in TrainingTemplate shape so the rest of
 *  the engine (materialization + advance dispatch) treats it identically. Each grid
 *  week becomes a per-set ramp; only the final set carries the rep-out (AMRAP) target. */
export function toTrainingTemplate(template: UserTrainingTemplate): TrainingTemplate {
  const weeks: TemplateWeek[] = template.weeks.map((week) => ({
    weekNumber: week.weekNumber,
    intensityPct: 0,
    reps: 0,
    sets: 0,
    repOutTarget: 0,
    ramp: Array.from({ length: week.sets }, (_, index) => ({
      setNumber: index + 1,
      intensityPct: week.intensityPct,
      reps: week.reps,
      repOutTarget: index === week.sets - 1 ? week.repOutTarget : week.reps,
    })),
  }));

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    supportedCategories: ALL_CATEGORIES,
    autoProgression: ruleAutoProgresses(template.rule),
    weeksByCategory: { main: weeks, aux: weeks, accessory: weeks },
    progression: { calculateTrainingMaxDelta: (context) => evaluateProgressionRule(template.rule, context) },
  };
}

/** Resolve a progression id to a TrainingTemplate: built-in registry first, then the
 *  user's own templates. Throws (like the registry) if neither resolves. */
export function resolveTrainingTemplate(id: string, userId: number): TrainingTemplate {
  if (isTrainingTemplateId(id)) return getTrainingTemplate(id);
  const userTemplate = getUserTrainingTemplate(id, userId);
  if (userTemplate) return toTrainingTemplate(userTemplate);
  return getTrainingTemplate(id); // unknown → same throw as a bad built-in id
}
