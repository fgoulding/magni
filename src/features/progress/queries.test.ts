import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
let database:typeof import("@/lib/db");let history:typeof import("@/features/workouts/history-service");let identity:typeof import("./identity");let queries:typeof import("./queries");
let userId:number;let otherId:number;let dir:string;const catalogIds:string[]=[];
const groupKey=(name:string)=>`u:${Buffer.from(name).toString("base64url")}`;
function quickRecord(owner:number,name:string,date="2026-10-06",catalogExerciseId?:string){
 const session=history.createQuickSession({userId:owner,newWorkout:true,date}).session;
 const added=history.addQuickExercise({userId:owner,sessionId:session.id,name,catalogExerciseId,sets:[{reps:10,weight:40}]});
 history.saveActualSet({userId:owner,sessionId:session.id,setId:added.sets[0].id,actualReps:10,actualWeight:40});
 history.finishQuickSession(owner,session.id);
 return {sessionId:session.id,exerciseId:identity.resolveSetExerciseIdentities(owner,session.id).get(added.sets[0].id)!.exerciseId};
}
beforeAll(async()=>{
 dir=fs.mkdtempSync(path.join(os.tmpdir(),"magni-progress-queries-"));vi.stubEnv("DB_PATH",path.join(dir,"test.sqlite"));
 database=await import("@/lib/db");history=await import("@/features/workouts/history-service");identity=await import("./identity");queries=await import("./queries");
 userId=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('query-owner@example.test','hash')").run().lastInsertRowid);
 otherId=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('query-other@example.test','hash')").run().lastInsertRowid);
 database.db.transaction(()=>{for(let i=0;i<1000;i++){
   const session=Number(database.db.prepare("INSERT INTO sessions(user_id,week_number,date,status,completed,day_name) VALUES (?,1,'2026-10-01','completed',1,'Morning')").run(userId).lastInsertRowid);
   database.db.prepare("INSERT INTO session_sets(session_id,exercise_name,exercise_key,actual_reps,actual_weight) VALUES (?,?,?,10,40)").run(session,`Lift ${String(i).padStart(4,"0")}`,crypto.randomUUID());
   identity.attachSessionExerciseSources(database.db,userId,session);
   catalogIds.push([...identity.resolveSetExerciseIdentities(userId,session).values()][0].exerciseId);
 }})();// Deliberately larger than a screen; bounded queries must not return the collection.
});
afterAll(()=>{database?.db.close();if(dir)fs.rmSync(dir,{recursive:true,force:true});vi.unstubAllEnvs();});
it("opens a single quick exercise directly even when the workout has multiple recorded sets",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('single-quick@example.test','hash')").run().lastInsertRowid);
 const session=history.createQuickSession({userId:owner,newWorkout:true,date:"2026-10-06"}).session;
 const added=history.addQuickExercise({userId:owner,sessionId:session.id,name:"Single leg abducted DL",sets:Array.from({length:3},()=>({reps:10,weight:60}))});
 added.sets.forEach(set=>history.saveActualSet({userId:owner,sessionId:session.id,setId:set.id,actualReps:10,actualWeight:60}));
 history.finishQuickSession(owner,session.id);
 const exerciseId=identity.resolveSetExerciseIdentities(owner,session.id).get(added.sets[0].id)!.exerciseId;
 expect(queries.listProgressExercises(owner).items).toMatchObject([{key:`e:${exerciseId}`,kind:"exercise",historyCount:1,exercise:{id:exerciseId,recordedSets:3,sessionCount:1}}]);
 expect(queries.resolveUnlinkedExerciseId(owner,`u:${Buffer.from("single leg abducted dl").toString("base64url")}`)).toBe(exerciseId);
});
it("does not resolve distinct same-name identities when a date filter shows only one workout",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('single-filtered@example.test','hash')").run().lastInsertRowid);
 for(const [date,name] of [["2026-01-01","Band row"],["2026-10-06","band row"]] as const){
  const session=history.createQuickSession({userId:owner,newWorkout:true,date}).session;
  const added=history.addQuickExercise({userId:owner,sessionId:session.id,name,sets:[{reps:10,weight:10}]});
  history.saveActualSet({userId:owner,sessionId:session.id,setId:added.sets[0].id,actualReps:10,actualWeight:10});
  history.finishQuickSession(owner,session.id);
 }
 const groupKey=`u:${Buffer.from("band row").toString("base64url")}`;
 expect(queries.listProgressExercises(owner,{from:"2026-10-01",search:"band row"}).items).toMatchObject([{key:groupKey,kind:"unlinked",historyCount:1,exercise:null}]);
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey)).toBeNull();
});
it("resolves only owned recorded history without changing any saved identities",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('single-owned@example.test','hash')").run().lastInsertRowid);
 const other=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('single-unrelated@example.test','hash')").run().lastInsertRowid);
 const known=quickRecord(owner,"Lateral raise");
 quickRecord(other,"Lateral raise");quickRecord(other,"Lateral raise");
 const empty=history.createQuickSession({userId:owner,newWorkout:true,date:"2026-10-06"}).session;
 history.addQuickExercise({userId:owner,sessionId:empty.id,name:"Lateral raise",sets:[{reps:10,weight:40}]});
 history.finishQuickSession(owner,empty.id);
 const unfinished=history.createQuickSession({userId:owner,newWorkout:true,date:"2026-10-06"}).session;
 const unfinishedSets=history.addQuickExercise({userId:owner,sessionId:unfinished.id,name:"Lateral raise",sets:[{reps:10,weight:40}]});
 history.saveActualSet({userId:owner,sessionId:unfinished.id,setId:unfinishedSets.sets[0].id,actualReps:10,actualWeight:40});
 const changes=database.db.prepare("SELECT total_changes() AS count").get();
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey("lateral raise"))).toBe(known.exerciseId);
 expect(queries.resolveUnlinkedExerciseId(other,groupKey("lateral raise"))).toBeNull();
 expect(queries.resolveUnlinkedExerciseId(otherId,groupKey("lateral raise"))).toBeNull();
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey("unknown"))).toBeNull();
 expect(()=>queries.resolveUnlinkedExerciseId(owner,"e:invalid")).toThrow(/recorded-name group/);
 expect(()=>queries.resolveUnlinkedExerciseId(owner,"u:")).toThrow(/recorded-name group/);
 expect(queries.listProgressExercises(owner).items).toMatchObject([{key:`e:${known.exerciseId}`,kind:"exercise",historyCount:1}]);
 expect(database.db.prepare("SELECT total_changes() AS count").get()).toEqual(changes);
});
it("counts exercise identities rather than workouts when two same-name exercises share a session",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('single-session-distinct@example.test','hash')").run().lastInsertRowid);
 const session=history.createQuickSession({userId:owner,newWorkout:true,date:"2026-10-06"}).session;
 for(let index=0;index<2;index++){
  const added=history.addQuickExercise({userId:owner,sessionId:session.id,name:"Row",sets:[{reps:10,weight:40}]});
  history.saveActualSet({userId:owner,sessionId:session.id,setId:added.addedSetIds[0],actualReps:10,actualWeight:40});
 }
 history.finishQuickSession(owner,session.id);
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey("row"))).toBeNull();
 expect(queries.listProgressExercises(owner).items).toMatchObject([{key:groupKey("row"),kind:"unlinked",historyCount:2}]);
});
it("keeps one reused identity together before paging when its frozen recorded labels differ",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('single-reused@example.test','hash')").run().lastInsertRowid);
 const known=quickRecord(owner,"Original row");
 quickRecord(owner,"Renamed row","2026-10-06",known.exerciseId);
 quickRecord(owner,"Original row","2026-10-06",known.exerciseId);
 // Exercise origin is conservative metadata, not a count of its saved observations.
 database.db.prepare("UPDATE exercise_catalog SET origin='unlinked' WHERE id=?").run(known.exerciseId);
 const other=quickRecord(owner,"Another exercise");
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey("original row"))).toBe(known.exerciseId);
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey("renamed row"))).toBe(known.exerciseId);
 const first=queries.listProgressExercises(owner,{sort:"name",limit:1});
 const second=queries.listProgressExercises(owner,{sort:"name",limit:1,cursor:first.nextCursor!});
 expect(first.items).toMatchObject([{key:`e:${other.exerciseId}`}]);
 expect(second.items).toMatchObject([{key:`e:${known.exerciseId}`,kind:"exercise",historyCount:3,exercise:{sessionCount:3}}]);
 expect(second.nextCursor).toBeNull();
 expect(queries.listProgressExercises(owner,{sort:"name",limit:1,cursor:second.previousCursor!}).items).toEqual(first.items);
});
it("uses the same pin exclusions for singleton resolution and recorded-name candidates",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('single-pinned@example.test','hash')").run().lastInsertRowid);
 const first=quickRecord(owner,"Cable row");const second=quickRecord(owner,"Cable row");
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey("cable row"))).toBeNull();
 identity.updateExercisePin(owner,{exerciseId:first.exerciseId,pinned:true});
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey("cable row"))).toBe(second.exerciseId);
 expect(queries.listUnlinkedExercises(owner,groupKey("cable row")).items.map(row=>row.exerciseId)).toEqual([second.exerciseId]);
 expect(queries.listProgressExercises(owner).items.map(row=>row.key).sort()).toEqual([`e:${first.exerciseId}`,`e:${second.exerciseId}`].sort());
 identity.updateExercisePin(owner,{exerciseId:second.exerciseId,pinned:true});
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey("cable row"))).toBeNull();
 expect(queries.listProgressExercises(owner).items).toHaveLength(2);
});
it("keeps a sole pinned exercise reachable from its previous recorded-name URL",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('single-pinned-url@example.test','hash')").run().lastInsertRowid);
 const known=quickRecord(owner,"Single leg abducted DL");
 identity.updateExercisePin(owner,{exerciseId:known.exerciseId,pinned:true});
 expect(queries.listUnlinkedExercises(owner,groupKey("single leg abducted dl")).items).toEqual([]);
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey("single leg abducted dl"))).toBe(known.exerciseId);
});
it("keeps an existing recorded-name URL after an exercise is reused with its known identity",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('single-reused-url@example.test','hash')").run().lastInsertRowid);
 const known=quickRecord(owner,"Single leg abducted DL");
 quickRecord(owner,"Single leg abducted DL","2026-10-06",known.exerciseId);
 expect(database.db.prepare("SELECT origin FROM exercise_catalog WHERE id=?").get(known.exerciseId)).toEqual({origin:"lineage"});
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey("single leg abducted dl"))).toBe(known.exerciseId);
 expect(queries.listProgressExercises(owner).items).toMatchObject([{key:`e:${known.exerciseId}`,historyCount:2}]);
});
it("only resolves an old recorded-name URL after confirmed linking when one identity remains",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('single-confirmed-url@example.test','hash')").run().lastInsertRowid);
 quickRecord(owner,"Row");quickRecord(owner,"Row");
 const input={observationIds:queries.listUnlinkedExercises(owner,groupKey("row")).items.map(row=>row.id),name:"Row"};
 const preview=identity.previewExerciseLink(owner,input);
 const linked=identity.applyExerciseLink(owner,{...input,previewToken:preview.token,requestKey:crypto.randomUUID()});
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey("row"))).toBe(linked.targetExerciseId);
 const extra=quickRecord(owner,"Row");
 identity.updateExercisePin(owner,{exerciseId:extra.exerciseId,pinned:true});
 expect(queries.listUnlinkedExercises(owner,groupKey("row")).items).toEqual([]);
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey("row"))).toBeNull();
});
it("retains ambiguity outside a program filter or catalog-name search",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('single-program-filter@example.test','hash')").run().lastInsertRowid);
 const first=quickRecord(owner,"Row");const second=quickRecord(owner,"Row");
 const program=Number(database.db.prepare("INSERT INTO programs(user_id,name,is_active) VALUES (?,'Saved program',0)").run(owner).lastInsertRowid);
 database.db.prepare("UPDATE sessions SET program_id=? WHERE id=?").run(program,first.sessionId);
 database.db.prepare("UPDATE exercise_catalog SET name='Unique search title' WHERE id=?").run(second.exerciseId);
 expect(queries.listProgressExercises(owner,{programId:program}).items).toMatchObject([{kind:"unlinked",key:groupKey("row"),historyCount:1}]);
 expect(queries.listProgressExercises(owner,{search:"Unique search title"}).items).toMatchObject([{kind:"unlinked",key:groupKey("row"),historyCount:2}]);
 expect(queries.resolveUnlinkedExerciseId(owner,groupKey("row"))).toBeNull();
});
it("bounds home, search and alphabetical pages with 1000 exercise names",()=>{
 catalogIds.slice(0,4).forEach(exerciseId=>identity.updateExercisePin(userId,{exerciseId,pinned:true}));
 const home=queries.getProgressHome(userId,{period:"all"},new Date("2026-10-06T12:00:00Z"));
 expect(home.pinned).toHaveLength(4);expect(home.recent).toHaveLength(3);expect(home.activity.sessions).toBe(1000);
 expect(home.recent.map(row=>row.name)).toEqual(["Lift 0999","Lift 0998","Lift 0997"]);
 const first=queries.listProgressExercises(userId,{sort:"name",period:"all"});expect(first.items).toHaveLength(20);expect(first.nextCursor).not.toBeNull();
 const next=queries.listProgressExercises(userId,{sort:"name",period:"all",cursor:first.nextCursor!});expect(next.items).toHaveLength(20);
 expect(first.previousCursor).toBeNull();expect(next.previousCursor).not.toBeNull();
 expect(queries.listProgressExercises(userId,{sort:"name",cursor:next.previousCursor!}).items.map(row=>row.key)).toEqual(first.items.map(row=>row.key));
 expect(queries.listProgressExercises(userId,{sort:"name",search:"",from:"",to:"",cursor:first.nextCursor!}).items.map(row=>row.key)).toEqual(next.items.map(row=>row.key));
 expect(new Set([...first.items,...next.items].map(row=>row.key)).size).toBe(40);
 const found=queries.listProgressExercises(userId,{search:"Lift 0999",period:"all"});expect(found.items).toHaveLength(1);expect(found.items[0].name).toBe("Lift 0999");
 expect(()=>queries.listProgressExercises(userId,{search:"Different",cursor:first.nextCursor!})).toThrow(/cursor|filter/i);
 expect(queries.listProgressExercises(otherId,{sort:"name"}).items).toEqual([]);
});
it("groups unlinked labels for discovery only and returns exact observation candidates",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('group-owner@example.test','hash')").run().lastInsertRowid);
 for(let i=0;i<25;i++) {const session=history.createQuickSession({userId:owner,newWorkout:true,date:"2026-10-01"}).session;
 const added=history.addQuickExercise({userId:owner,sessionId:session.id,name:i%2?"Same label":"same label",sets:[{reps:10,weight:0}]});
 history.saveActualSet({userId:owner,sessionId:session.id,setId:added.sets[0].id,actualReps:10,actualWeight:0});history.finishQuickSession(owner,session.id);}
 const rows=queries.listProgressExercises(owner,{search:"same label"}).items;expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({kind:"unlinked",historyCount:25,exercise:null});
 const candidates=queries.listUnlinkedExercises(owner,rows[0].key,{});expect(candidates.items).toHaveLength(20);expect(candidates.items[0].latest?.weight).toBe(0);
 expect(queries.listUnlinkedExercises(owner,rows[0].key,{cursor:candidates.nextCursor!}).items).toHaveLength(5);
 identity.updateExercisePin(owner,{exerciseId:candidates.items[0].exerciseId,pinned:true});
 const remaining=queries.listProgressExercises(owner,{search:"same label"}).items.find(row=>row.kind==="unlinked")!;
 expect(remaining.historyCount).toBe(24);
 expect(queries.listUnlinkedExercises(owner,remaining.key).items.some(row=>row.id===candidates.items[0].id)).toBe(false);
});
it("retains distinct same-day sessions, missing load and zero-load attempts after explicit linking",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('detail-owner@example.test','hash')").run().lastInsertRowid);
 const ids:number[]=[];for(const weight of [0,null,40] as const){const session=history.createQuickSession({userId:owner,newWorkout:true,date:"2026-10-02",unit:"kg"}).session;
 const added=history.addQuickExercise({userId:owner,sessionId:session.id,name:"Prehab row",sets:[{reps:10,weight:0}]});ids.push(added.sets[0].id);
 history.saveActualSet({userId:owner,sessionId:session.id,setId:added.sets[0].id,actualReps:10,actualWeight:weight});history.finishQuickSession(owner,session.id);}
 const input={observationIds:ids,name:"Prehab row"};const preview=identity.previewExerciseLink(owner,input);const linked=identity.applyExerciseLink(owner,{...input,previewToken:preview.token,requestKey:crypto.randomUUID()});
 const detail=queries.getExerciseDetail(owner,linked.targetExerciseId!,{period:"all"})!;
 expect(detail.totals.sessions).toBe(3);expect(detail.observations.items).toHaveLength(3);expect(detail.totals.missingWeightSets).toBe(1);
 expect(detail.observations.items.map(row=>row.topWeight)).toEqual([40,null,0]);
 expect(detail.observations.items.at(-1)?.bestE1rm).toBeNull();expect(detail.chart.points).toHaveLength(3);
 expect(queries.getExerciseDetail(userId,linked.targetExerciseId!,{})).toBeNull();
 const filtered=queries.getExerciseDetail(owner,linked.targetExerciseId!,{from:"2026-10-03",to:"2026-10-04"})!;expect(filtered.observations.items).toEqual([]);
 const home=queries.getProgressHome(owner,{period:"all"});expect(home.activity.volumeLb).toBeCloseTo(400*2.2046226218487757);expect(home.activity.usesKilograms).toBe(true);
});
it("bounds long exercise history and chart data without collapsing workouts",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('long-detail@example.test','hash')").run().lastInsertRowid);
 const sessionIds:number[]=[];let exerciseId="";
 database.db.transaction(()=>{for(let index=0;index<125;index++){
  const id=Number(database.db.prepare("INSERT INTO sessions(user_id,week_number,date,status,completed,day_name) VALUES (?,1,'2026-10-01','completed',1,'Saved day')").run(owner).lastInsertRowid);sessionIds.push(id);
  database.db.prepare("INSERT INTO session_sets(session_id,exercise_name,actual_reps,actual_weight,sets,editor_json) VALUES (?,'Row',10,40,3,?)").run(id,JSON.stringify({exerciseId:"authored-row",set:{loadMode:"working",role:"work"}}));
  database.db.prepare("INSERT INTO session_sets(session_id,exercise_name,reps,calculated_weight,editor_json) VALUES (?,'Row',10,40,?)").run(id,JSON.stringify({exerciseId:"authored-row",set:{loadMode:"working",role:"work"}}));
  identity.attachSessionExerciseSources(database.db,owner,id);exerciseId=[...identity.resolveSetExerciseIdentities(owner,id).values()][0].exerciseId;
 }})();
 const first=queries.getExerciseDetail(owner,exerciseId)!;
 expect(first.totals).toMatchObject({sessions:125,recordedSets:375,reps:3750,volumeLb:150000});
 expect(first.observations.items).toHaveLength(20);expect(first.chart.points).toHaveLength(120);expect(first.chart.truncated).toBe(true);expect(first.chart.totalObservations).toBe(125);
 expect(first.chart.points[0].sessionId).toBe(sessionIds[5]);expect(first.chart.points.at(-1)?.sessionId).toBe(sessionIds.at(-1));
 const next=queries.getExerciseDetail(owner,exerciseId,{cursor:first.observations.nextCursor!})!;
 expect(next.observations.items).toHaveLength(20);expect(new Set([...first.observations.items,...next.observations.items].map(row=>row.sessionId)).size).toBe(40);
 expect(queries.getExerciseDetail(owner,exerciseId,{cursor:next.observations.previousCursor!})?.observations.items).toEqual(first.observations.items);
 expect(queries.getProgressHistory(owner).items).toHaveLength(20);
 expect(queries.getProgressHistory(owner,{from:"2026-10-02"}).items).toEqual([]);
 expect(queries.getProgressHistory(owner,{search:"Row"}).items[0]).toMatchObject({loggedSets:3,totalSets:4,volume:1200});
});
it("bounds archived program and routine browsing while retaining frozen history labels",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('browse-owner@example.test','hash')").run().lastInsertRowid);
 for(let index=0;index<11;index++){
  const program=Number(database.db.prepare("INSERT INTO programs(user_id,name,archived_at,is_active) VALUES (?,'Renamed now','2026-10-02',0)").run(owner).lastInsertRowid);
  database.db.prepare("INSERT INTO sessions(user_id,program_id,week_number,date,status,completed,program_name,day_name) VALUES (?,?,1,'2026-10-01','completed',1,?,'Frozen day')").run(owner,program,`Frozen program ${index}`);
 }
 const first=queries.listProgressPrograms(owner);expect(first.items).toHaveLength(10);
 expect(queries.listProgressPrograms(owner,{cursor:first.nextCursor!}).items).toHaveLength(1);
 expect(first.items[0].name).toBe("Frozen program 10");
 const orphan=Number(database.db.prepare("INSERT INTO sessions(user_id,week_number,date,status,completed,program_name,day_name) VALUES (?,1,'2026-10-02','completed',1,'Deleted source','Frozen day')").run(owner).lastInsertRowid);
 expect(queries.getProgressHistory(owner).items[0].name).toBe("Deleted source · Frozen day");
 expect(history.getWorkout(owner,orphan)?.name).toBe("Deleted source · Frozen day");
 expect(queries.listProgressPrograms(owner).items.find(row=>row.id===0)?.name).toBe("Other saved workouts");
 for(let index=0;index<21;index++)database.db.prepare("INSERT INTO workout_routines(user_id,name,unit,prescription_json) VALUES (?,?,'lb','[]')").run(owner,`Routine ${index}`);
 const routines=queries.listProgressRoutines(owner);expect(routines.items).toHaveLength(20);
 expect(queries.listProgressRoutines(owner,{cursor:routines.nextCursor!}).items).toHaveLength(1);
 expect(queries.listProgressRoutines(otherId).items).toEqual([]);
});
it("uses equivalent empty date filters and separates empty finishes from recorded training",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('period-owner@example.test','hash')").run().lastInsertRowid);
 for(const [date,actual] of [["2026-10-01",true],["2026-10-01",false],["2026-10-20",true]] as const){
  const session=history.createQuickSession({userId:owner,newWorkout:true,date}).session;
  const added=history.addQuickExercise({userId:owner,sessionId:session.id,name:"Band row",sets:[{reps:10,weight:40}]});
  if(actual)history.saveActualSet({userId:owner,sessionId:session.id,setId:added.sets[0].id,actualReps:10,actualWeight:40});
  history.finishQuickSession(owner,session.id);
 }
 const now=new Date("2026-10-06T12:00:00Z");const normal=queries.getProgressHome(owner,{period:"all"},now);
 expect(normal.activity).toMatchObject({sessions:1,emptySessions:1,recordedSets:1,volumeLb:400});
 expect(queries.getProgressHome(owner,{period:"all",from:"",to:""},now).activity).toEqual(normal.activity);
});
it("charts the heaviest successful set with original units, zero and missing load intact",()=>{
 const owner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('graph-metrics@example.test','hash')").run().lastInsertRowid);
 let exerciseId="";const expected:[number|null,number|null][]=[[null,null],[0,null],[40,40*(1+10/30)]];
 for(const [reps,weight] of [[0,100],[10,0],[10,40]] as const){
  const session=history.createQuickSession({userId:owner,newWorkout:true,date:"2026-10-01",unit:"kg"}).session;
  const added=history.addQuickExercise({userId:owner,sessionId:session.id,name:"Cable row",catalogExerciseId:exerciseId||undefined,sets:[{reps:10,weight:40},{reps:10,weight:100},{reps:10,weight:0}]});
  exerciseId=identity.resolveSetExerciseIdentities(owner,session.id).get(added.sets[0].id)!.exerciseId;
  history.saveActualSet({userId:owner,sessionId:session.id,setId:added.sets[0].id,actualReps:reps,actualWeight:weight});
  history.saveActualSet({userId:owner,sessionId:session.id,setId:added.sets[1].id,actualReps:0,actualWeight:200});
  history.saveActualSet({userId:owner,sessionId:session.id,setId:added.sets[2].id,actualReps:8,actualWeight:null});
  history.finishQuickSession(owner,session.id);
 }
 const detail=queries.getExerciseDetail(owner,exerciseId,{period:"all",limit:2})!;
 expect(detail.observations.items).toHaveLength(2);expect(detail.observations.nextCursor).not.toBeNull();
 expect(detail.chart.points.map(point=>[point.topWeight,point.bestE1rm])).toEqual(expected);
 expect(detail.chart.points.every(point=>point.unit==="kg")).toBe(true);
 expect(detail.chart.points.map(point=>point.totalReps)).toEqual([8,18,18]);
});
it("keeps graph chooser reads bounded at 200 and 1000 exercise names",()=>{
 const smallOwner=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('cost-owner@example.test','hash')").run().lastInsertRowid);
 database.db.transaction(()=>{for(let i=0;i<200;i++){
  const id=Number(database.db.prepare("INSERT INTO sessions(user_id,week_number,date,status,completed) VALUES (?,1,'2026-10-01','completed',1)").run(smallOwner).lastInsertRowid);
  database.db.prepare("INSERT INTO session_sets(session_id,exercise_name,exercise_key,actual_reps,actual_weight) VALUES (?,?,?,10,40)").run(id,`Lift ${String(i).padStart(4,"0")}`,crypto.randomUUID());
  identity.attachSessionExerciseSources(database.db,smallOwner,id);
 }})();
 const timing:{exerciseNames:number;query:string;medianMs:number;maxMs:number}[]=[];
 for(const [owner,size] of [[smallOwner,200],[userId,1000]]){
  const catalogs=database.db.prepare("SELECT id FROM exercise_catalog WHERE user_id=? ORDER BY name").all(owner) as {id:string}[];
  catalogs.slice(0,4).forEach(row=>identity.updateExercisePin(owner,{exerciseId:row.id,pinned:true}));
  const home=()=>queries.getProgressHome(owner,{period:"all"},new Date("2026-10-06T12:00:00Z"));
  const finder=()=>queries.listProgressExercises(owner,{sort:"name"});
  const search=()=>queries.listProgressExercises(owner,{search:`Lift ${String(size-1).padStart(4,"0")}`});
  const detail=()=>queries.getExerciseDetail(owner,catalogs.at(-1)!.id,{limit:2});
  expect(home().pinned).toHaveLength(4);expect(home().recent).toHaveLength(3);expect(finder().items).toHaveLength(20);expect(search().items).toHaveLength(1);
  expect(detail()!.observations.items.length).toBeLessThanOrEqual(2);expect(detail()!.chart.points.length).toBeLessThanOrEqual(120);
  for(const [query,run] of [["home",home],["finder",finder],["exact-search",search],["selected-detail",detail]] as const){
   const samples=Array.from({length:7},()=>{const start=performance.now();run();return performance.now()-start;}).sort((a,b)=>a-b);
   timing.push({exerciseNames:size,query,medianMs:Number(samples[3].toFixed(2)),maxMs:Number(samples[6].toFixed(2))});
  }
 }
 // Informational measurements only: runtime scheduling is not a correctness assertion.
 if(process.env.MAGNI_PROGRESS_QUERY_TIMINGS==="1")console.info("Progress query timings (local disposable SQLite, warmed reads):",JSON.stringify(timing));
});
