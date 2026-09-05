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
  await expect(page.getByRole("heading",{name:"June 2090",exact:true})).toBeVisible();
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
  await expect(first.getByText(/Squat/)).toBeVisible();
  const move=first.getByRole("button",{name:"Move",exact:true});
  const box=await move.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({path:info.outputPath("calendar-week-light.png"),fullPage:true,animations:"disabled"});
  // Three taps: Move, target date, explicit Swap.
  await move.click();
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
  await expect(first.getByText("Skipped",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Undo last change"}).click();
  await expect(first.getByText("Scheduled",{exact:true})).toBeVisible();
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
  await expect(page.getByRole("link",{name:"Add workout on 2090-06-05"})).toHaveAttribute("href","/workouts/new?date=2090-06-05");
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
    if(requests.length===1){await route.fetch();await route.abort("failed");}else await route.continue();
  });
  await page.locator('[data-calendar-date="2090-06-05"]').getByRole("button",{name:"Move",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Fri, Jun 9",exact:true}).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("dialog").getByRole("button",{name:"Fri, Jun 9",exact:true}).click();
  await expect(page.locator('[data-calendar-date="2090-06-09"]').getByRole("heading",{name:"Lower",exact:true})).toBeVisible();
  expect(requests).toHaveLength(2);expect(requests[0]).toBe(requests[1]);
});
