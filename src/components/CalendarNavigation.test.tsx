// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarNavigation } from "./CalendarNavigation";
import { StrictMode } from "react";
import { calendarReturnHref, withCalendarReturn } from "@/features/calendar/navigation";
afterEach(()=>{cleanup();sessionStorage.clear();vi.restoreAllMocks();});
it("keeps only a local Calendar date/month return target",()=>{
  expect(calendarReturnHref("/calendar?month=2090-07&date=2090-07-03&workout=occurrence-1")).toBe("/calendar?month=2090-07&date=2090-07-03");
  for(const url of ["https://evil.example/calendar","//evil.example/calendar","javascript:alert(1)","/workouts","/calendar?date=2090-02-30"]) expect(calendarReturnHref(url)).toBeNull();
  expect(withCalendarReturn("/workouts/new?date=2090-07-04","/calendar?month=2090-07&date=2090-07-03")).toBe("/workouts/new?date=2090-07-04&returnTo=%2Fcalendar%3Fmonth%3D2090-07%26date%3D2090-07-03");
  expect(calendarReturnHref("/calendar?view=month&compact=1&date=2090-07-03&workout=history-3")).toBe("/calendar?month=2090-07&date=2090-07-03&view=month");
  expect(calendarReturnHref("/calendar?view=month&compact=0&date=2090-07-03&workout=history-3")).toBe("/calendar?month=2090-07&date=2090-07-03&view=month&compact=0");
});
it("keeps the saved position when StrictMode cancels the initial animation frame",()=>{
  const returnTo="/calendar?month=2090-07&date=2090-07-03";
  window.history.replaceState({},"",returnTo);
  sessionStorage.setItem(`magni.calendar.scroll:${returnTo}`,"745");
  const frames=new Map<number,FrameRequestCallback>();let next=0;
  vi.spyOn(window,"requestAnimationFrame").mockImplementation(callback=>{frames.set(++next,callback);return next;});
  vi.spyOn(window,"cancelAnimationFrame").mockImplementation(id=>{frames.delete(id);});
  const scroll=vi.spyOn(window,"scrollTo").mockImplementation(()=>{});
  render(<StrictMode><CalendarNavigation returnTo={returnTo}/></StrictMode>);
  for(const callback of frames.values()) callback(0);
  expect(scroll).toHaveBeenCalledWith({top:745,left:0,behavior:"instant"});
  expect(sessionStorage.getItem(`magni.calendar.scroll:${returnTo}`)).toBeNull();
});
it("restores the departure scroll once when returning to that selected week and date",()=>{
  const returnTo="/calendar?month=2090-07&date=2090-07-03";
  window.history.replaceState({},"",returnTo);
  vi.spyOn(window,"scrollY","get").mockReturnValue(745);
  vi.spyOn(window,"requestAnimationFrame").mockImplementation(callback=>{callback(0);return 1;});
  const scroll=vi.spyOn(window,"scrollTo").mockImplementation(()=>{});
  const view=render(<><CalendarNavigation returnTo={returnTo}/><a href={withCalendarReturn("/workouts/new?date=2090-07-04",returnTo)} onClick={event=>event.preventDefault()}>Add</a></>);
  fireEvent.click(view.getByText("Add"));view.unmount();
  const other=render(<CalendarNavigation returnTo="/calendar?month=2090-08&date=2090-08-01"/>);
  expect(scroll).not.toHaveBeenCalled();other.unmount();
  const returned=render(<CalendarNavigation returnTo={returnTo}/>);
  expect(scroll).toHaveBeenCalledWith({top:745,left:0,behavior:"instant"});returned.unmount();
  render(<CalendarNavigation returnTo={returnTo}/>);
  expect(scroll).toHaveBeenCalledTimes(1);
});
