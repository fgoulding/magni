// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarAgenda, type AgendaEvent } from "./CalendarAgenda";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("next/link",()=>({default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
const source:AgendaEvent={key:"occurrence-1",occurrenceId:1,revision:1,date:"2090-06-05",title:"Lower",dayName:"Lower",href:"/calendar?workout=occurrence-1",status:"scheduled"};
beforeEach(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};vi.stubGlobal("fetch",vi.fn());});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("Calendar occupied-date choices",()=>{
  it("collapses workout descriptions while retaining names and rearrangement actions",()=>{
    render(<CalendarAgenda compact weekStart="2090-06-05" today="2090-06-05" events={[{...source,programName:"Build program",summary:"Squat 3 by 5 at 200 lb"}]}/>);
    expect(screen.getByText("Lower")).toBeTruthy();
    expect(screen.queryByText("Build program")).toBeNull();
    expect(screen.queryByText("Squat 3 by 5 at 200 lb")).toBeNull();
    expect(screen.queryByText("Scheduled")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"More options for Lower"}));
    expect(screen.getByRole("button",{name:"Move"})).toBeTruthy();
    expect(screen.getByRole("button",{name:"Drag Lower to another day"})).toBeTruthy();
  });
  it.each(["completed","skipped","in_progress"])("discloses %s unplanned history before writing and offers no unavailable swap",status=>{
    render(<CalendarAgenda weekStart="2090-06-05" today="2090-06-05" events={[source,{key:"history-2",date:"2090-06-06",title:"Independent",dayName:"Independent",status,href:"/calendar?workout=history-2"}]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Move"}));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Tue, Jun 6"}));
    expect(within(screen.getByRole("dialog")).getByText(/already has Independent/)).toBeTruthy();
    expect(screen.queryByRole("button",{name:/Swap with/})).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button",{name:"Move here · keep both"})).toBeTruthy();
  });
  it("offers swap only for an unstarted scheduled occurrence among all workouts on the date",()=>{
    render(<CalendarAgenda weekStart="2090-06-05" today="2090-06-05" events={[source,...["scheduled","in_progress","completed","skipped"].map((status,index)=>({...source,key:`occurrence-${index+2}`,occurrenceId:index+2,date:"2090-06-06",dayName:status,status}))]}/>);
    fireEvent.click(screen.getAllByRole("button",{name:"Move"})[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Tue, Jun 6"}));
    expect(screen.getAllByRole("button",{name:/Swap with/}).map(button=>button.textContent)).toEqual(["Swap with scheduled"]);
    expect(within(screen.getByRole("dialog")).getByText(/already has scheduled, in_progress, completed, skipped/)).toBeTruthy();
  });
});
