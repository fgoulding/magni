import path from "node:path";
import bundled from "../../../program-templates/full-body-supersets-3-day.json";
import { catalogTemplates } from "./storage.mjs";
import type { ProgramTemplate } from "./template";

export function listProgramTemplates(): ProgramTemplate[] {
  const databasePath = process.env.DB_PATH ?? path.join(process.cwd(), "data", "workouts.db");
  return catalogTemplates({ directory: process.env.PROGRAM_TEMPLATES_DIR ?? path.join(path.dirname(databasePath), "program-templates"), bundled: [bundled] }) as ProgramTemplate[];
}
export function getProgramTemplate(id: string): ProgramTemplate | null {
  return listProgramTemplates().find(template => template.id === id) ?? null;
}
