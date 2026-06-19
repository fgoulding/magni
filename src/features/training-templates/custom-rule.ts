import type { TrainingMaxContext } from "@/features/training-templates/types";

/**
 * A user-defined progression rule, stored as DATA (the built-in `ProgressionRule`
 * is a closure and can't be persisted). Two kinds cover every common program:
 *  - `amrap-proportional`: SBS-style — scale the training max by how far the AMRAP
 *    set beat (or missed) its rep-out target. Adjusts up AND down.
 *  - `linear-add`: StrongLifts/Madcow-style — hit the rep-out target → add a fixed
 *    jump; miss → `onFail` (default 0, i.e. repeat; negative to deload).
 *  - `none`: manual, never auto-progresses.
 */
export type SerializableProgressionRule =
  | { readonly kind: "none" }
  | { readonly kind: "amrap-proportional"; readonly perRep: number }
  | { readonly kind: "linear-add"; readonly onSuccess: number; readonly onFail?: number };

/** Training-max delta for a completed AMRAP/top set under a serialized rule. */
export function evaluateProgressionRule(rule: SerializableProgressionRule, context: TrainingMaxContext): number {
  switch (rule.kind) {
    case "none":
      return 0;
    case "amrap-proportional":
      return (context.actualReps - context.repOutTarget) * rule.perRep;
    case "linear-add":
      return context.actualReps >= context.repOutTarget ? rule.onSuccess : (rule.onFail ?? 0);
  }
}

/** Whether a rule ever moves the training max (drives auto_progression_enabled). */
export function ruleAutoProgresses(rule: SerializableProgressionRule): boolean {
  return rule.kind !== "none";
}

/** Validate/normalize an untrusted rule (from a request body or stored JSON). */
export function parseProgressionRule(value: unknown): SerializableProgressionRule {
  if (!value || typeof value !== "object") throw new Error("rule must be an object");
  const record = value as Record<string, unknown>;
  switch (record.kind) {
    case "none":
      return { kind: "none" };
    case "amrap-proportional": {
      const perRep = Number(record.perRep);
      if (!Number.isFinite(perRep) || perRep <= 0 || perRep > 100) {
        throw new Error("amrap-proportional rule needs a perRep between 0 and 100");
      }
      return { kind: "amrap-proportional", perRep };
    }
    case "linear-add": {
      const onSuccess = Number(record.onSuccess);
      if (!Number.isFinite(onSuccess) || onSuccess < 0 || onSuccess > 100) {
        throw new Error("linear-add rule needs onSuccess between 0 and 100");
      }
      const onFail = record.onFail === undefined ? undefined : Number(record.onFail);
      if (onFail !== undefined && (!Number.isFinite(onFail) || onFail < -100 || onFail > 0)) {
        throw new Error("linear-add onFail must be between -100 and 0");
      }
      return onFail === undefined ? { kind: "linear-add", onSuccess } : { kind: "linear-add", onSuccess, onFail };
    }
    default:
      throw new Error(`unknown progression rule kind: ${String(record.kind)}`);
  }
}
