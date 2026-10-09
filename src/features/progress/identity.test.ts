import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
let database: typeof import("@/lib/db");
let history: typeof import("@/features/workouts/history-service");
let identity: typeof import("./identity");
let userId: number; let otherId: number; let dir: string;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "magni-progress-identity-"));
  vi.stubEnv("DB_PATH", path.join(dir, "test.sqlite"));
  database = await import("@/lib/db"); history = await import("@/features/workouts/history-service"); identity = await import("./identity");
  userId = Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('progress-owner@example.test','hash')").run().lastInsertRowid);
  otherId = Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('progress-other@example.test','hash')").run().lastInsertRowid);
});
beforeEach(()=>{userId=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES (?,'hash')").run(`${crypto.randomUUID()}@example.test`).lastInsertRowid);});
function separateName(owner:number) {
 database.db.prepare("INSERT INTO exercise_name_aliases(user_id,name_key,family_key,exercise_id,state) VALUES (?,'row','unknown',NULL,'blocked') ON CONFLICT(user_id,name_key,family_key) DO UPDATE SET exercise_id=NULL,state='blocked'").run(owner);
}
afterAll(() => { database?.db.close(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
function workout(owner=userId, catalogExerciseId?: string) {
  const session = history.createQuickSession({ userId: owner, newWorkout: true, date: "2026-10-01" }).session;
  const result = history.addQuickExercise({ userId: owner, sessionId: session.id, name: "Row", catalogExerciseId, sets: [{ reps: 10, weight: 40 }, { reps: 8, weight: 45 }] });
  history.saveActualSet({ userId: owner, sessionId: session.id, setId: result.sets[0].id, actualReps: 10, actualWeight: 40 });
  history.finishQuickSession(owner, session.id);
  return { ...session, sets: result.sets };
}
it("reuses equal names and carries selected, repeated and routine identity", () => {
  const a=workout(); const b=workout();
  const aId=identity.resolveSetExerciseIdentities(userId,a.id).get(a.sets[0].id)!.exerciseId;
  expect(identity.resolveSetExerciseIdentities(userId,b.id).get(b.sets[0].id)!.exerciseId).toBe(aId);
  const chosen=workout(userId,aId);
  expect(identity.resolveSetExerciseIdentities(userId,chosen.id).get(chosen.sets[0].id)!.exerciseId).toBe(aId);
  const repeated=history.createQuickSession({userId,sourceSessionId:a.id}).session;
  expect(identity.resolveSetExerciseIdentities(userId,repeated.id).get(repeated.sets[0].id)!.exerciseId).toBe(aId);
  const routine=history.saveRoutine({userId,sessionId:a.id,name:"Rows"});
  const reused=history.createQuickSession({userId,routineId:routine.id}).session;
  expect(identity.resolveSetExerciseIdentities(userId,reused.id).get(reused.sets[0].id)!.exerciseId).toBe(aId);
  expect(() => workout(otherId,aId)).toThrow(/not found/i);
  expect(identity.resolveSetExerciseIdentities(otherId,a.id).size).toBe(0);
});
it("links only selected observations with a preview, preserves originals, retries and reverses", () => {
  separateName(userId);
  const a=workout(); const b=workout(); const omitted=workout();
  const original=database.db.prepare("SELECT * FROM session_sets WHERE session_id IN (?,?,?) ORDER BY id").all(a.id,b.id,omitted.id);
  const input={observationIds:[a.sets[0].id,b.sets[0].id],name:"Barbell row"};
  const preview=identity.previewExerciseLink(userId,input);
  expect(preview.observationCount).toBe(2); expect(preview.sessionCount).toBe(2);
  const apply={...input,previewToken:preview.token,requestKey:crypto.randomUUID()};
  const result=identity.applyExerciseLink(userId,apply);
  expect(identity.applyExerciseLink(userId,apply)).toEqual(result);
  for(const item of [a,b]) expect(new Set([...identity.resolveSetExerciseIdentities(userId,item.id).values()].map(row=>row.exerciseId))).toEqual(new Set([result.targetExerciseId]));
  expect(identity.resolveSetExerciseIdentities(userId,omitted.id).get(omitted.sets[0].id)!.exerciseId).not.toBe(result.targetExerciseId);
  expect(database.db.prepare("SELECT * FROM session_sets WHERE session_id IN (?,?,?) ORDER BY id").all(a.id,b.id,omitted.id)).toEqual(original);
  const undo={changeId:result.changeId,requestKey:crypto.randomUUID()};
  expect(identity.undoExerciseLink(userId,undo).undone).toBe(true);
  expect(identity.undoExerciseLink(userId,undo).undone).toBe(true);
  expect(identity.resolveSetExerciseIdentities(userId,a.id).get(a.sets[0].id)!.exerciseId).not.toBe(identity.resolveSetExerciseIdentities(userId,b.id).get(b.sets[0].id)!.exerciseId);
});
it("rejects stale previews and foreign observations atomically", () => {
  const a=workout(); const b=workout(otherId);
  expect(()=>identity.previewExerciseLink(userId,{observationIds:[a.sets[0].id,b.sets[0].id],name:"Bad"})).toThrow(/not found/i);
  const input={observationIds:[a.sets[0].id],name:"Chosen"}; const preview=identity.previewExerciseLink(userId,input);
  database.db.prepare("UPDATE sessions SET revision=revision+1 WHERE id=?").run(a.id);
  expect(()=>identity.applyExerciseLink(userId,{...input,previewToken:preview.token,requestKey:crypto.randomUUID()})).toThrow(/changed/i);
  expect(database.db.prepare("SELECT id FROM exercise_catalog WHERE name='Chosen'").get()).toBeUndefined();
});
it("limits owned pins to four, replaces explicitly, and never silently evicts", () => {
  separateName(userId);
  const ids=Array.from({length:5},()=>{const a=workout();return identity.resolveSetExerciseIdentities(userId,a.id).get(a.sets[0].id)!.exerciseId;});
  ids.slice(0,4).forEach(exerciseId=>identity.updateExercisePin(userId,{exerciseId,pinned:true}));
  expect(()=>identity.updateExercisePin(userId,{exerciseId:ids[4],pinned:true})).toThrow(/four|4/i);
  expect(identity.getPinnedExerciseIds(userId)).toEqual(ids.slice(0,4));
  identity.updateExercisePin(userId,{exerciseId:ids[4],pinned:true,replaceExerciseId:ids[1]});
  expect(identity.getPinnedExerciseIds(userId)).toEqual([ids[0],ids[4],ids[2],ids[3]]);
  expect(()=>identity.updateExercisePin(otherId,{exerciseId:ids[0],pinned:true})).toThrow(/not found/i);
});
it("keeps recent suggestions distinct and identifies the exact source workout",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('suggestion-owner@example.test','hash')").run().lastInsertRowid);
 separateName(owner);
 const a=workout(owner);const b=workout(owner);
 const suggestions=history.recentExercises(owner,"Row");expect(suggestions).toHaveLength(2);
 expect(new Set(suggestions.map(row=>row.catalogExerciseId)).size).toBe(2);
 expect(suggestions.map(row=>row.sessionId)).toEqual([b.id,a.id]);
});
it("does not silently keep a repeated quick exercise in its old series after a variant rename",()=>{
 const original=workout();const originalId=identity.resolveSetExerciseIdentities(userId,original.id).get(original.sets[0].id)!.exerciseId;
 const repeat=history.createQuickSession({userId,sourceSessionId:original.id}).session;
 history.updateQuickStructure({userId,sessionId:repeat.id,expectedRevision:repeat.revision,renameExercise:{setIds:repeat.sets.map(set=>set.id),name:"Incline row"}});
 const mapping=identity.resolveSetExerciseIdentities(userId,repeat.id);
 expect(new Set([...mapping.values()].map(row=>row.exerciseId)).size).toBe(1);
 expect(mapping.get(repeat.sets[0].id)!.exerciseId).not.toBe(originalId);
});
it("detaches only selected observations and rejects undo after another mapping edit",()=>{
 const original=workout();const repeated=history.createQuickSession({userId,sourceSessionId:original.id}).session;
 history.saveActualSet({userId,sessionId:repeated.id,setId:repeated.sets[0].id,actualReps:10,actualWeight:40});history.finishQuickSession(userId,repeated.id);
 const originalId=identity.resolveSetExerciseIdentities(userId,original.id).get(original.sets[0].id)!.exerciseId;
 const input={mode:"detach" as const,observationIds:[repeated.sets[0].id]};const preview=identity.previewExerciseLink(userId,input);
 const detached=identity.applyExerciseLink(userId,{...input,previewToken:preview.token,requestKey:crypto.randomUUID()});
 expect(identity.resolveSetExerciseIdentities(userId,original.id).get(original.sets[0].id)!.exerciseId).toBe(originalId);
 expect(identity.resolveSetExerciseIdentities(userId,repeated.id).get(repeated.sets[0].id)!.exerciseId).not.toBe(originalId);
 const newer={observationIds:input.observationIds,name:"Another deliberate group"};const review=identity.previewExerciseLink(userId,newer);
 identity.applyExerciseLink(userId,{...newer,previewToken:review.token,requestKey:crypto.randomUUID()});
 expect(()=>identity.undoExerciseLink(userId,{changeId:detached.changeId,requestKey:crypto.randomUUID()})).toThrow(/changed/i);
});
it("undo restores discovery origin and rejects later legitimate target reuse",async()=>{
 const queries=await import("./queries");
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('undo-origin@example.test','hash')").run().lastInsertRowid);
 separateName(owner);
 const a=workout(owner);const b=workout(owner);
 const target=identity.resolveSetExerciseIdentities(owner,a.id).get(a.sets[0].id)!.exerciseId;
 const before=queries.listProgressExercises(owner).items;
 const input={observationIds:[b.sets[0].id],targetExerciseId:target};const preview=identity.previewExerciseLink(owner,input);
 const result=identity.applyExerciseLink(owner,{...input,previewToken:preview.token,requestKey:crypto.randomUUID()});
 expect(queries.listProgressExercises(owner).items[0]).toMatchObject({kind:"exercise",historyCount:2});
 identity.undoExerciseLink(owner,{changeId:result.changeId,requestKey:crypto.randomUUID()});
 expect(queries.listProgressExercises(owner).items).toEqual(before);
 const secondPreview=identity.previewExerciseLink(owner,input);
 const second=identity.applyExerciseLink(owner,{...input,previewToken:secondPreview.token,requestKey:crypto.randomUUID()});
 workout(owner,target);
 expect(()=>identity.undoExerciseLink(owner,{changeId:second.changeId,requestKey:crypto.randomUUID()})).toThrow(/changed/i);
 expect(identity.resolveSetExerciseIdentities(owner,b.id).get(b.sets[0].id)!.exerciseId).toBe(target);
});
