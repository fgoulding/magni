import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { dateKeyPlus, ensureScheduledOccurrences, syncOccurrencePosition, validDateKey } from "@/features/programs/occurrences";
import { userDateKey } from "@/lib/user-date";
import { applyEditorCompletion, type EditorCompletionDecision } from "@/features/program-editor/execution";

type Row = Record<string, string | number | null> & {
  id: number; user_id: number; program_id: number; program_run_id: number;
  definition_day_id: number | null; legacy_day_id: number | null; scheduled_date: string;
  status: string; revision: number; moved: number; day_name: string;
  program_name: string; week_number: number;
};
type Change = { id: number; name: string; from: string; to: string };
export type CalendarResult = { operationId?: string; undone?: boolean; changes: Change[]; conflicts?: { id: number; date: string; name: string; revision: number }[] };
type Journal = { id: string; before_json: string; after_json: string; undone_at: string | null };
type RunState = { id:number; programId:number; status:string; is_active:number; archived_at:string|null };
type SavedAfter = { request: string; rows: Row[]; runs:RunState[]; progression:EditorCompletionDecision[]; skipSessionId?: number; result: CalendarResult };
type Body = Record<string, unknown>;

export class CalendarError extends Error {
  constructor(message: string, public status = 400, public conflicts?: CalendarResult["conflicts"]) { super(message); }
}
function rowFor(userId: number, id: unknown): Row {
  if (!Number.isInteger(id) || Number(id) < 1) throw new CalendarError("Workout not found", 404);
  const row = db.prepare("SELECT * FROM workout_occurrences WHERE user_id=? AND id=?").get(userId,id) as Row | undefined;
  if (!row) throw new CalendarError("Workout not found", 404);
  return row;
}
function pending(row: Row, revision: unknown) {
  if (row.revision !== revision) throw new CalendarError("Workout changed. Refresh the calendar and try again.",409);
  if (row.status !== "scheduled" || db.prepare("SELECT id FROM sessions WHERE occurrence_id=?").get(row.id)) throw new CalendarError("Workout already started or resolved. Its history cannot be rearranged.",409);
  const run = db.prepare("SELECT status,archived_at FROM program_runs WHERE id=?").get(row.program_run_id) as { status:string; archived_at:string|null } | undefined;
  if (!run || run.status !== "active" || run.archived_at) throw new CalendarError("Resume the program before rearranging its workouts.",409);
}
function date(value: unknown): string {
  if (!validDateKey(value)) throw new CalendarError("Choose a valid date.");
  return value;
}
function requestFingerprint(body: Body): string {
  return JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "requestKey").sort(([a],[b]) => a.localeCompare(b))));
}
function conflictsAt(userId: number, dates: string[], excluded: number[]) {
  return (db.prepare(`SELECT o.id,o.scheduled_date AS date,o.day_name AS name,o.revision FROM workout_occurrences o
    JOIN program_runs pr ON pr.id=o.program_run_id WHERE o.user_id=? AND o.status IN ('scheduled','in_progress')
    AND pr.status='active' AND pr.archived_at IS NULL`).all(userId) as NonNullable<CalendarResult["conflicts"]>)
    .filter(row => dates.includes(row.date) && !excluded.includes(row.id));
}
function runState(row:Row):RunState {
  return db.prepare("SELECT pr.id,p.id AS programId,pr.status,p.is_active,pr.archived_at FROM program_runs pr JOIN programs p ON p.program_run_id=pr.id WHERE pr.id=? AND p.id=?").get(row.program_run_id,row.program_id) as RunState;
}
export function latestCalendarOperation(userId: number): string | undefined {
  return (db.prepare("SELECT id FROM calendar_operations WHERE user_id=? AND undone_at IS NULL ORDER BY rowid DESC LIMIT 1").get(userId) as {id:string}|undefined)?.id;
}
function undo(userId: number, body: Body): CalendarResult {
  if (typeof body.operationId !== "string") throw new CalendarError("Choose an operation to undo.");
  const journal = db.prepare("SELECT * FROM calendar_operations WHERE id=? AND user_id=?").get(body.operationId,userId) as Journal|undefined;
  if (!journal) throw new CalendarError("Calendar change not found",404);
  const after = JSON.parse(journal.after_json) as SavedAfter;
  if (journal.undone_at) return { operationId:journal.id, undone:true, changes:[] };
  const before = JSON.parse(journal.before_json) as {rows:Row[];runs:RunState[]};
  for (const row of after.rows) {
    const current = rowFor(userId,row.id);
    const session = db.prepare("SELECT id,status FROM sessions WHERE occurrence_id=?").get(row.id) as {id:number;status:string}|undefined;
    if (JSON.stringify(current)!==JSON.stringify(row) || (session && (session.id!==after.skipSessionId || session.status!=="skipped"))) throw new CalendarError("Workout changed or logging started. This change can no longer be undone.",409);
  }
  for (const run of after.runs) {
    const current=runState(after.rows.find(row=>row.program_run_id===run.id)!);
    if (JSON.stringify(current)!==JSON.stringify(run)) throw new CalendarError("Program status changed. Undo cannot overwrite a later pause or completion.",409);
  }
  for (const decision of after.progression) {
    const runId=after.rows[0].program_run_id;
    const current=db.prepare("SELECT state_json,revision FROM program_editor_progression_state WHERE run_id=? AND progression_key=?").get(runId,decision.progressionKey) as {state_json:string;revision:number}|undefined;
    if (!current || current.revision!==decision.stateRevisionAfter || current.state_json!==JSON.stringify(decision.afterState)) throw new CalendarError("Progression changed after this skip. Undo cannot overwrite a later workout.",409);
  }
  for (const decision of after.progression) db.prepare("UPDATE program_editor_progression_state SET state_json=?,revision=revision+1,updated_at=datetime('now') WHERE run_id=? AND progression_key=?").run(JSON.stringify(decision.beforeState),after.rows[0].program_run_id,decision.progressionKey);
  if (after.skipSessionId) db.prepare("DELETE FROM program_editor_progression_events WHERE session_id=?").run(after.skipSessionId);
  if (after.skipSessionId) db.prepare("DELETE FROM sessions WHERE id=? AND user_id=? AND status='skipped'").run(after.skipSessionId,userId);
  for (const row of after.rows) {
    const original = before.rows.find(value => value.id===row.id);
    if (original) db.prepare("UPDATE workout_occurrences SET scheduled_date=?,status=?,moved=?,revision=revision+1 WHERE id=?").run(original.scheduled_date,original.status,original.moved,row.id);
    else db.prepare("DELETE FROM workout_occurrences WHERE id=? AND user_id=?").run(row.id,userId);
  }
  for (const run of before.runs) {
    db.prepare("UPDATE program_runs SET status=? WHERE id=? AND user_id=?").run(run.status,run.id,userId);
    db.prepare("UPDATE programs SET is_active=? WHERE id=? AND user_id=?").run(run.is_active,run.programId,userId);
    syncOccurrencePosition(userId,run.programId);
  }
  db.prepare("UPDATE calendar_operations SET undone_at=datetime('now') WHERE id=?").run(journal.id);
  return { operationId:journal.id, undone:true, changes:after.result.changes.map(row => ({...row,from:row.to,to:row.from})) };
}

/** The transaction captures the exact changed rows. Retries reuse their command ID;
 * revisions stop stale tabs or undo from overwriting work logged in the meantime. */
export function applyCalendarAction(userId: number, input: unknown): CalendarResult {
  if (!input || typeof input!=="object" || Array.isArray(input)) throw new CalendarError("Invalid calendar action.");
  const body=input as Body;
  if (typeof body.requestKey!=="string" || body.requestKey.length<8 || body.requestKey.length>128) throw new CalendarError("A request key is required for safe retries.");
  ensureScheduledOccurrences.immediate(userId);
  return db.transaction(() => {
    if (body.type==="undo") return undo(userId,body);
    const request=requestFingerprint(body);
    const existing=db.prepare("SELECT * FROM calendar_operations WHERE user_id=? AND request_key=?").get(userId,body.requestKey) as Journal|undefined;
    if (existing) {
      const saved=JSON.parse(existing.after_json) as SavedAfter;
      if (saved.request!==request) throw new CalendarError("This request key was already used for a different action.",409);
      return saved.result;
    }
    if (!["move","duplicate","skip","shift"].includes(String(body.type))) throw new CalendarError("Invalid calendar action.");
    let before:Row[]=[];
    const runsBefore=new Map<number,RunState>();
    let progression:EditorCompletionDecision[]=[];
    let changes:Change[]=[];
    let skipSessionId:number|undefined;
    if (body.type==="shift") {
      if (!Array.isArray(body.selections) || !body.selections.length || body.selections.length>1000) throw new CalendarError("Select between 1 and 1000 future workouts.");
      if (!Number.isInteger(body.days) || Math.abs(Number(body.days))>3660 || body.days===0) throw new CalendarError("Choose a nonzero shift of up to 3660 days.");
      const today=userDateKey(userId);
      before=body.selections.map(value => {
        if (!value || typeof value!=="object") throw new CalendarError("Invalid selection.");
        const selection=value as Body;
        const row=rowFor(userId,selection.id); pending(row,selection.revision);
        runsBefore.set(row.program_run_id,runState(row));
        if (row.scheduled_date<today) throw new CalendarError("Group shifts only include future workouts.",409);
        return row;
      });
      if (new Set(before.map(row=>row.id)).size!==before.length) throw new CalendarError("Select each workout once.");
      changes=before.map(row=>({id:row.id,name:row.day_name,from:row.scheduled_date,to:date(dateKeyPlus(row.scheduled_date,Number(body.days)))}));
      if (changes.some(row=>row.to<today)) throw new CalendarError("Group shifts must stay on future dates.",409);
      const conflicts=conflictsAt(userId,changes.map(row=>row.to),before.map(row=>row.id));
      if (body.preview===true) return {changes,conflicts};
      if (conflicts.length && body.collision!=="move") throw new CalendarError("A target date is occupied. Confirm keeping both workouts on those dates.",409,conflicts);
    } else {
      const row=rowFor(userId,body.occurrenceId);
      runsBefore.set(row.program_run_id,runState(row));
      if (body.type==="duplicate") {
        if (row.revision!==body.revision) throw new CalendarError("Workout changed. Refresh and try again.",409);
        const run=runsBefore.get(row.program_run_id)!;
        if (!run || run.archived_at || !["active","completed"].includes(run.status)) throw new CalendarError("Resume this program before duplicating its workouts.",409);
        if (body.collision==="swap") throw new CalendarError("A duplicate can share a date; only a move can swap workouts.");
      } else pending(row,body.revision);
      before=[row];
      if (body.type==="skip") {
        const result=db.prepare(`INSERT INTO sessions(user_id,program_id,program_run_id,program_definition_id,program_definition_day_id,day_id,program_name,day_name,week_number,date,scheduled_date,status,skipped_at,occurrence_id)
          VALUES (?,?,?,(SELECT program_definition_id FROM program_runs WHERE id=?),?,?,?,?,?,?,?,'skipped',datetime('now'),?)`).run(userId,row.program_id,row.program_run_id,row.program_run_id,row.definition_day_id,row.legacy_day_id,row.program_name,row.day_name,row.week_number,userDateKey(userId),row.scheduled_date,row.id);
        skipSessionId=Number(result.lastInsertRowid);
        progression=applyEditorCompletion({userId,sessionId:skipSessionId});
        db.prepare("UPDATE workout_occurrences SET revision=revision+1 WHERE id=?").run(row.id);
      } else {
        const target=date(body.date);
        const conflicts=conflictsAt(userId,[target],body.type==="move"?[row.id]:[]);
        if (conflicts.length && body.collision!=="move" && body.collision!=="swap") throw new CalendarError("That date is occupied. Choose move or swap.",409,conflicts);
        if (body.type==="move") {
          changes=[{id:row.id,name:row.day_name,from:row.scheduled_date,to:target}];
          if (body.collision==="swap") {
            const targetRow=rowFor(userId,body.targetId); pending(targetRow,body.targetRevision);
            runsBefore.set(targetRow.program_run_id,runState(targetRow));
            if (targetRow.id===row.id || targetRow.scheduled_date!==target) throw new CalendarError("Swap target changed. Choose the target workout again.",409);
            before.push(targetRow);
            changes.push({id:targetRow.id,name:targetRow.day_name,from:target,to:row.scheduled_date});
          }
        } else {
          // Copy every occurrence snapshot field, including editor version links.
          const copy={...row,slot_index:null,scheduled_date:target,original_date:target,status:"scheduled",revision:1,moved:1};
          const columns=Object.keys(copy).filter(key=>key!=="id" && key!=="created_at");
          const inserted=db.prepare(`INSERT INTO workout_occurrences (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`).run(...columns.map(column=>copy[column as keyof typeof copy]));
          const id=Number(inserted.lastInsertRowid);
          // Adding an explicit new exposure deliberately reopens a finished run.
          db.prepare("UPDATE program_runs SET status='active' WHERE id=? AND status='completed'").run(row.program_run_id);
          db.prepare("UPDATE programs SET is_active=1 WHERE id=?").run(row.program_id);
          before=[];
          changes=[{id,name:row.day_name,from:row.scheduled_date,to:target}];
        }
      }
    }
    if (body.type==="move" || body.type==="shift") for (const change of changes) db.prepare("UPDATE workout_occurrences SET scheduled_date=?,moved=1,revision=revision+1 WHERE id=?").run(change.to,change.id);
    const ids=body.type==="skip" ? before.map(row=>row.id) : changes.map(row=>row.id);
    const after=ids.map(id=>rowFor(userId,id));
    for (const programId of new Set(after.map(row=>row.program_id))) syncOccurrencePosition(userId,programId);
    const operationId=randomUUID();
    const result={operationId,changes};
    const runs=[...new Map(after.map(row=>[row.program_run_id,runState(row)])).values()];
    db.prepare("INSERT INTO calendar_operations(id,user_id,request_key,before_json,after_json) VALUES (?,?,?,?,?)").run(operationId,userId,body.requestKey,JSON.stringify({rows:before,runs:[...runsBefore.values()]}),JSON.stringify({request,rows:after,runs,progression,skipSessionId,result} satisfies SavedAfter));
    return result;
  }).immediate();
}
