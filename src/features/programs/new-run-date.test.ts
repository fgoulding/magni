import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createProgramRun, addDefinitionDayForRun, addDefinitionExerciseForDay, updateProgramRun, getTodayWorkoutDashboard } from "./program-service";
import { getOccurrences } from "./occurrences";
import { createSharedProgram } from "@/features/shared-programs/repository";
import { applySharedProgramVersion } from "@/features/shared-programs/sync";

afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
describe.each(["shared import","service helper"])("%s local start date",mode=>{
  it.each([
    {zone:"America/Los_Angeles",instant:"2026-09-06T00:30:00Z",localDate:"2026-09-05"},
    {zone:"Asia/Tokyo",instant:"2026-09-05T23:30:00Z",localDate:"2026-09-06"},
  ])("uses $zone date $localDate at $instant and preserves it on later updates",({zone,instant,localDate})=>{
    vi.stubEnv("TZ","UTC");vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(instant));
    const userId=Number(db.prepare("INSERT INTO users(email,password_hash) VALUES (?,'hash')").run(`${crypto.randomUUID()}@example.test`).lastInsertRowid);
    db.prepare("INSERT INTO user_settings(user_id,key,value) VALUES (?,'timezone',?)").run(userId,zone);
    let programId:number;
    let reapply:(()=>void)|undefined;
    if(mode==="shared import") {
      const shared=createSharedProgram({ownerUserId:userId,name:"Shared midnight",description:"Shared scheduling regression",snapshot:{schemaVersion:1,name:"Shared midnight",description:"Shared scheduling regression",numWeeks:2,days:[{key:"lower",name:"Lower",exercises:[{key:"squat",name:"Squat",category:"main",progressionType:"linear",weeks:[{weekNumber:1,intensityPct:1,reps:5,sets:3,repOutTarget:5}]}]}]}});
      const input={sharedProgramId:shared.id,userId,targetVersionId:shared.activeVersionId!,expectedMaxes:{squat:100}};
      programId=applySharedProgramVersion(input).localProgramId;
      reapply=()=>{expect(applySharedProgramVersion(input).localProgramId).toBe(programId);};
    } else {
      programId=createProgramRun({userId,name:"Helper midnight",numWeeks:2}).legacyProgramId;
      const day=addDefinitionDayForRun({userId,legacyProgramId:programId,name:"Lower"});
      addDefinitionExerciseForDay({userId,legacyDayId:day.legacyDayId,name:"Squat",trainingMax:100,category:"main",progressionType:"linear"});
    }
    // Align SQLite's native UTC metadata with fake JS time without supplying an anchor.
    const utcCreatedAt=instant.slice(0,19).replace("T"," ");
    db.prepare("UPDATE program_runs SET created_at=? WHERE id=(SELECT program_run_id FROM programs WHERE id=?)").run(utcCreatedAt,programId);
    updateProgramRun({userId,legacyProgramId:programId,scheduleWeekdays:[0,1,2,3,4,5,6]});
    const [first]=getOccurrences(userId);
    expect(first).toMatchObject({scheduled_date:localDate,original_date:localDate,day_number:1,week_number:1});
    expect(getTodayWorkoutDashboard(userId).scheduledToday).toEqual([expect.objectContaining({occurrence_id:first.id})]);
    const before=getOccurrences(userId);
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
    reapply?.();
    updateProgramRun({userId,legacyProgramId:programId,name:"Renamed later"});
    expect(db.prepare("SELECT start_date,created_at FROM program_runs WHERE id=(SELECT program_run_id FROM programs WHERE id=?)").get(programId)).toEqual({start_date:localDate,created_at:utcCreatedAt});
    expect(getOccurrences(userId).map(row=>({id:row.id,date:row.scheduled_date,original:row.original_date}))).toEqual(before.map(row=>({id:row.id,date:row.scheduled_date,original:row.original_date})));
  });
});
