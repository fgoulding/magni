import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { blockExerciseAliases, exerciseAliasStates, restoreExerciseAliases, resolveCatalogRedirect, type ExerciseAliasState } from "./aliases";
import type { CandidateObservation, IdentityChangeInput, IdentityChangePreview, IdentityChangeResult } from "./types";
export { PROGRESS_SET_JOINS, attachSessionExerciseSources } from "./source-links";

export class ProgressError extends Error { constructor(public status: number, message: string) { super(message); this.name="ProgressError"; } }
function fail(message:string,status=400):never {throw new ProgressError(status,message);}
export function resolveSetExerciseIdentities(userId:number,sessionId:number):Map<number,{exerciseId:string;sourceKey:string;name:string}> {
  const rows=db.prepare(`SELECT x.session_set_id AS id,x.exercise_id AS exerciseId,x.source_key AS sourceKey,c.name
    FROM exercise_set_sources x JOIN session_sets ss ON ss.id=x.session_set_id JOIN sessions s ON s.id=ss.session_id
    JOIN exercise_catalog c ON c.id=x.exercise_id AND c.user_id=x.user_id WHERE s.user_id=? AND s.id=? AND x.user_id=s.user_id`).all(userId,sessionId) as {id:number;exerciseId:string;sourceKey:string;name:string}[];
  return new Map(rows.map(({id,...row})=>[id,row]));
}
export function requireOwnedExercise(userId:number,id:string):{id:string;name:string;origin:string;revision:number} {
  if(typeof id!=="string"||id.length>100) fail("Exercise not found.",404);
  id=resolveCatalogRedirect(db,userId,id);
  return db.prepare("SELECT id,name,origin,revision FROM exercise_catalog WHERE id=? AND user_id=?").get(id,userId) as {id:string;name:string;origin:string;revision:number}|undefined ?? fail("Exercise not found.",404);
}
export const CANDIDATE_CTE = `WITH candidates AS (
  SELECT MIN(ss.id) AS id,s.id AS sessionId,s.date,s.unit,
    MIN(ss.exercise_name) AS recordedName,COALESCE(NULLIF(s.day_name,''),'Quick Workout') AS workoutName,s.program_name AS programName,
    s.program_id AS programId,MIN(x.exercise_id) AS exerciseId,MIN(c.name) AS exerciseName,
    MAX(x.revision) AS revision,s.revision AS sessionRevision,x.observation_key AS observationKey,
    SUM(CASE WHEN ss.actual_reps IS NOT NULL THEN MAX(ss.sets,1) ELSE 0 END) AS recordedSets
  FROM sessions s JOIN session_sets ss ON ss.session_id=s.id
  JOIN exercise_set_sources x ON x.session_set_id=ss.id AND x.user_id=s.user_id
  JOIN exercise_catalog c ON c.id=x.exercise_id AND c.user_id=s.user_id
  WHERE s.user_id=? AND s.status='completed'
  GROUP BY s.id,x.observation_key
)`;
type CandidateRow=Omit<CandidateObservation,"latest">&{unit:"lb"|"kg";sessionRevision:number;observationKey:string;programId:number|null};
export function decorateCandidate(row:CandidateRow):CandidateObservation {
  const set=db.prepare(`SELECT ss.id,ss.actual_reps AS reps,ss.actual_weight AS weight FROM session_sets ss
    JOIN exercise_set_sources x ON x.session_set_id=ss.id WHERE ss.session_id=? AND x.observation_key=? AND ss.actual_reps IS NOT NULL
    ORDER BY ss.sort_order,ss.set_number,ss.id LIMIT 1`).get(row.sessionId,row.observationKey) as {id:number;reps:number;weight:number|null}|undefined;
  return {id:row.id,sessionId:row.sessionId,date:row.date,recordedName:row.recordedName,workoutName:row.workoutName,programName:row.programName,
    exerciseId:row.exerciseId,exerciseName:row.exerciseName,revision:row.revision,recordedSets:row.recordedSets,
    latest:set?{sessionId:row.sessionId,date:row.date,setId:set.id,reps:set.reps,weight:set.weight,unit:row.unit}:null};
}
function selected(userId:number,ids:unknown):CandidateRow[] {
  if(!Array.isArray(ids)||ids.length<1||ids.length>200||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length) fail("Choose between 1 and 200 distinct workout records.");
  const rows=db.prepare(`${CANDIDATE_CTE} SELECT * FROM candidates WHERE id IN (${ids.map(()=>"?").join(",")}) ORDER BY id`).all(userId,...ids) as CandidateRow[];
  if(rows.length!==ids.length) fail("A selected workout record was not found.",404);
  return rows;
}
type LinkState={setId:number;exerciseId:string;revision:number};
type CatalogState={id:string;origin:string;revision:number};
type AuditState={sets:LinkState[];catalogs:CatalogState[];aliases?:ExerciseAliasState[]};
function auditState(json:string):AuditState {
  const value=JSON.parse(json) as AuditState|LinkState[];
  return Array.isArray(value)?{sets:value,catalogs:[]}:value;
}
function catalogState(userId:number,id:string):CatalogState {
  const {origin,revision}=requireOwnedExercise(userId,id);
  return {id,origin,revision};
}
function mappings(userId:number,rows:CandidateRow[]):LinkState[] {
  const result:LinkState[]=[];
  for(const row of rows) result.push(...db.prepare(`SELECT x.session_set_id AS setId,x.exercise_id AS exerciseId,x.revision
    FROM exercise_set_sources x JOIN session_sets ss ON ss.id=x.session_set_id WHERE x.user_id=? AND ss.session_id=? AND x.observation_key=? ORDER BY ss.id`).all(userId,row.sessionId,row.observationKey) as LinkState[]);
  return result.sort((a,b)=>a.setId-b.setId);
}
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function prepare(userId:number,input:IdentityChangeInput) {
  if(!input||typeof input!=="object") fail("Choose workout records.");
  if(input.mode!==undefined&&input.mode!=="link"&&input.mode!=="detach") fail("Choose link or detach.");
  const rows=selected(userId,input.observationIds);
  const target=input.mode==="detach"?null:input.targetExerciseId?requireOwnedExercise(userId,input.targetExerciseId):null;
  const name=input.mode==="detach"?"Separate selected workouts":target?.name??(typeof input.name==="string"?input.name.trim():"");
  if(!name||name.length>140) fail("Enter an exercise name from 1 to 140 characters.");
  const before=mappings(userId,rows);
  const aliases=exerciseAliasStates(db,userId,{exerciseIds:[...new Set(before.map(row=>row.exerciseId))]});
  const token=hash([userId,input.mode??"link",target,name,rows,before,aliases]);
  return {rows,target,name,before,aliases,token};
}
export function previewExerciseLink(userId:number,input:IdentityChangeInput):IdentityChangePreview {
  const p=prepare(userId,input);
  return {token:p.token,targetExerciseId:p.target?.id??null,targetName:p.name,observations:p.rows.map(decorateCandidate),observationCount:p.rows.length,
    sessionCount:new Set(p.rows.map(row=>row.sessionId)).size,explanation:"Only selected workouts change grouping. Recorded sets and program progression stay unchanged. Choose the saved exercise when adding future workouts to keep the history you want."};
}
function requestKey(key:unknown):asserts key is string { if(typeof key!=="string"||key.length<8||key.length>120) fail("Use a valid retry key."); }
function prior(userId:number,key:string,request:string):IdentityChangeResult|null {
  const row=db.prepare("SELECT request_json,result_json FROM exercise_identity_changes WHERE user_id=? AND request_key=?").get(userId,key) as {request_json:string;result_json:string}|undefined;
  if(!row) return null;
  if(row.request_json!==request) fail("This retry key belongs to another change.",409);
  return JSON.parse(row.result_json);
}
function record(userId:number,key:string,request:string,before:AuditState,after:AuditState,result:Omit<IdentityChangeResult,"changeId">):IdentityChangeResult {
  const id=Number(db.prepare("INSERT INTO exercise_identity_changes(user_id,request_key,request_json,before_json,after_json,result_json) VALUES (?,?,?,?,?,'{}')").run(userId,key,request,JSON.stringify(before),JSON.stringify(after)).lastInsertRowid);
  const saved={...result,changeId:id};
  db.prepare("UPDATE exercise_identity_changes SET result_json=? WHERE id=?").run(JSON.stringify(saved),id);
  return saved;
}
export function applyExerciseLink(userId:number,input:IdentityChangeInput&{previewToken:string;requestKey:string}):IdentityChangeResult {
  requestKey(input.requestKey);
  if(!Array.isArray(input.observationIds)||input.observationIds.length<1||input.observationIds.length>200||input.observationIds.some(id=>!Number.isSafeInteger(id)||id<1))fail("Choose between 1 and 200 distinct workout records.");
  const request=JSON.stringify({action:"apply",...input,observationIds:[...input.observationIds].sort((a,b)=>a-b)});
  return db.transaction(()=>{
    const cached=prior(userId,input.requestKey,request); if(cached) return cached;
    const p=prepare(userId,input); if(input.previewToken!==p.token) fail("These workout records changed. Review a fresh preview.",409);
    const targetId=input.mode==="detach"?null:p.target?.id??randomUUID();
    blockExerciseAliases(db,userId,[...new Set(p.before.map(row=>row.exerciseId))]);
    const beforeCatalogs=p.target?[catalogState(userId,p.target.id)]:[];
    if(targetId&&!p.target) db.prepare("INSERT INTO exercise_catalog(id,user_id,name,origin) VALUES (?,?,?,'confirmed')").run(targetId,userId,p.name);
    if(targetId) db.prepare("UPDATE exercise_catalog SET origin='confirmed',revision=revision+1 WHERE id=? AND user_id=?").run(targetId,userId);
    for(const row of p.rows) {
      const id=targetId??randomUUID();
      if(!targetId) db.prepare("INSERT INTO exercise_catalog(id,user_id,name,origin) VALUES (?,?,?,'unlinked')").run(id,userId,row.recordedName);
      db.prepare(`UPDATE exercise_set_sources SET exercise_id=?,revision=revision+1 WHERE user_id=? AND observation_key=?
        AND session_set_id IN (SELECT id FROM session_sets WHERE session_id=?)`).run(id,userId,row.observationKey,row.sessionId);
    }
    return record(userId,input.requestKey,request,{sets:p.before,catalogs:beforeCatalogs,aliases:p.aliases},
      {sets:mappings(userId,p.rows),catalogs:p.target?[catalogState(userId,p.target.id)]:[],aliases:exerciseAliasStates(db,userId,{aliases:p.aliases})},
      {targetExerciseId:targetId,observationCount:p.rows.length,undone:false});
  }).immediate();
}
export function undoExerciseLink(userId:number,input:{changeId:number;requestKey:string}):IdentityChangeResult {
  requestKey(input.requestKey);
  if(!Number.isSafeInteger(input.changeId)||input.changeId<1) fail("Change not found.",404);
  const request=JSON.stringify({action:"undo",changeId:input.changeId});
  return db.transaction(()=>{
    const cached=prior(userId,input.requestKey,request); if(cached) return cached;
    const change=db.prepare("SELECT before_json,after_json,result_json FROM exercise_identity_changes WHERE user_id=? AND id=?").get(userId,input.changeId) as {before_json:string;after_json:string;result_json:string}|undefined;
    if(!change) fail("Change not found.",404);
    const before=auditState(change.before_json); const after=auditState(change.after_json);
    for(const row of after.sets) {
      const current=db.prepare("SELECT exercise_id AS exerciseId,revision FROM exercise_set_sources WHERE session_set_id=? AND user_id=?").get(row.setId,userId) as {exerciseId:string;revision:number}|undefined;
      if(!current||current.exerciseId!==row.exerciseId||current.revision!==row.revision) fail("This grouping changed again. Review included workouts before editing.",409);
    }
    for(const row of after.catalogs) {
      const current=catalogState(userId,row.id);
      if(current.origin!==row.origin||current.revision!==row.revision)fail("This exercise grouping changed again. Review included workouts before editing.",409);
    }
    if(after.aliases&&hash(exerciseAliasStates(db,userId,{aliases:after.aliases}))!==hash(after.aliases)) fail("This exercise matching changed again. Review included workouts before editing.",409);
    const restored:LinkState[]=[];
    for(const row of before.sets) {
      const last=after.sets.find(item=>item.setId===row.setId)!;
      db.prepare("UPDATE exercise_set_sources SET exercise_id=?,revision=revision+1 WHERE session_set_id=? AND user_id=?").run(row.exerciseId,row.setId,userId);
      restored.push({...row,revision:last.revision+1});
    }
    const restoredCatalogs:CatalogState[]=[];
    for(const row of before.catalogs) {
      db.prepare("UPDATE exercise_catalog SET origin=?,revision=revision+1 WHERE id=? AND user_id=?").run(row.origin,row.id,userId);
      restoredCatalogs.push(catalogState(userId,row.id));
    }
    if(before.aliases) restoreExerciseAliases(db,userId,before.aliases);
    const restoredAliases=before.aliases?exerciseAliasStates(db,userId,{aliases:before.aliases}):undefined;
    return record(userId,input.requestKey,request,after,{sets:restored,catalogs:restoredCatalogs,aliases:restoredAliases},{targetExerciseId:null,observationCount:(JSON.parse(change.result_json) as IdentityChangeResult).observationCount,undone:true});
  }).immediate();
}
const PIN_KEY="progress_pins_v1";
export function getPinnedExerciseIds(userId:number):string[] {
  const saved=db.prepare("SELECT value FROM user_settings WHERE user_id=? AND key=?").get(userId,PIN_KEY) as {value:string}|undefined;
  let ids:unknown;try{ids=JSON.parse(saved?.value??"[]");}catch{return [];}
  if(!Array.isArray(ids))return [];
  return [...new Set(ids.filter((id):id is string=>typeof id==="string").map(id=>resolveCatalogRedirect(db,userId,id)))].filter(id=>!!db.prepare("SELECT id FROM exercise_catalog WHERE user_id=? AND id=?").get(userId,id)).slice(0,4);
}
export function updateExercisePin(userId:number,input:{exerciseId:string;pinned:boolean;replaceExerciseId?:string}):string[] {
  if(typeof input.pinned!=="boolean")fail("Choose pin or unpin.");
  return db.transaction(()=>{
    input={...input,exerciseId:requireOwnedExercise(userId,input.exerciseId).id,replaceExerciseId:input.replaceExerciseId?requireOwnedExercise(userId,input.replaceExerciseId).id:undefined};
    let ids=getPinnedExerciseIds(userId);
    if(!input.pinned) ids=ids.filter(id=>id!==input.exerciseId);
    else if(!ids.includes(input.exerciseId)) {
      if(input.replaceExerciseId) {
        const position=ids.indexOf(input.replaceExerciseId);if(position<0)fail("The selected pin changed. Choose a current pin to replace.",409);
        ids[position]=input.exerciseId;
      } else {if(ids.length>=4)fail("You can pin four exercises. Choose a pin to replace.",409);ids.push(input.exerciseId);}
    }
    db.prepare("INSERT INTO user_settings(user_id,key,value) VALUES (?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value").run(userId,PIN_KEY,JSON.stringify(ids));
    return ids;
  }).immediate();
}
