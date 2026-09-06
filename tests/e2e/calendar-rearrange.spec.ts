import { test, expect, type Page, type Locator } from "@playwright/test";
import { registerViaApi } from "./helpers";

async function fixture(page:Page) {
  await registerViaApi(page,"calendar-rearrange");
  const program=await(await page.request.post("/api/programs",{data:{name:"Calendar strength",numWeeks:2}})).json();
  for(const [name,lift] of [["Lower","Squat"],["Upper","Bench Press"]]) {
    const day=await(await page.request.post(`/api/programs/${program.id}/days`,{data:{name}})).json();
    expect((await page.request.post(`/api/days/${day.id}/exercises`,{data:{name:lift,trainingMax:200,progressionType:"linear"}})).ok()).toBe(true);
  }
  expect((await page.request.put(`/api/programs/${program.id}`,{data:{scheduleWeekdays:[0,1,2,3,4,5,6],startDate:"2090-06-05"}})).ok()).toBe(true);
  await page.goto("/calendar?month=2090-06&date=2090-06-05");
  await expect(page.getByRole("heading",{name:"Week",exact:true})).toBeVisible();
}
async function dispatchTouch(handle:Locator,type:"touchstart"|"touchmove"|"touchend",point:{x:number;y:number}) {
  await handle.evaluate((element,{type,point})=>{
    const touch={identifier:1,target:element,clientX:point.x,clientY:point.y};
    let event:TouchEvent;
    // Chromium exposes the constructor; WebKit exposes createEvent instead.
    try { event=new TouchEvent(type,{bubbles:true,cancelable:true}); }
    catch { event=document.createEvent("TouchEvent");event.initEvent(type,true,true); }
    Object.defineProperties(event,{touches:{value:type==="touchend"?[]:[touch]},changedTouches:{value:[touch]}});
    element.dispatchEvent(event);
  },{type,point});
}
test("Calendar move/swap, reload undo, duplicate, skip, group preview and each-day Add",async({page},info)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  page.on("console",entry=>{if(entry.type()==="error")errors.push(entry.text());});
  await fixture(page);
  const day=(date:string)=>page.locator(`[data-calendar-date="${date}"]`);
  const first=day("2090-06-05").locator("article");
  const id=await first.getAttribute("data-occurrence-id");
  await expect(first.getByRole("heading",{name:"Lower",exact:true})).toBeVisible();
  await expect(first.getByText(/Squat/)).toHaveCount(0);
  const more=first.getByRole("button",{name:"More options for Lower"});
  const box=await more.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({path:info.outputPath("calendar-week-light.png"),fullPage:true,animations:"disabled"});
  // Three taps choose a date; an occupied date adds an explicit collision choice.
  await more.click();
  await page.getByRole("dialog").getByRole("button",{name:"Move",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Tue, Jun 6",exact:true}).click();
  await expect(page.getByRole("dialog").getByText(/already has Upper/)).toBeVisible();
  await page.screenshot({path:info.outputPath("calendar-occupied-choice.png"),animations:"disabled"});
  await page.getByRole("button",{name:"Swap with Upper",exact:true}).click();
  await expect(day("2090-06-06").locator(`[data-occurrence-id="${id}"]`)).toBeVisible();
  await page.reload();
  await page.getByRole("button",{name:"Undo last change"}).click();
  await expect(day("2090-06-05").locator(`[data-occurrence-id="${id}"]`)).toBeVisible();
  await first.getByRole("button",{name:"More options for Lower"}).click();
  await page.getByRole("button",{name:"Duplicate workout"}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Fri, Jun 9",exact:true}).click();
  await expect(day("2090-06-09").getByRole("heading",{name:"Lower",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Undo last change"}).click();
  await expect(day("2090-06-09").locator("article")).toHaveCount(0);
  await first.getByRole("button",{name:"More options for Lower"}).click();
  await page.getByRole("button",{name:"Skip this workout"}).click();
  await expect(first.getByRole("link",{name:"Skipped: Calendar strength - Lower on 2090-06-05",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Undo last change"}).click();
  await expect(first.getByRole("link",{name:"Scheduled: Calendar strength - Lower on 2090-06-05",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Select workouts",exact:true}).click();
  await page.getByRole("checkbox",{name:"Select Lower on 2090-06-05"}).check();
  await page.getByRole("checkbox",{name:"Select Upper on 2090-06-06"}).check();
  await page.getByRole("button",{name:"Shift 2 selected"}).click();
  await page.getByRole("button",{name:"Preview shift"}).click();
  await expect(page.getByRole("dialog").getByText("Mon, Jun 5 → Mon, Jun 12")).toBeVisible();
  await page.screenshot({path:info.outputPath("calendar-shift-preview.png"),animations:"disabled"});
  await page.getByRole("button",{name:"Confirm shift"}).click();
  await expect(first).toHaveCount(0);
  await page.getByRole("button",{name:"Undo last change"}).click();
  await expect(first).toBeVisible();
  await page.evaluate(()=>{document.documentElement.dataset.theme="dark";});
  await page.screenshot({path:info.outputPath("calendar-week-dark.png"),fullPage:true,animations:"disabled"});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(page.getByRole("link",{name:"Add workout on 2090-06-05"})).toHaveAttribute("href","/workouts/new?date=2090-06-05&returnTo=%2Fcalendar%3Fmonth%3D2090-06%26date%3D2090-06-05");
  expect(errors).toEqual([]);
});

test("Calendar touch drag offers the same explicit occupied-date choice",async({page},info)=>{
  await fixture(page);
  const day=page.locator('[data-calendar-date="2090-06-05"]');
  await day.evaluate(element=>element.scrollIntoView({block:"start"}));
  const handle=day.getByRole("button",{name:"Drag Lower to another day"});
  const from=await handle.boundingBox();
  const to=await page.locator('[data-calendar-date="2090-06-06"]').boundingBox();
  const start={x:from!.x+from!.width/2,y:from!.y+from!.height/2};
  const end={x:start.x,y:to!.y+20};
  await dispatchTouch(handle,"touchstart",start);
  await expect(handle).toHaveAttribute("aria-pressed","true");
  await dispatchTouch(handle,"touchmove",end);
  const dragPreview=await page.locator("[data-drag-preview]").boundingBox();
  expect(dragPreview!.x).toBeGreaterThanOrEqual(0);
  expect(dragPreview!.x+dragPreview!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({path:info.outputPath("calendar-touch-drag.png")});
  await dispatchTouch(handle,"touchend",end);
  await expect(page.getByRole("dialog").getByRole("button",{name:"Swap with Upper"})).toBeVisible();
  // The library deliberately suppresses synthetic post-touch clicks for 50ms.
  // Model the next separate human tap, rather than that browser-generated click.
  await page.waitForTimeout(60);
  await page.getByRole("button",{name:"Move here · keep both"}).click();
  await expect(page.locator('[data-calendar-date="2090-06-06"]').locator("article")).toHaveCount(2);
});

test("Calendar retry keeps the same command ID after a lost save response",async({page})=>{
  await fixture(page);
  const requests:string[]=[];
  await page.route("**/api/calendar/actions",async route=>{
    requests.push(route.request().postDataJSON().requestKey);
    if(requests.length===1){expect((await route.fetch()).ok()).toBe(true);await route.abort("failed");}else await route.continue();
  });
  await page.locator('[data-calendar-date="2090-06-05"]').getByRole("button",{name:"More options for Lower"}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Move",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Fri, Jun 9",exact:true}).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByRole("dialog").getByRole("button",{name:"Fri, Jun 9",exact:true}).click();
  await expect(page.locator('[data-calendar-date="2090-06-09"]').getByRole("heading",{name:"Lower",exact:true})).toBeVisible();
  expect(requests).toHaveLength(2);expect(requests[0]).toBe(requests[1]);
});

test("Calendar Add returns to the selected week and departure scroll",async({page},info)=>{
  await fixture(page);
  const returnTo="/calendar?month=2090-06&date=2090-06-05";
  const add=page.getByRole("link",{name:"Add workout on 2090-06-11"});
  await add.scrollIntoViewIfNeeded();
  // Hydration can reveal the iPhone install hint after scrolling into view.
  // Capture the actual departure tap, including any browser click positioning.
  await add.evaluate(link=>link.addEventListener("click",()=>sessionStorage.setItem("e2e.calendar.departureScroll",String(window.scrollY)),{once:true}));
  await add.click();
  const recorded=await page.evaluate(()=>sessionStorage.getItem("e2e.calendar.departureScroll"));
  expect(recorded).not.toBeNull();
  const before=Number(recorded);
  if(info.project.name==="mobile-safari")expect(before).toBeGreaterThan(0);
  await expect(page.getByLabel("Workout date",{exact:true})).toHaveValue("2090-06-11");
  await page.getByRole("link",{name:"Back to Calendar"}).click();
  await expect(page).toHaveURL(returnTo);
  await expect.poll(async()=>Math.abs(await page.evaluate(()=>window.scrollY)-before)).toBeLessThan(3);
});

test("Calendar repeat keeps the original and returns from the new workout to its source week",async({page})=>{
  await fixture(page);
  const created=await page.request.post("/api/sessions",{data:{name:"Sunday extra",date:"2090-06-11",newWorkout:true,requestKey:crypto.randomUUID()}});
  expect(created.ok()).toBe(true);const session=await created.json();
  const added=await page.request.post(`/api/sessions/${session.id}/sets`,{data:{name:"Row",sets:1,reps:10,weight:40,requestKey:crypto.randomUUID()}});
  expect(added.ok()).toBe(true);const set=(await added.json()).sets[0];
  expect((await page.request.put(`/api/sessions/${session.id}/sets`,{data:{setId:set.id,actualReps:10,actualWeight:40}})).ok()).toBe(true);
  expect((await page.request.patch(`/api/sessions/${session.id}`)).ok()).toBe(true);
  await page.reload();
  await page.locator('[data-calendar-date="2090-06-11"]').locator("article a").click();
  const dialog=page.getByRole("dialog");
  await expect(dialog.getByText(/400 lb/).first()).toBeVisible();
  await dialog.getByLabel("Repeat workout date").fill("2090-06-12");
  const before=await page.evaluate(()=>window.scrollY);
  await dialog.getByRole("button",{name:"Repeat workout",exact:true}).click();
  await expect(page).toHaveURL(/\/workouts\/\d+\?returnTo=/);
  const repeatedId=Number(new URL(page.url()).pathname.split("/").at(-1));
  expect(repeatedId).not.toBe(session.id);
  await page.getByRole("link",{name:"Back to Calendar"}).click();
  await expect(page).toHaveURL("/calendar?month=2090-06&date=2090-06-11");
  await expect.poll(async()=>Math.abs(await page.evaluate(()=>window.scrollY)-before)).toBeLessThan(3);
  const original=await(await page.request.get(`/api/sessions/${session.id}`)).json();
  expect(original.status).toBe("completed");expect(original.sets[0].actual_reps).toBe(10);
  await page.getByRole("link",{name:"Next week",exact:true}).click();
  await page.locator('[data-calendar-date="2090-06-12"]').locator("article a").click();
  await page.getByRole("link",{name:"Resume workout",exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/workouts/${repeatedId}\\?returnTo=`));
});

test("Week uses one compact header and opens workout details, with a separate Month grid",async({page},info)=>{
  await fixture(page);
  const switcher=page.getByRole("navigation",{name:"Calendar view"});
  await expect(switcher.getByRole("link",{name:"Week",exact:true})).toHaveAttribute("aria-current","page");
  await expect(page.getByRole("region",{name:"Month calendar",exact:true})).toHaveCount(0);
  const lower=page.locator('[data-calendar-date="2090-06-05"]');
  await expect(lower.getByText(/Squat/)).toHaveCount(0);
  await expect(lower.getByText("Calendar strength",{exact:true})).toHaveCount(0);
  await expect(lower.getByText("Scheduled",{exact:true})).toHaveCount(0);
  await expect(lower.getByRole("heading",{name:"Lower",exact:true})).toBeVisible();
  await expect(page.getByRole("heading", {name:"Week", exact:true})).toBeVisible();
  await expect(page.getByRole("link", {name:/^(Previous|Next) month$/})).toHaveCount(0);
  await expect(page.getByRole("link", {name:"Expand details", exact:true})).toHaveCount(0);
  await lower.locator("article a").click();
  await expect(page.getByRole("dialog")).toContainText("Squat");
  await page.getByRole("link", {name:"Close workout", exact:true}).click();
  expect((await page.locator('[data-calendar-date="2090-06-10"]').boundingBox())!.height).toBeLessThan(75);
  await lower.getByRole("button",{name:"More options for Lower"}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Move",exact:true}).click();
  await expect(page.getByRole("dialog").getByRole("button",{name:"Tue, Jun 6",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Close calendar action"}).click();
  await page.reload();
  await expect(page.getByRole("link",{name:"Expand details",exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath("calendar-week-collapsed-light.png"),fullPage:true,animations:"disabled"});
  await page.screenshot({path:info.outputPath("calendar-header-viewport.png"),animations:"disabled"});
  await switcher.getByRole("link",{name:"Month",exact:true}).click();
  const month=page.getByRole("region",{name:"Month calendar",exact:true});
  await expect(month).toBeVisible();
  await expect(page.getByRole("region",{name:"Week calendar",exact:true})).toHaveCount(0);
  const date=month.getByRole("link",{name:"See week containing 2090-06-06"});
  const box=await date.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
  await month.getByRole("link",{name:"Scheduled: Calendar strength - Lower on 2090-06-05",exact:true}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("link",{name:"Close workout",exact:true}).click();
  await expect(switcher.getByRole("link",{name:"Month",exact:true})).toHaveAttribute("aria-current","page");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({path:info.outputPath("calendar-month-light.png"),fullPage:true,animations:"disabled"});
  await page.evaluate(()=>{document.documentElement.dataset.theme="dark";document.documentElement.style.fontSize="20px";});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("calendar-month-dark-large.png"),fullPage:true,animations:"disabled"});
  await date.click();
  await expect(switcher.getByRole("link",{name:"Week",exact:true})).toHaveAttribute("aria-current","page");
  await expect(page).toHaveURL("/calendar?month=2090-06&date=2090-06-06");
  await expect(page.getByRole("link",{name:"Expand details",exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(await lower.getByRole("heading",{name:"Lower",exact:true}).evaluate(heading=>heading.getBoundingClientRect().height/parseFloat(getComputedStyle(heading).lineHeight))).toBeLessThanOrEqual(1.1);
  await page.screenshot({path:info.outputPath("calendar-week-collapsed-dark-large.png"),fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"Select workouts",exact:true}).click();
  const more=lower.getByRole("button",{name:"More options for Lower"});
  expect(await more.evaluate(button=>{
    const card=button.closest("article")!;
    return button.getBoundingClientRect().right-(card.getBoundingClientRect().right-parseFloat(getComputedStyle(card).paddingRight));
  })).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath("calendar-week-collapsed-selection-dark-large.png"),fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"Cancel selection",exact:true}).click();
  await page.goto("/calendar?month=2090-06&date=2090-06-30");
  await page.getByRole("link", {name:"Next week", exact:true}).click();
  await expect(page).toHaveURL("/calendar?month=2090-07&date=2090-07-03");
  await switcher.getByRole("link", {name:"Month", exact:true}).click();
  await expect(page.getByRole("heading", {name:"July 2090", exact:true})).toBeVisible();
});

test("Calendar context survives resuming a manual planned session by its exact ID",async({page})=>{
  await registerViaApi(page,"calendar-manual-resume");
  const program=await(await page.request.post("/api/programs",{data:{name:"Manual strength",numWeeks:2}})).json();
  const day=await(await page.request.post(`/api/programs/${program.id}/days`,{data:{name:"Bench, Deadlift"}})).json();
  expect((await page.request.post(`/api/days/${day.id}/exercises`,{data:{name:"Bench Press",trainingMax:200,progressionType:"linear"}})).ok()).toBe(true);
  const started=await page.request.post(`/api/programs/${program.id}/sessions`,{data:{dayId:day.id}});
  expect(started.ok()).toBe(true);const session=await started.json();
  expect(session.occurrence_id).toBeNull();
  const returnTo=`/calendar?month=${session.date.slice(0,7)}&date=${session.date}&view=month`;
  await page.goto(returnTo);
  await page.getByRole("region",{name:"Month calendar",exact:true}).getByRole("link",{name:`In progress: Manual strength - Bench, Deadlift on ${session.date}`,exact:true}).click();
  await page.getByRole("link",{name:"Resume workout",exact:true}).click();
  await page.getByRole("link",{name:"Resume planned workout",exact:true}).click();
  await expect(page).toHaveURL(`/workouts/${session.id}/resume?returnTo=${encodeURIComponent(returnTo)}`);
  await expect(page.getByRole("button",{name:"Log Set",exact:true})).toBeVisible();
  await page.getByRole("link",{name:"Workout details"}).click();
  await page.getByRole("link",{name:"Back to Calendar"}).click();
  await expect(page).toHaveURL(returnTo);
  expect((await(await page.request.get(`/api/programs/${program.id}/sessions`)).json()).map((row:{id:number})=>row.id)).toEqual([session.id]);
});
