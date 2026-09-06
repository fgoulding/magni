import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as createProgram } from "./route";
import { POST as createDay } from "./[id]/days/route";
import { POST as createExercise } from "../days/[dayId]/exercises/route";
import { PUT as updateProgram } from "./[id]/route";
import { getOccurrences } from "@/features/programs/occurrences";
import { getTodayWorkoutDashboard } from "@/features/programs/program-service";

const identity=vi.hoisted(()=>({userId:0}));
vi.mock("@/lib/auth",()=>({
  requireUser:async()=>({id:identity.userId}),
  getSettingNumber:(_userId:number,_key:string,fallback:number)=>fallback,
  UnauthorizedError:class UnauthorizedError extends Error {},
}));
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
const request=(body:unknown)=>new Request("http://localhost/api/programs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
const params=(id:number)=>({params:Promise.resolve({id:String(id)})});

describe("New legacy program local start date",()=>{
  it.each([
    {zone:"America/Los_Angeles",instant:"2026-09-06T00:30:00Z",localDate:"2026-09-05"},
    {zone:"Asia/Tokyo",instant:"2026-09-05T23:30:00Z",localDate:"2026-09-06"},
    {zone:"America/Los_Angeles",instant:"2026-03-08T07:30:00Z",localDate:"2026-03-07"},
  ])("starts Day 1 on $localDate for $zone at $instant, independently of UTC creation metadata",async({zone,instant,localDate})=>{
    vi.stubEnv("TZ","UTC");vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(instant));
    identity.userId=Number(db.prepare("INSERT INTO users(email,password_hash) VALUES (?,'hash')").run(`${crypto.randomUUID()}@example.test`).lastInsertRowid);
    db.prepare("INSERT INTO user_settings(user_id,key,value) VALUES (?,'timezone',?)").run(identity.userId,zone);
    const created=await createProgram(request({name:"Midnight strength",numWeeks:2}));
    expect(created.status).toBe(201);const program=await created.json();
    // SQLite's native clock does not follow fake JS time. Set only timestamp
    // metadata to the same UTC instant that a real creation would record.
    const utcCreatedAt=instant.slice(0,19).replace("T"," ");
    db.prepare("UPDATE programs SET created_at=? WHERE id=?").run(utcCreatedAt,program.id);
    db.prepare("UPDATE program_runs SET created_at=? WHERE id=(SELECT program_run_id FROM programs WHERE id=?)").run(utcCreatedAt,program.id);
    const dayResponse=await createDay(request({name:"Lower"}),params(program.id));
    expect(dayResponse.status).toBe(201);const day=await dayResponse.json();
    expect((await createExercise(request({name:"Squat",trainingMax:100,progressionType:"linear"}),{params:Promise.resolve({dayId:String(day.id)})})).status).toBe(201);
    // This is the normal schedule editor request: weekdays only, no explicit anchor.
    expect((await updateProgram(request({scheduleWeekdays:[0,1,2,3,4,5,6]}),params(program.id))).status).toBe(200);
    const [first]=getOccurrences(identity.userId);
    expect(first).toMatchObject({scheduled_date:localDate,original_date:localDate,day_number:1,week_number:1});
    expect(getTodayWorkoutDashboard(identity.userId).scheduledToday).toEqual([expect.objectContaining({occurrence_id:first.id})]);
    expect(db.prepare("SELECT start_date,created_at FROM program_runs WHERE id=(SELECT program_run_id FROM programs WHERE id=?)").get(program.id)).toEqual({start_date:localDate,created_at:utcCreatedAt});
  });
});
