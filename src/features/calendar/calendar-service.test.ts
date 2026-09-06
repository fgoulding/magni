import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const authState=vi.hoisted(()=>({userId:0}));
vi.mock("@/lib/auth", () => {
  class UnauthorizedError extends Error {}
  return { getSettingNumber: () => 2.5, UnauthorizedError, requireUser:async()=>{if(!authState.userId)throw new UnauthorizedError();return {id:authState.userId};} };
});
let db: (typeof import("@/lib/db"))["db"];
let programs: typeof import("@/features/programs/program-service");
let occurrences: typeof import("@/features/programs/occurrences");
let calendar: typeof import("./calendar-service");
beforeAll(async () => {
  process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "magni-calendar-")), "test.sqlite");
  db = (await import("@/lib/db")).db;
  programs = await import("@/features/programs/program-service");
  occurrences = await import("@/features/programs/occurrences");
  calendar = await import("./calendar-service");
});
function fixture() {
  const user = Number(db.prepare("INSERT INTO users(email,password_hash) VALUES (?,'hash')").run(`${crypto.randomUUID()}@example.test`).lastInsertRowid);
  const run = programs.createProgramRun({ userId: user, name: "Calendar strength", numWeeks: 2 });
  for (const name of ["Lower", "Upper"]) {
    const day = programs.addDefinitionDayForRun({ userId: user, legacyProgramId: run.legacyProgramId, name });
    programs.addDefinitionExerciseForDay({ userId: user, legacyDayId: day.legacyDayId, name: `${name} lift`, trainingMax: 200, category: "main", progressionType: "linear" });
  }
  programs.updateProgramRun({ userId: user, legacyProgramId: run.legacyProgramId, startDate: "2090-06-01", scheduleWeekdays: [0,1,2,3,4,5,6] });
  return { user, run, rows: occurrences.getOccurrences(user) };
}
const key = () => crypto.randomUUID();
describe("Calendar occurrence transactions", () => {
  it("moves one workout without changing logical identity or prescription and supports reload-safe undo", () => {
    const { user, rows: [first] } = fixture();
    const request = { type: "move", occurrenceId: first.id, revision: first.revision, date: "2090-06-09", requestKey: key() };
    const result = calendar.applyCalendarAction(user, request);
    const moved = occurrences.getOccurrence(user, first.id)!;
    expect(moved).toMatchObject({ scheduled_date: "2090-06-09", original_date: first.original_date, slot_index: first.slot_index, week_number: first.week_number, day_number: first.day_number, prescription_json: first.prescription_json, revision: 2 });
    expect(calendar.applyCalendarAction(user, request)).toEqual(result);
    expect(calendar.latestCalendarOperation(user)).toBe(result.operationId);
    calendar.applyCalendarAction(user, { type: "undo", operationId: result.operationId, requestKey: key() });
    expect(occurrences.getOccurrence(user, first.id)).toMatchObject({ scheduled_date: first.scheduled_date, moved: 0, revision: 3 });
    expect(calendar.applyCalendarAction(user, { type: "undo", operationId: result.operationId, requestKey: key() }).undone).toBe(true);
  });
  it("requires an explicit occupied-date choice; swap changes only both dates", () => {
    const { user, rows: [a,b] } = fixture();
    const request = { type: "move", occurrenceId: a.id, revision: a.revision, date: b.scheduled_date, requestKey: key() };
    expect(() => calendar.applyCalendarAction(user, request)).toThrow(/occupied/i);
    expect(occurrences.getOccurrence(user, a.id)?.scheduled_date).toBe(a.scheduled_date);
    const result = calendar.applyCalendarAction(user, { ...request, collision: "swap", targetId: b.id, targetRevision: b.revision });
    expect(occurrences.getOccurrence(user, a.id)).toMatchObject({ scheduled_date: b.scheduled_date, prescription_json: a.prescription_json });
    expect(occurrences.getOccurrence(user, b.id)).toMatchObject({ scheduled_date: a.scheduled_date, prescription_json: b.prescription_json });
    calendar.applyCalendarAction(user, { type: "undo", operationId: result.operationId, requestKey: key() });
    expect(occurrences.getOccurrence(user, b.id)?.scheduled_date).toBe(b.scheduled_date);
  });
  it.each(["completed", "skipped", "in_progress"])("discloses %s planned occupancy without offering it as a swap target", (status) => {
    const { user, run, rows: [a,b] } = fixture();
    const displayDate = status === "completed" ? "2090-07-01" : b.scheduled_date;
    db.prepare("INSERT INTO sessions(user_id,program_id,day_id,program_definition_day_id,program_run_id,occurrence_id,date,scheduled_date,status,program_name,day_name,week_number) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)")
      .run(user,run.legacyProgramId,b.legacy_day_id,b.definition_day_id,run.runId,b.id,displayDate,b.scheduled_date,status,b.program_name,b.day_name);
    const request = { type:"move", occurrenceId:a.id, revision:a.revision, date:displayDate, requestKey:key() };
    let error: InstanceType<typeof calendar.CalendarError> | undefined;
    try { calendar.applyCalendarAction(user,request); } catch (caught) { error=caught as typeof error; }
    expect(error?.status).toBe(409);
    expect(error?.conflicts).toEqual([expect.objectContaining({id:b.id,date:displayDate,name:b.day_name,canSwap:false})]);
    expect(occurrences.getOccurrence(user,a.id)?.scheduled_date).toBe(a.scheduled_date);
    calendar.applyCalendarAction(user,{...request,collision:"move"});
    expect(occurrences.getOccurrence(user,a.id)?.scheduled_date).toBe(displayDate);
    expect(occurrences.getOccurrence(user,b.id)?.status).toBe(status);
  });
  it.each(["completed", "skipped", "in_progress"])("requires add-alongside confirmation for %s unplanned workouts, including off-month targets", (status) => {
    const { user, rows: [a] } = fixture();
    const sessionId=Number(db.prepare("INSERT INTO sessions(user_id,date,status,day_name,week_number) VALUES (?,?,?,?,1)").run(user,"2090-07-01",status,"Independent workout").lastInsertRowid);
    const request={type:"move",occurrenceId:a.id,revision:1,date:"2090-07-01",requestKey:key()};
    let error: InstanceType<typeof calendar.CalendarError> | undefined;
    try { calendar.applyCalendarAction(user,request); } catch (caught) { error=caught as typeof error; }
    expect(error?.status).toBe(409);
    expect(error?.conflicts).toEqual([expect.objectContaining({id:null,key:`session-${sessionId}`,name:"Independent workout",canSwap:false})]);
    calendar.applyCalendarAction(user,{...request,collision:"move"});
    expect(db.prepare("SELECT date,status FROM sessions WHERE id=?").get(sessionId)).toEqual({date:"2090-07-01",status});
  });
  it("allows explicit same-day move without silently swapping, but rejects stale or foreign edits", () => {
    const { user, rows: [a,b] } = fixture();
    const other = fixture();
    expect(() => calendar.applyCalendarAction(other.user, { type: "move", occurrenceId: a.id, revision: 1, date: "2090-06-09", requestKey: key() })).toThrow(/not found/i);
    calendar.applyCalendarAction(user, { type: "move", occurrenceId: a.id, revision: 1, date: b.scheduled_date, collision: "move", requestKey: key() });
    expect(occurrences.getOccurrence(user,b.id)?.scheduled_date).toBe(b.scheduled_date);
    expect(() => calendar.applyCalendarAction(user, { type: "skip", occurrenceId: a.id, revision: 1, requestKey: key() })).toThrow(/changed/i);
  });
  it("duplicates a prescription into a separate occurrence exactly once and undoes only the copy", () => {
    const { user, rows: [a] } = fixture();
    const request = { type: "duplicate", occurrenceId: a.id, revision: 1, date: "2090-06-10", requestKey: key() };
    const result = calendar.applyCalendarAction(user,request);
    calendar.applyCalendarAction(user,request);
    const copy = occurrences.getOccurrences(user).find(row => row.id !== a.id && row.scheduled_date === "2090-06-10")!;
    expect(copy).toMatchObject({ slot_index: null, week_number: a.week_number, day_number: a.day_number, prescription_json: a.prescription_json });
    expect(occurrences.getOccurrences(user)).toHaveLength(5);
    calendar.applyCalendarAction(user, { type: "undo", operationId: result.operationId, requestKey: key() });
    expect(occurrences.getOccurrences(user)).toHaveLength(4);
  });
  it("skips the selected slot, preserves a skip record and restores the slot on undo", () => {
    const { user, rows: [a,b] } = fixture();
    const result = calendar.applyCalendarAction(user, { type: "skip", occurrenceId: a.id, revision: 1, requestKey: key() });
    expect(occurrences.getOccurrence(user,a.id)).toMatchObject({ status: "skipped" });
    expect(db.prepare("SELECT status, scheduled_date FROM sessions WHERE occurrence_id=?").get(a.id)).toEqual({ status:"skipped", scheduled_date:a.scheduled_date });
    expect(occurrences.getOccurrence(user,b.id)?.status).toBe("scheduled");
    calendar.applyCalendarAction(user, { type: "undo", operationId: result.operationId, requestKey: key() });
    expect(occurrences.getOccurrence(user,a.id)).toMatchObject({ status:"scheduled", session_id:null });
  });
  it("previews a selected future group without writes then shifts atomically and undoes it", () => {
    const { user, rows: [a,b,c] } = fixture();
    const request = { type:"shift", selections:[{ id:a.id, revision:1 },{ id:b.id, revision:1 }], days:7, requestKey:key() };
    const preview = calendar.applyCalendarAction(user,{ ...request, preview:true });
    expect(preview.changes).toEqual(expect.arrayContaining([expect.objectContaining({ id:a.id, from:a.scheduled_date, to:"2090-06-08" })]));
    expect(occurrences.getOccurrence(user,a.id)?.revision).toBe(1);
    const result = calendar.applyCalendarAction(user,request);
    expect(occurrences.getOccurrence(user,b.id)?.scheduled_date).toBe("2090-06-09");
    expect(occurrences.getOccurrence(user,c.id)?.scheduled_date).toBe(c.scheduled_date);
    calendar.applyCalendarAction(user,{ type:"undo",operationId:result.operationId,requestKey:key() });
    expect(occurrences.getOccurrence(user,a.id)?.scheduled_date).toBe(a.scheduled_date);
  });
  it("rejects unsafe undo after logging begins and rolls back stale group changes", () => {
    const { user, rows:[a,b] } = fixture();
    const result = calendar.applyCalendarAction(user,{ type:"move",occurrenceId:a.id,revision:1,date:"2090-06-10",requestKey:key() });
    db.prepare("UPDATE workout_occurrences SET status='in_progress' WHERE id=?").run(a.id);
    expect(() => calendar.applyCalendarAction(user,{ type:"undo",operationId:result.operationId,requestKey:key() })).toThrow(/changed|started/i);
    expect(() => calendar.applyCalendarAction(user,{ type:"shift",selections:[{id:b.id,revision:1},{id:a.id,revision:1}],days:2,requestKey:key() })).toThrow();
    expect(occurrences.getOccurrence(user,b.id)?.revision).toBe(1);
  });
  it("rejects invalid dates, replay keys with different intent, invalid actions, and past group shifts", () => {
    const {user,rows:[a]}=fixture();
    const request={type:"move",occurrenceId:a.id,revision:1,date:"2090-06-10",requestKey:key()};
    expect(() => calendar.applyCalendarAction(user,{...request,date:"2090-02-30"})).toThrow(/date/i);
    calendar.applyCalendarAction(user,request);
    expect(() => calendar.applyCalendarAction(user,{...request,date:"2090-06-11"})).toThrow(/key/i);
    expect(() => calendar.applyCalendarAction(user,{type:"erase",requestKey:key()})).toThrow(/action/i);
    expect(() => calendar.applyCalendarAction(user,{type:"shift",selections:[],days:1,requestKey:key()})).toThrow(/select/i);
    expect(() => calendar.applyCalendarAction(user,{type:"skip",occurrenceId:a.id,revision:2})).toThrow(/key/i);
  });
  it("protects API ownership, origin, invalid JSON, and stale writes while retaining saved changes", async () => {
    const {POST}=await import("@/app/api/calendar/actions/route");
    const {user,rows:[a]}=fixture();
    const request=(body:unknown,origin?:string)=>new Request("http://localhost/api/calendar/actions",{method:"POST",headers:{"Content-Type":"application/json",...(origin?{origin}:{})},body:JSON.stringify(body)});
    const body={type:"move",occurrenceId:a.id,revision:1,date:"2090-06-10",requestKey:key()};
    authState.userId=0;
    expect((await POST(request(body))).status).toBe(401);
    authState.userId=user;
    expect((await POST(request(body,"https://foreign.example"))).status).toBe(403);
    expect((await POST(new Request("http://localhost/api/calendar/actions",{method:"POST",body:"{"}))).status).toBe(400);
    expect((await POST(request({...body,occurrenceId:-1}))).status).toBe(404);
    expect((await POST(request(body))).status).toBe(200);
    expect((await POST(request({...body,requestKey:key()}))).status).toBe(409);
    expect(occurrences.getOccurrence(user,a.id)?.scheduled_date).toBe("2090-06-10");
  });
  it("reopens a run after undoing its final skip but never overrides a later user pause", () => {
    const {user,run,rows}=fixture();
    db.prepare("UPDATE workout_occurrences SET status='completed' WHERE program_run_id=? AND id!=?").run(run.runId,rows[3].id);
    const result=calendar.applyCalendarAction(user,{type:"skip",occurrenceId:rows[3].id,revision:1,requestKey:key()});
    expect(db.prepare("SELECT status FROM program_runs WHERE id=?").get(run.runId)).toEqual({status:"completed"});
    calendar.applyCalendarAction(user,{type:"undo",operationId:result.operationId,requestKey:key()});
    expect(db.prepare("SELECT status FROM program_runs WHERE id=?").get(run.runId)).toEqual({status:"active"});
    expect(db.prepare("SELECT is_active FROM programs WHERE id=?").get(run.legacyProgramId)).toEqual({is_active:1});
    const moved=calendar.applyCalendarAction(user,{type:"move",occurrenceId:rows[3].id,revision:3,date:"2090-07-01",requestKey:key()});
    db.prepare("UPDATE program_runs SET status='paused' WHERE id=?").run(run.runId);
    expect(()=>calendar.applyCalendarAction(user,{type:"undo",operationId:moved.operationId,requestKey:key()})).toThrow(/status changed/i);
  });
  it("applies editor skip failure/reset policy and undoes its progression only before a later decision",async()=>{
    const document=await import("@/features/program-editor/document");
    const repository=await import("@/features/program-editor/repository");
    const {user}=fixture();
    const doc=document.createBlankDocument();doc.name="Calendar skip policy";doc.startDate="2090-06-05";doc.weekdays=[0,1,2,3,4,5,6];doc.cycles=3;
    const exercise=document.createExercise("Row");
    exercise.rule={version:1,condition:{type:"double_progression"},action:{variable:"load",unit:"lb",operation:"add",amount:5,rounding:{mode:"nearest",quantum:2.5},timing:"per_exposure"},skipPolicy:"count_failure",failureReset:{afterFailures:2,percent:10,rounding:{mode:"nearest",quantum:2.5}}};
    doc.weeks[0].days[0].exercises=[exercise];
    const id=key();repository.saveEditorDraft({userId:user,id,expectedRevision:0,document:doc});
    const activation=repository.activateEditorDraft({userId:user,id,expectedRevision:1});
    const rows=occurrences.getOccurrences(user).filter(row=>row.program_run_id===activation.runId);
    const read=()=>JSON.parse((db.prepare("SELECT state_json FROM program_editor_progression_state WHERE run_id=? AND progression_key=?").get(activation.runId,exercise.progressionKey) as {state_json:string}).state_json);
    const initial={...read(),load:100,consecutiveFailures:0};
    db.prepare("UPDATE program_editor_progression_state SET state_json=? WHERE run_id=?").run(JSON.stringify(initial),activation.runId);
    const first=calendar.applyCalendarAction(user,{type:"skip",occurrenceId:rows[0].id,revision:1,requestKey:key()});
    expect(read()).toMatchObject({load:100,consecutiveFailures:1});
    calendar.applyCalendarAction(user,{type:"undo",operationId:first.operationId,requestKey:key()});
    expect(read()).toEqual(initial);
    const skippedAgain=calendar.applyCalendarAction(user,{type:"skip",occurrenceId:rows[0].id,revision:3,requestKey:key()});
    const reset=calendar.applyCalendarAction(user,{type:"skip",occurrenceId:rows[1].id,revision:1,requestKey:key()});
    expect(read()).toMatchObject({load:90,consecutiveFailures:0});
    expect(()=>calendar.applyCalendarAction(user,{type:"undo",operationId:skippedAgain.operationId,requestKey:key()})).toThrow(/progression changed/i);
    calendar.applyCalendarAction(user,{type:"undo",operationId:reset.operationId,requestKey:key()});
    expect(read()).toMatchObject({load:100,consecutiveFailures:1});
    expect(db.prepare("SELECT COUNT(*) AS n FROM program_editor_progression_events WHERE run_id=?").get(activation.runId)).toEqual({n:1});
  });
  it("starts separate same-date occurrences through the real route while each retry resumes its own session",async()=>{
    const {user,run,rows:[a]}=fixture();authState.userId=user;
    calendar.applyCalendarAction(user,{type:"duplicate",occurrenceId:a.id,revision:1,date:a.scheduled_date,collision:"move",requestKey:key()});
    const copy=occurrences.getOccurrences(user).find(row=>row.id!==a.id&&row.scheduled_date===a.scheduled_date)!;
    const {POST}=await import("@/app/api/programs/[id]/sessions/route");
    const start=(id:number)=>POST(new Request(`http://localhost/api/programs/${run.legacyProgramId}/sessions`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({occurrenceId:id})}),{params:Promise.resolve({id:String(run.legacyProgramId)})});
    const first=await start(a.id);expect(first.status).toBe(201);const original=await first.json();
    const second=await start(copy.id);expect(second.status).toBe(201);const repeated=await second.json();
    expect(original.id).not.toBe(repeated.id);
    expect(original.scheduled_date).toBe(repeated.scheduled_date);
    expect((await(await start(copy.id)).json()).id).toBe(repeated.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE program_id=?").get(run.legacyProgramId)).toEqual({n:2});
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
  it("deliberately reopens a completed run for a duplicate and undo restores its completed state",()=>{
    const {user,run,rows:[a]}=fixture();
    db.prepare("UPDATE workout_occurrences SET status='completed' WHERE program_run_id=?").run(run.runId);
    occurrences.syncOccurrencePosition(user,run.legacyProgramId);
    const result=calendar.applyCalendarAction(user,{type:"duplicate",occurrenceId:a.id,revision:1,date:"2090-07-01",requestKey:key()});
    expect(occurrences.getOccurrences(user).find(row=>row.scheduled_date==="2090-07-01")?.status).toBe("scheduled");
    expect(db.prepare("SELECT status FROM program_runs WHERE id=?").get(run.runId)).toEqual({status:"active"});
    calendar.applyCalendarAction(user,{type:"undo",operationId:result.operationId,requestKey:key()});
    expect(db.prepare("SELECT status FROM program_runs WHERE id=?").get(run.runId)).toEqual({status:"completed"});
  });
  it("keeps an existing individual override when shifting and undoing a selected future group",()=>{
    const {user,rows:[a]}=fixture();
    calendar.applyCalendarAction(user,{type:"move",occurrenceId:a.id,revision:1,date:"2090-06-10",requestKey:key()});
    const result=calendar.applyCalendarAction(user,{type:"shift",selections:[{id:a.id,revision:2}],days:7,requestKey:key()});
    expect(occurrences.getOccurrence(user,a.id)).toMatchObject({scheduled_date:"2090-06-17",moved:1,original_date:a.original_date,prescription_json:a.prescription_json});
    calendar.applyCalendarAction(user,{type:"undo",operationId:result.operationId,requestKey:key()});
    expect(occurrences.getOccurrence(user,a.id)).toMatchObject({scheduled_date:"2090-06-10",moved:1});
  });
});
