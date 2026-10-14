import bundled from "../../../program-templates/full-body-supersets-3-day.json";
import { compileProgramTemplate, type ProgramTemplate } from "../program-templates/template";
import type { ProgramDocumentV1 } from "./document";

export const FULL_BODY_SUPERSET_PRESET = {
  id: "full-body-supersets-3-day",
  title: bundled.title,
  description: "Squat, bench and deadlift days. Three pairs per day: five rounds of A/B, three of C. Choose your working loads.",
} as const;

/** Compatibility for the advanced editor's bundled preset. Normal creation
 * uses the current published catalog and freezes its independently owned copy. */
export function makeFullBodySupersetProgram(startDate: string): ProgramDocumentV1 {
  const loads = Object.fromEntries(bundled.days.flatMap(day => day.exercises.map(slot => [slot.id, 0])));
  return compileProgramTemplate(bundled as ProgramTemplate, { startDate, loads });
}
