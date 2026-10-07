import fs from "node:fs";import os from "node:os";import path from "node:path";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
const cookie=vi.hoisted(()=>({token:""}));vi.mock("next/headers",()=>({cookies:async()=>({get:(name:string)=>name==="auth_token"&&cookie.token?{value:cookie.token}:undefined})}));
let database:typeof import("@/lib/db");let auth:typeof import("@/lib/auth");let history:typeof import("@/features/workouts/history-service");
let exercises:typeof import("@/app/api/progress/exercises/route");let changes:typeof import("@/app/api/progress/identity/route");let pins:typeof import("@/app/api/progress/pins/route");let dir:string;let userId:number;let id:number;
beforeAll(async()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),"progress-routes-"));vi.stubEnv("DB_PATH",path.join(dir,"test.sqlite"));
database=await import("@/lib/db");auth=await import("@/lib/auth");history=await import("@/features/workouts/history-service");exercises=await import("@/app/api/progress/exercises/route");changes=await import("@/app/api/progress/identity/route");pins=await import("@/app/api/progress/pins/route");
userId=Number(database.db.prepare("INSERT INTO users(email,password_hash) VALUES ('progress-route@example.test','hash')").run().lastInsertRowid);
const session=history.createQuickSession({userId,newWorkout:true}).session;const added=history.addQuickExercise({userId,sessionId:session.id,name:"Route row",sets:[{reps:10,weight:40}]});id=added.sets[0].id;
history.saveActualSet({userId,sessionId:session.id,setId:id,actualReps:10,actualWeight:40});history.finishQuickSession(userId,session.id);});
afterAll(()=>{database?.db.close();if(dir)fs.rmSync(dir,{recursive:true,force:true});vi.unstubAllEnvs();});
const post=(body:unknown,origin="http://localhost")=>new Request("http://localhost/api/progress/identity",{method:"POST",headers:{"Content-Type":"application/json",origin},body:JSON.stringify(body)});
it("requires auth and validates filters before scoped reads",async()=>{
cookie.token="";expect((await exercises.GET(new Request("http://localhost/api/progress/exercises"))).status).toBe(401);
cookie.token=auth.createSession(userId).token;
expect((await exercises.GET(new Request("http://localhost/api/progress/exercises?from=2026-02-31"))).status).toBe(400);
const response=await exercises.GET(new Request("http://localhost/api/progress/exercises?q=Route"));expect(response.status).toBe(200);expect((await response.json()).items).toHaveLength(1);
});
it("requires same origin, selected observations and fresh preview for mutation",async()=>{
cookie.token=auth.createSession(userId).token;
expect((await changes.POST(post({action:"preview",observationIds:[id],name:"Followed"},"https://other.test"))).status).toBe(403);
expect((await changes.POST(post({action:"apply",requestKey:crypto.randomUUID()}))).status).toBe(400);
const input={observationIds:[id],name:"Followed"};const preview=await (await changes.POST(post({action:"preview",...input}))).json();
const applied=await changes.POST(post({action:"apply",...input,previewToken:preview.token,requestKey:crypto.randomUUID()}));expect(applied.status).toBe(200);
const result=await applied.json();expect((await pins.POST(post({exerciseId:result.targetExerciseId,pinned:true}))).status).toBe(200);
expect((await changes.POST(post({action:"undo",changeId:result.changeId,requestKey:crypto.randomUUID()}))).status).toBe(200);
});
