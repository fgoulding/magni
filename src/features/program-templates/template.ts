import { compileTemplate, validateTemplate } from "./contract.mjs";
import type { ProgramDocumentV1, DocumentIssue } from "../program-editor/document";

export type ProgramTemplate = {
  schemaVersion: 1; id: string; revision: number; title: string; description: string;
  unit: "lb" | "kg"; cycles: number; weekdays: number[];
  lifts: { id: string; name: string; loadMode: "working" | "bodyweight"; notes?: string }[];
  days: { id: string; name: string; exercises: {
    id: string; liftId: string; supersetGroup: string; sets: number; repMin: number; repMax: number;
    effortRir?: number; restSeconds?: number; tempo?: string; notes?: string;
  }[] }[];
};
export type TemplateSetup = {
  name?: string; startDate: string; unit?: "lb" | "kg"; cycles?: number;
  weekdays?: number[]; loads?: Record<string, number>;
};
export function validateProgramTemplate(value: unknown): DocumentIssue[] { return validateTemplate(value); }
export function compileProgramTemplate(template: ProgramTemplate, setup: TemplateSetup): ProgramDocumentV1 {
  return compileTemplate(template, setup) as ProgramDocumentV1;
}
