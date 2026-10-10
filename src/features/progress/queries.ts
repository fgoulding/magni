import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { exerciseNameKey, resolveCatalogRedirect } from "./aliases";
import { userDateKey } from "@/lib/user-date";
import { CANDIDATE_CTE, decorateCandidate, getPinnedExerciseIds, ProgressError, PROGRESS_SET_JOINS } from "./identity";
import type { CandidateObservation, ExerciseChartPoint, ExerciseDetail, ExerciseFinderItem, ExerciseMetricEvidence, ExerciseMetricSummary, ExerciseObservation, ExerciseSummary, ExerciseTraining, ProgressFilters, ProgressHome, ProgressPrimaryExercise, ProgressPage, ProgressPerformance, ProgressProgram, ProgressRoutine, ProgressWorkout } from "./types";

type Value=string|number|null;
const KG_TO_LB=2.2046226218487757;
const invalid=(message:string):never=>{throw new ProgressError(400,message);};
function date(value:string|undefined):string|null {
  if(value===undefined||value==="")return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))invalid("Use a valid date filter.");
  const parsed=new Date(`${value}T12:00:00Z`);
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)invalid("Use a valid date filter.");
  return value;
}
function shift(value:string,days:number):string {const d=new Date(`${value}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function range(userId:number,filters:ProgressFilters,now=new Date()) {
  if(filters.period!==undefined&&!['4w','12w','all'].includes(filters.period))invalid("Choose a supported period.");
  const to=date(filters.to)??(filters.period&&filters.period!=="all"?userDateKey(userId,now):null);
  const from=date(filters.from)??(filters.period&&filters.period!=="all"?shift(to!,filters.period==="4w"?-27:-83):null);
  if(from&&to&&from>to)invalid("The start date must not be after the end date.");
  if(filters.programId!==undefined&&(!Number.isSafeInteger(filters.programId)||filters.programId<0))invalid("Choose a valid program.");
  if(filters.search!==undefined&&(typeof filters.search!=="string"||filters.search.length>140))invalid("Keep searches within 140 characters.");
  if(filters.initial!==undefined&&(typeof filters.initial!=="string"||[...filters.initial].length>1))invalid("Choose one initial letter.");
  if(filters.sort!==undefined&&filters.sort!=="recent"&&filters.sort!=="name")invalid("Choose a valid ordering.");
  return {from,to};
}
function constraints(userId:number,filters:ProgressFilters,now?:Date) {
  const period=range(userId,filters,now);const clauses=["s.user_id=?"];const args:Value[]=[userId];
  if(period.from){clauses.push("s.date>=?");args.push(period.from);}if(period.to){clauses.push("s.date<=?");args.push(period.to);}
  if(filters.programId!==undefined){clauses.push(filters.programId===0?"s.program_id IS NULL":"s.program_id=?");if(filters.programId!==0)args.push(filters.programId);}
  return {where:clauses.join(" AND "),args,...period};
}
function pagination(userId:number,kind:string,filters:ProgressFilters,cap=20) {
  const limit=Math.min(cap,Math.max(1,Number.isSafeInteger(filters.limit)?filters.limit!:cap));
  const normalized=Object.fromEntries(Object.entries({...filters,search:filters.search?.trim().toLowerCase(),initial:filters.initial?.toLowerCase(),cursor:undefined,limit})
    .filter(([key,value])=>value!==undefined&&value!==""&&!(key==="period"&&value==="all")&&!(key==="sort"&&value==="recent")&&!(key==="status"&&value==="all")));
  const signature=createHash("sha256").update(JSON.stringify([userId,kind,Object.fromEntries(Object.entries(normalized).sort(([a],[b])=>a.localeCompare(b)))])).digest("hex").slice(0,24);
  let offset=0;
  if(filters.cursor){try{if(filters.cursor.length>500)throw new Error();const parsed=JSON.parse(Buffer.from(filters.cursor,"base64url").toString("utf8"));
    if(parsed.signature!==signature||!Number.isSafeInteger(parsed.offset)||parsed.offset<0||parsed.offset>1_000_000)throw new Error();offset=parsed.offset;
  }catch{invalid("This cursor does not match the current filters. Start from the first page.");}}
  const cursor=(position:number)=>Buffer.from(JSON.stringify({signature,offset:position})).toString("base64url");
  return {limit,offset,previous:offset>0?cursor(Math.max(0,offset-limit)):null,next:(hasMore:boolean)=>hasMore?cursor(offset+limit):null};
}
function base(userId:number,filters:ProgressFilters,now?:Date) {
  const c=constraints(userId,filters,now);
  return {...c,sql:`SELECT ss.id AS setId,s.id AS sessionId,s.date,s.unit,s.day_name AS workoutName,s.program_name AS programName,s.program_id AS programId,
    ss.exercise_name AS recordedName,pc.id AS exerciseId,pc.name AS catalogName,pc.origin,pes.observation_key AS observationKey,
    ss.actual_reps AS reps,ss.actual_weight AS weight,ss.actual_weight*CASE WHEN s.unit='kg' THEN ${KG_TO_LB} ELSE 1 END AS weightLb,
    MAX(ss.sets,1) AS multiplicity,ss.sort_order AS sortOrder,ss.set_number AS setNumber,
    CASE WHEN json_valid(ss.editor_json) THEN json_extract(ss.editor_json,'$.set.role') END AS role,
    CASE WHEN json_valid(ss.editor_json) THEN json_extract(ss.editor_json,'$.set.loadMode') END AS loadMode
    FROM sessions s JOIN session_sets ss ON ss.session_id=s.id ${PROGRESS_SET_JOINS}
    WHERE ${c.where} AND s.status='completed' AND ss.actual_reps IS NOT NULL AND pc.id IS NOT NULL`};
}
type BaseRow={setId:number;sessionId:number;date:string;unit:"lb"|"kg";workoutName:string;programName:string;programId:number|null;recordedName:string;exerciseId:string;catalogName:string;origin:ExerciseSummary["origin"];observationKey:string;reps:number;weight:number|null;weightLb:number|null;multiplicity:number;sortOrder:number;setNumber:number;role:string|null;loadMode:string|null};
function performance(row:BaseRow|undefined):ProgressPerformance|null {return row?{sessionId:row.sessionId,date:row.date,setId:row.setId,reps:row.reps,weight:row.weight,unit:row.unit}:null;}
function summary(userId:number,id:string,filters:ProgressFilters={}):ExerciseSummary|null {
  id=resolveCatalogRedirect(db,userId,id);
  const catalog=db.prepare("SELECT id,name,origin FROM exercise_catalog WHERE id=? AND user_id=?").get(id,userId) as Pick<ExerciseSummary,"id"|"name"|"origin">|undefined;if(!catalog)return null;
  const b=base(userId,filters);
  const totals=db.prepare(`WITH b AS (${b.sql}) SELECT COUNT(DISTINCT sessionId) AS sessionCount,COALESCE(SUM(multiplicity),0) AS recordedSets,COALESCE(MAX(date),'') AS lastDate FROM b WHERE exerciseId=?`).get(...b.args,id) as Pick<ExerciseSummary,"sessionCount"|"recordedSets"|"lastDate">;
  const latest=db.prepare(`WITH b AS (${b.sql}) SELECT * FROM b WHERE exerciseId=? ORDER BY date DESC,sessionId DESC,sortOrder,setNumber,setId LIMIT 1`).get(...b.args,id) as BaseRow|undefined;
  return {...catalog,...totals,latest:performance(latest),pinned:getPinnedExerciseIds(userId).includes(id)};
}
function decodeGroup(key:string):string {
  if(typeof key!=="string"||!key.startsWith("u:")||key.length>800)invalid("Choose a valid recorded-name group.");
  const value=Buffer.from(key.slice(2),"base64url").toString("utf8");if(!value||value.length>140||`u:${Buffer.from(value).toString("base64url")}`!==key)invalid("Choose a valid recorded-name group.");return value;
}
/** Resolve existing identity only; equal names never establish a new link. */
export function resolveUnlinkedExerciseId(userId:number,groupKey:string):string|null {
  const name=decodeGroup(groupKey);const b=base(userId,{});
  const rows=db.prepare(`WITH b AS (${b.sql}) SELECT DISTINCT exerciseId FROM b
    WHERE origin='unlinked' AND lower(trim(recordedName))=? LIMIT 2`).all(...b.args,name) as {exerciseId:string}[];
  if(rows.length)return rows.length===1?rows[0].exerciseId:null;
  // Old recorded-name URLs remain useful after pinning, reusing or explicitly linking
  // their sole identity. Do not choose between multiple identities removed from a group.
  const existing=db.prepare(`WITH b AS (${b.sql}) SELECT DISTINCT exerciseId FROM b
    WHERE lower(trim(recordedName))=? LIMIT 2`).all(...b.args,name) as {exerciseId:string}[];
  return existing.length===1?existing[0].exerciseId:null;
}
export function listProgressExercises(userId:number,filters:ProgressFilters={}):ProgressPage<ExerciseFinderItem> {
  const b=base(userId,filters);const all=base(userId,{});const p=pagination(userId,"exercises",filters);
  const q=(filters.search??"").trim().toLowerCase();const initial=(filters.initial??"").toLowerCase();
  // Identity ambiguity belongs to the whole recorded history, not the current date/search page.
  // Key before grouping/pagination so one existing identity with multiple labels stays one row.
  const grouped=`WITH all_records AS (${all.sql}), ambiguous_names AS (
      SELECT lower(trim(recordedName)) AS name FROM all_records WHERE origin='unlinked'
      GROUP BY lower(trim(recordedName)) HAVING COUNT(DISTINCT exerciseId)>1),
    b AS (${b.sql}), keyed AS (SELECT *,CASE WHEN origin='unlinked'
      AND lower(trim(recordedName)) IN (SELECT name FROM ambiguous_names) THEN 'u:'||lower(trim(recordedName)) ELSE 'e:'||exerciseId END AS finderKey FROM b),
    grouped AS (SELECT finderKey,CASE WHEN substr(finderKey,1,2)='u:' THEN MIN(recordedName) ELSE MIN(catalogName) END AS name,
      COUNT(DISTINCT CAST(sessionId AS TEXT)||':'||observationKey) AS historyCount,MAX(date) AS lastDate,
      MAX(date||':'||printf('%020d',sessionId)) AS lastOrder,
      MAX(CASE WHEN lower(catalogName)=? OR lower(recordedName)=? THEN 3 WHEN instr(lower(catalogName),?)=1 OR instr(lower(recordedName),?)=1 THEN 2 ELSE 1 END) AS rank
      FROM keyed GROUP BY finderKey HAVING (?='' OR MAX(instr(lower(catalogName),?)>0 OR instr(lower(recordedName),?)>0)))`;
  const args=[...all.args,...b.args,q,q,q,q,q,q,q,initial,initial];
  const order=filters.sort==="name"?"rank DESC,lower(name),finderKey":"rank DESC,lastOrder DESC,finderKey";
  const rows=db.prepare(`${grouped} SELECT * FROM grouped WHERE (?='' OR lower(substr(name,1,1))=?) ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args,p.limit+1,p.offset) as {finderKey:string;name:string;historyCount:number;lastDate:string}[];
  const items=rows.slice(0,p.limit).map(row=>{
    const unlinked=row.finderKey.startsWith("u:");const id=row.finderKey.slice(2);
    if(!unlinked){const exercise=summary(userId,id,filters)!;return {key:row.finderKey,kind:"exercise" as const,name:row.name,exercise,historyCount:row.historyCount,lastDate:row.lastDate,latest:exercise.latest,context:"Tracked exercise"};}
    const latest=db.prepare(`WITH b AS (${b.sql}) SELECT * FROM b WHERE origin='unlinked' AND lower(trim(recordedName))=? ORDER BY date DESC,sessionId DESC,sortOrder,setNumber,setId LIMIT 1`).get(...b.args,id) as BaseRow|undefined;
    return {key:`u:${Buffer.from(id).toString("base64url")}`,kind:"unlinked" as const,name:row.name,exercise:null,historyCount:row.historyCount,lastDate:row.lastDate,latest:performance(latest),context:latest?.workoutName||"Recorded workouts"};
  });
  return {items,nextCursor:p.next(rows.length>p.limit),previousCursor:p.previous};
}
export function getProgressHome(userId:number,filters:ProgressFilters={},now=new Date()):ProgressHome {
  const today=userDateKey(userId,now);const activityFilters={...filters,period:filters.period??"4w",to:date(filters.to)??today};const b=base(userId,activityFilters,now);
  const activity=db.prepare(`WITH b AS (${b.sql}) SELECT COUNT(DISTINCT sessionId) AS sessions,COALESCE(SUM(multiplicity),0) AS recordedSets,
    COALESCE(SUM(reps*weightLb*multiplicity),0) AS volumeLb,COALESCE(SUM(CASE WHEN weight IS NULL THEN multiplicity ELSE 0 END),0) AS missingWeightSets,
    COALESCE(MAX(unit='kg'),0) AS usesKilograms FROM b`).get(...b.args) as Omit<ProgressHome["activity"],"from"|"to"|"emptySessions"|"usesKilograms">&{usesKilograms:number};
  const c=constraints(userId,activityFilters,now);
  const empty=db.prepare(`SELECT COUNT(*) AS count FROM sessions s WHERE ${c.where} AND s.status='completed' AND NOT EXISTS(SELECT 1 FROM session_sets ss WHERE ss.session_id=s.id AND ss.actual_reps IS NOT NULL)`).get(...c.args) as {count:number};
  const ids=getPinnedExerciseIds(userId);const pinned=ids.map(id=>summary(userId,id)).filter((row):row is ExerciseSummary=>row!==null);
  // Recent is always a separate 12-week performed-date window, independent of the activity period.
  const candidates=listProgressExercises(userId,{from:shift(today,-83),to:today,sort:"recent",limit:7}).items;
  const recent=candidates.filter(row=>!row.exercise||!ids.includes(row.exercise.id)).slice(0,3);
  const all=base(userId,{});
  const names=db.prepare(`WITH b AS (${all.sql}) SELECT DISTINCT recordedName,exerciseId FROM b`).all(...all.args) as {recordedName:string;exerciseId:string}[];
  const primary:ProgressPrimaryExercise[]=([['squat','Squat'],['bench','Bench'],['deadlift','Deadlift']] as const).map(([key,name])=>{
    const matches=[...new Set(names.filter(row=>exerciseNameKey(row.recordedName)===key).map(row=>row.exerciseId))];
    return {key:`p:${key}`,name,hasHistory:matches.length>0,exercise:matches.length===1?summary(userId,matches[0]):null};
  });
  return {primary,pinned,recent,pinLimit:4,recentLimit:3,activity:{...activity,usesKilograms:!!activity.usesKilograms,emptySessions:empty.count,from:b.from,to:b.to??today}};
}
export function listProgressPrograms(userId:number,filters:ProgressFilters={}):ProgressPage<ProgressProgram> {
  const c=constraints(userId,{...filters,programId:undefined});const p=pagination(userId,"programs",filters,10);const q=(filters.search??"").trim().toLowerCase();
  const rows=db.prepare(`SELECT COALESCE(s.program_id,0) AS id,CASE WHEN s.program_id IS NULL THEN CASE WHEN MAX(s.program_name NOT IN ('','Quick Workout')) THEN 'Other saved workouts' ELSE 'Unplanned workouts' END ELSE COALESCE(NULLIF(MAX(s.program_name),''),'Archived program') END AS name,
    COUNT(*) AS sessionCount,MAX(s.date) AS lastDate FROM sessions s WHERE ${c.where} AND s.status='completed' GROUP BY s.program_id
    HAVING (?='' OR instr(lower(name),?)>0) ORDER BY lastDate DESC,id DESC LIMIT ? OFFSET ?`).all(...c.args,q,q,p.limit+1,p.offset) as ProgressProgram[];
  return {items:rows.slice(0,p.limit),nextCursor:p.next(rows.length>p.limit),previousCursor:p.previous};
}
function candidatePage(userId:number,kind:string,filters:ProgressFilters,extra:string,extraArgs:Value[]):ProgressPage<CandidateObservation> {
  const c=range(userId,filters);const p=pagination(userId,kind,filters);const where=[extra,"recordedSets>0"];const args:Value[]=[userId,...extraArgs];
  if(c.from){where.push("date>=?");args.push(c.from);}if(c.to){where.push("date<=?");args.push(c.to);}
  if(filters.programId!==undefined){where.push(filters.programId===0?"programId IS NULL":"programId=?");if(filters.programId!==0)args.push(filters.programId);}
  const search=(filters.search??"").trim().toLowerCase();if(search){where.push("(instr(lower(recordedName),?)>0 OR instr(lower(workoutName),?)>0 OR instr(lower(programName),?)>0)");args.push(search,search,search);}
  const rows=db.prepare(`${CANDIDATE_CTE} SELECT * FROM candidates WHERE ${where.join(" AND ")} ORDER BY date DESC,sessionId DESC,id DESC LIMIT ? OFFSET ?`).all(...args,p.limit+1,p.offset) as Parameters<typeof decorateCandidate>[0][];
  return {items:rows.slice(0,p.limit).map(decorateCandidate),nextCursor:p.next(rows.length>p.limit),previousCursor:p.previous};
}
export function listUnlinkedExercises(userId:number,groupKey:string,filters:ProgressFilters={}):ProgressPage<CandidateObservation> {
  const name=decodeGroup(groupKey);
  return candidatePage(userId,`group:${groupKey}`,filters,`lower(trim(recordedName))=? AND exerciseId IN (SELECT id FROM exercise_catalog WHERE user_id=? AND origin='unlinked')`,[name,userId]);
}
export function getExerciseCandidates(userId:number,exerciseId:string,filters:ProgressFilters={}):ProgressPage<CandidateObservation> {
  const requestedId=exerciseId;
  exerciseId=resolveCatalogRedirect(db,userId,exerciseId);
  return candidatePage(userId,`included:${requestedId}`,filters,"exerciseId=?",[exerciseId]);
}
const E1RM=`CASE WHEN weight>0 AND reps>0 THEN CASE WHEN reps=1 THEN weight ELSE weight*(1+reps/30.0) END END`;
// Share metric eligibility between plotted values and full-range comparisons.
const SESSION_METRICS=`SELECT sessionId,date,unit,MAX(${E1RM}) AS bestE1rm,
  MAX(${E1RM})*CASE WHEN unit='kg' THEN ${KG_TO_LB} ELSE 1 END AS bestE1rmLb,
  MAX(CASE WHEN reps>0 AND weight>=0 THEN weight END) AS topWeight,
  SUM(reps*multiplicity) AS totalReps,SUM(multiplicity) AS recordedSets FROM chosen GROUP BY sessionId`;
function fullRangeMetricSummaries(source:string,args:Value[]):ExerciseMetricSummary[] {
  // Rank in SQLite and return at most four evidence rows per metric, even when
  // the matching history has years of sessions. Nulls are missing, not zero.
  const rows=db.prepare(`${source}, session_metrics AS (${SESSION_METRICS}), metric_values AS (
      SELECT 'estimate:'||unit AS metric,bestE1rm AS value,sessionId,date,unit,recordedSets,totalReps FROM session_metrics WHERE bestE1rm IS NOT NULL
      UNION ALL SELECT 'load:'||unit,topWeight,sessionId,date,unit,recordedSets,totalReps FROM session_metrics WHERE topWeight IS NOT NULL
      UNION ALL SELECT 'reps',totalReps,sessionId,date,unit,recordedSets,totalReps FROM session_metrics
    ), ranked AS (
      SELECT *,COUNT(*) OVER (PARTITION BY metric) AS count,
        ROW_NUMBER() OVER (PARTITION BY metric ORDER BY date DESC,sessionId DESC) AS latestRank,
        ROW_NUMBER() OVER (PARTITION BY metric ORDER BY date,sessionId) AS firstRank,
        ROW_NUMBER() OVER (PARTITION BY metric ORDER BY value DESC,date DESC,sessionId DESC) AS bestRank
      FROM metric_values
    ) SELECT * FROM ranked WHERE latestRank<=2 OR firstRank=1 OR bestRank=1 ORDER BY metric,latestRank`).all(...args) as
    (ExerciseMetricEvidence&{metric:ExerciseMetricSummary["metric"];count:number;latestRank:number;firstRank:number;bestRank:number})[];
  const summaries=new Map<ExerciseMetricSummary["metric"],ExerciseMetricSummary>();
  for(const row of rows){
    let item=summaries.get(row.metric);
    if(!item){item={metric:row.metric,count:row.count,latest:null,previous:null,first:null,best:null};summaries.set(row.metric,item);}
    const evidence:ExerciseMetricEvidence={value:row.value,sessionId:row.sessionId,date:row.date,unit:row.unit,recordedSets:row.recordedSets,totalReps:row.totalReps};
    if(row.latestRank===1)item.latest=evidence;if(row.latestRank===2)item.previous=evidence;
    if(row.firstRank===1)item.first=evidence;if(row.bestRank===1)item.best=evidence;
  }
  return [...summaries.values()];
}
export function getExerciseDetail(userId:number,exerciseId:string,filters:ProgressFilters={}):ExerciseDetail|null {
  const requestedId=exerciseId;
  exerciseId=resolveCatalogRedirect(db,userId,exerciseId);
  const exercise=summary(userId,exerciseId,filters);if(!exercise)return null;
  const b=base(userId,filters);const p=pagination(userId,`detail:${requestedId}`,filters);
  const source=`WITH b AS (${b.sql}), chosen AS (SELECT * FROM b WHERE exerciseId=?)`;
  const args=[...b.args,exerciseId];
  const aggregate=db.prepare(`${source} SELECT COUNT(DISTINCT sessionId) AS sessions,COALESCE(SUM(multiplicity),0) AS recordedSets,
    COALESCE(SUM(reps*multiplicity),0) AS reps,COALESCE(SUM(reps*weightLb*multiplicity),0) AS volumeLb,
    COALESCE(SUM(CASE WHEN weight IS NULL THEN multiplicity ELSE 0 END),0) AS missingWeightSets,
    COUNT(DISTINCT date(date,'-'||((CAST(strftime('%w',date) AS INTEGER)+6)%7)||' days')) AS activeWeeks,
    MIN(date) AS firstDate,MAX(date) AS lastDate FROM chosen`).get(...args) as ExerciseDetail["totals"]&Omit<ExerciseTraining,"volumeByUnit">;
  const {activeWeeks,firstDate,lastDate,...totals}=aggregate;
  const volumeByUnit=db.prepare(`${source} SELECT unit,COALESCE(SUM(reps*weight*multiplicity),0) AS volume,SUM(multiplicity) AS recordedSets,
    COALESCE(SUM(CASE WHEN weight IS NULL THEN multiplicity ELSE 0 END),0) AS missingWeightSets
    FROM chosen GROUP BY unit ORDER BY unit`).all(...args) as ExerciseTraining["volumeByUnit"];
  const training:ExerciseTraining={activeWeeks,firstDate,lastDate,volumeByUnit};
  const sessionRows=db.prepare(`${source} SELECT sessionId,date FROM chosen GROUP BY sessionId ORDER BY date DESC,sessionId DESC LIMIT ? OFFSET ?`).all(...args,p.limit+1,p.offset) as {sessionId:number;date:string}[];
  const observations:ExerciseObservation[]=sessionRows.slice(0,p.limit).map(session=>{
    const rows=db.prepare(`${source} SELECT * FROM chosen WHERE sessionId=? ORDER BY sortOrder,setNumber,setId`).all(...args,session.sessionId) as BaseRow[];
    const first=rows[0];let bestE1rm:number|null=null;let topWeight:number|null=null;let volume=0;let missingWeightSets=0;let recordedSets=0;let totalReps=0;
    for(const row of rows){recordedSets+=row.multiplicity;totalReps+=row.reps*row.multiplicity;
      if(row.weight===null){missingWeightSets+=row.multiplicity;continue;}topWeight=Math.max(topWeight??row.weight,row.weight);volume+=row.weight*row.reps*row.multiplicity;
      if(row.weight>0&&row.reps>0)bestE1rm=Math.max(bestE1rm??0,row.reps===1?row.weight:row.weight*(1+row.reps/30));}
    return {sessionId:session.sessionId,date:first.date,unit:first.unit,workoutName:first.workoutName||"Quick Workout",programName:first.programName,programId:first.programId,
      recordedNames:[...new Set(rows.map(row=>row.recordedName))],sets:rows.map(row=>({setId:row.setId,name:row.recordedName,reps:row.reps,weight:row.weight,unit:row.unit,count:row.multiplicity,role:row.role,loadMode:row.loadMode})),
      recordedSets,totalReps,volume,missingWeightSets,bestE1rm,topWeight};
  });
  const chartRows=db.prepare(`${source} ${SESSION_METRICS} ORDER BY date DESC,sessionId DESC LIMIT 121`).all(...args) as ExerciseChartPoint[];
  return {exercise,from:b.from,to:b.to,totals,training,metricSummaries:fullRangeMetricSummaries(source,args),observations:{items:observations,nextCursor:p.next(sessionRows.length>p.limit),previousCursor:p.previous},chart:{points:chartRows.slice(0,120).reverse(),truncated:chartRows.length>120,totalObservations:totals.sessions}};
}
export function getProgressHistory(userId:number,filters:ProgressFilters&{status?:"all"|"in_progress"|"completed"|"skipped"}={}):ProgressPage<ProgressWorkout> {
  const c=constraints(userId,filters);const p=pagination(userId,`history:${filters.status??"all"}`,filters);const clauses=[c.where];const args=[...c.args];
  if(filters.status&&filters.status!=="all"){if(!["in_progress","completed","skipped"].includes(filters.status))invalid("Choose a valid status.");clauses.push("s.status=?");args.push(filters.status);}
  const q=(filters.search??"").trim().toLowerCase();if(q){clauses.push("(instr(lower(s.day_name),?)>0 OR instr(lower(s.program_name),?)>0 OR EXISTS(SELECT 1 FROM session_sets searched WHERE searched.session_id=s.id AND instr(lower(searched.exercise_name),?)>0))");args.push(q,q,q);}
  const rows=db.prepare(`SELECT s.id AS sessionId,CASE WHEN s.program_name='' OR (s.program_id IS NULL AND s.program_run_id IS NULL AND s.program_name='Quick Workout') THEN COALESCE(NULLIF(s.day_name,''),'Quick Workout') ELSE s.program_name||' · '||s.day_name END AS name,
    s.date,s.unit,s.status,s.program_id AS programId,s.program_name AS programName,
    COALESCE(SUM(CASE WHEN ss.actual_reps IS NOT NULL THEN MAX(ss.sets,1) ELSE 0 END),0) AS loggedSets,
    COALESCE(SUM(CASE WHEN ss.id IS NOT NULL THEN MAX(ss.sets,1) ELSE 0 END),0) AS totalSets,
    COALESCE(SUM(ss.actual_reps*ss.actual_weight*MAX(ss.sets,1)),0) AS volume,
    COALESCE(SUM(CASE WHEN ss.actual_reps IS NOT NULL AND ss.actual_weight IS NULL THEN MAX(ss.sets,1) ELSE 0 END),0) AS missingWeightSets
    FROM sessions s LEFT JOIN session_sets ss ON ss.session_id=s.id WHERE ${clauses.join(" AND ")} GROUP BY s.id ORDER BY s.date DESC,s.id DESC LIMIT ? OFFSET ?`).all(...args,p.limit+1,p.offset) as ProgressWorkout[];
  return {items:rows.slice(0,p.limit),nextCursor:p.next(rows.length>p.limit),previousCursor:p.previous};
}
export function listProgressRoutines(userId:number,filters:ProgressFilters={}):ProgressPage<ProgressRoutine> {
  range(userId,filters);const p=pagination(userId,"routines",filters);const q=(filters.search??"").trim().toLowerCase();
  const rows=db.prepare("SELECT id,name,prescription_json FROM workout_routines WHERE user_id=? AND (?='' OR instr(lower(name),?)>0) ORDER BY id DESC LIMIT ? OFFSET ?").all(userId,q,q,p.limit+1,p.offset) as {id:number;name:string;prescription_json:string}[];
  return {items:rows.slice(0,p.limit).map(row=>{const exercises=JSON.parse(row.prescription_json) as {sets:unknown[]}[];return {id:row.id,name:row.name,exerciseCount:exercises.length,setCount:exercises.reduce((sum,item)=>sum+item.sets.length,0)};}),nextCursor:p.next(rows.length>p.limit),previousCursor:p.previous};
}
