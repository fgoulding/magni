import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EditorPrescriptionSet } from '@/features/program-editor/repository';
let db:(typeof import('@/lib/db'))['db'];
let service:typeof import('@/features/workouts/history-service');
let execution:typeof import('@/features/program-editor/execution');
let document:typeof import('@/features/program-editor/document');
let repository:typeof import('@/features/program-editor/repository');
let occurrences:typeof import('@/features/programs/occurrences');
let dir:string;let userId:number;
beforeAll(async()=>{
 dir=fs.mkdtempSync(path.join(os.tmpdir(),'magni-m5-review-'));vi.stubEnv('DB_PATH',path.join(dir,'review.sqlite'));
 db=(await import('@/lib/db')).db;service=await import('@/features/workouts/history-service');execution=await import('@/features/program-editor/execution');document=await import('@/features/program-editor/document');repository=await import('@/features/program-editor/repository');occurrences=await import('@/features/programs/occurrences');
 userId=Number(db.prepare("INSERT INTO users(email,password_hash) VALUES ('review-m5@example.test','hash')").run().lastInsertRowid);
});
afterAll(()=>{db?.close();fs.rmSync(dir,{recursive:true,force:true});vi.unstubAllEnvs();});
function completedPlanned(){
 const doc=document.createBlankDocument();doc.name='Review rows';doc.startDate='2026-09-01';doc.weekdays=[0,1,2,3,4,5,6];doc.cycles=3;
 const exercise=document.createExercise('Row');exercise.rule={version:1,condition:{type:'double_progression'},action:{variable:'load',unit:'lb',operation:'add',amount:2.5,rounding:{mode:'nearest',quantum:2.5},timing:'per_exposure'}};
 doc.weeks[0].days[0].exercises=[exercise];const draftId=crypto.randomUUID();repository.saveEditorDraft({userId,id:draftId,expectedRevision:0,document:doc});const active=repository.activateEditorDraft({userId,id:draftId,expectedRevision:1});
 const occurrence=db.prepare('SELECT * FROM workout_occurrences WHERE program_run_id=? ORDER BY id LIMIT 1').get(active.runId) as {id:number,prescription_json:string,legacy_day_id:number,definition_day_id:number};
 const sessionId=Number(db.prepare(`INSERT INTO sessions(user_id,program_id,program_run_id,occurrence_id,day_id,program_definition_day_id,program_name,day_name,week_number,date,scheduled_date) VALUES (?,?,?,?,?,?, 'Review rows','Day A',1,'2026-09-01','2026-09-01')`).run(userId,active.programId,active.runId,occurrence.id,occurrence.legacy_day_id,occurrence.definition_day_id).lastInsertRowid);
 const sets=JSON.parse(occurrence.prescription_json) as EditorPrescriptionSet[];
 sets.forEach((row,index)=>{const set=execution.resolveEditorPrescription(row,active.runId);db.prepare('INSERT INTO session_sets(session_id,exercise_name,set_number,reps,sets,rep_out_target,calculated_weight,actual_reps,actual_weight,editor_json) VALUES (?,?,?,?,1,?,?,?,?,?)').run(sessionId,'Row',index+1,set.reps,set.rep_out_target,set.calculated_weight,[12,12,11][index],40,JSON.stringify(set.editor));});
 const decision=execution.applyEditorCompletion({userId,sessionId});db.prepare('UPDATE sessions SET completed=1 WHERE id=?').run(sessionId);db.prepare("UPDATE workout_occurrences SET status='completed' WHERE id=?").run(occurrence.id);
 return {session:service.getWorkout(userId,sessionId)!,occurrence,decision};
}
describe('cumulative history corrections',()=>{
 it('includes earlier corrections when explaining a later correction',()=>{
  const {session}=completedPlanned();
  const progressionBefore=db.prepare('SELECT * FROM program_editor_progression_state ORDER BY run_id,progression_key').all();
  const eventBefore=db.prepare('SELECT * FROM program_editor_progression_events WHERE session_id=?').get(session.id);
  const first=service.correctWorkout({userId,sessionId:session.id,expectedRevision:session.revision,reason:'Third set reached 12',sets:[{setId:session.sets[2].id,actualReps:12,actualWeight:40}]});
  expect(first.comparisons[0].corrected).toContain('42.5');
  const preview=service.previewCorrection(userId,session.id,[{setId:session.sets[0].id,actualReps:13,actualWeight:40}]);
  expect(preview.comparisons[0].corrected).toContain('42.5');
  expect(db.prepare('SELECT * FROM program_editor_progression_state ORDER BY run_id,progression_key').all()).toEqual(progressionBefore);
  expect(db.prepare('SELECT * FROM program_editor_progression_events WHERE session_id=?').get(session.id)).toEqual(eventBefore);
  expect(service.getWorkout(userId,session.id)!.sets.map((set)=>({reps:set.reps,target:set.rep_out_target,weight:set.calculated_weight,editor:set.editor_json}))).toEqual(session.sets.map((set)=>({reps:set.reps,target:set.rep_out_target,weight:set.calculated_weight,editor:set.editor_json})));
 });
 it('shows corrected performed date consistently on the planned occurrence',()=>{
  const {session,occurrence}=completedPlanned();service.correctWorkout({userId,sessionId:session.id,expectedRevision:session.revision,reason:'Actually trained next day',sets:[],date:'2026-09-02'});
  expect(service.getWorkout(userId,session.id)?.date).toBe('2026-09-02');
  expect(occurrences.getOccurrence(userId,occurrence.id)?.performed_date).toBe('2026-09-02');
 });
});
