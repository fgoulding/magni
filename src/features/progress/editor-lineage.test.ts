import { expect,it } from "vitest";
import { createExercise, validateDraftStructure, createBlankDocument } from "@/features/program-editor/document";
import { cloneExercise } from "@/features/program-editor/operations";
it("copies tracking lineage independently of progression sharing and creates distinct new exercises",()=>{
  const first=createExercise("Row"); const copy=cloneExercise(first,false); const fresh=createExercise("Row");
  expect(first.historyKey).toBe(first.id);
  expect(copy.id).not.toBe(first.id); expect(copy.progressionKey).not.toBe(first.progressionKey);
  expect(copy.historyKey).toBe(first.historyKey); expect(fresh.historyKey).not.toBe(first.historyKey);
  const legacy={...first};delete legacy.historyKey;
  expect(cloneExercise(legacy).historyKey).toBe(first.id);
});
it("rejects malformed optional lineage without breaking older documents",()=>{
  const doc=createBlankDocument();const exercise=createExercise("Row");doc.weeks[0].days[0].exercises=[exercise];
  delete exercise.historyKey;expect(validateDraftStructure(doc)).toEqual([]);
  (exercise as unknown as {historyKey:unknown}).historyKey={};
  expect(validateDraftStructure(doc).some(issue=>issue.path.endsWith("historyKey"))).toBe(true);
});
