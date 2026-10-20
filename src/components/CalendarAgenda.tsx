"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type Modifier } from "@dnd-kit/core";
import { ArrowRightLeft, ChevronLeft, ChevronRight, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { CalendarStatus } from "@/components/CalendarStatus";
import { CalendarDayButton } from "@/components/CalendarDayButton";
import { withCalendarReturn } from "@/features/calendar/navigation";
import { CalendarActionSheets, canMoveCalendarEvent, useCalendarActions } from "./CalendarWorkoutActions";

export type AgendaEvent = {
  key:string; date:string; title:string; href:string; programName?:string; dayName?:string;
  occurrenceId?:number; revision?:number; sessionRevision?:number; sessionId?:number; status:string; summary?:string; currentWeek?:number;
};
const button="touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold disabled:opacity-50";
const quietButton="touch-target inline-flex shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-muted active:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50";
const dateLabel=(date:string)=>new Intl.DateTimeFormat("en-US",{weekday:"short",month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`));
const plus=(date:string,days:number)=>{const result=new Date(`${date}T12:00:00Z`);result.setUTCDate(result.getUTCDate()+days);return result.toISOString().slice(0,10);};
const keepPreviewVisible:Modifier=({transform,overlayNodeRect})=>{
  if(!overlayNodeRect || typeof window==="undefined")return transform;
  return {...transform,x:Math.max(12-overlayNodeRect.left,Math.min(transform.x,window.innerWidth-overlayNodeRect.left-192-12))};
};

function Day({date,children,compact}:{date:string;children:ReactNode;compact:boolean}) {
  const {setNodeRef,isOver}=useDroppable({id:date});
  return <section ref={setNodeRef} data-calendar-date={date} className={`grid ${compact ? "grid-cols-[44px_minmax(0,1fr)_44px] gap-1 py-0.5" : "grid-cols-[2.75rem_minmax(0,1fr)] gap-3 py-2"} items-center rounded-xl border-t border-line ${isOver?"bg-brand-soft outline-2 outline-brand":""}`}>{children}</section>;
}
function DragHandle({event}:{event:AgendaEvent}) {
  const {attributes,listeners,setNodeRef,isDragging}=useDraggable({id:event.key,data:{event}});
  return <button ref={setNodeRef} {...attributes} {...listeners} aria-label={`Drag ${event.dayName} to another day`} className={`${quietButton} w-[44px] touch-none ${isDragging?"bg-brand-soft opacity-50":""}`}><GripVertical aria-hidden="true" size={18}/></button>;
}

export function CalendarAgenda({events,weekStart,today,returnTo,compact=false}:{events:AgendaEvent[];weekStart:string;today:string;returnTo?:string;compact?:boolean}) {
  const viewSuffix=compact?"":"&compact=0";
  const addLink=(date:string)=><Link prefetch={false} className={`${quietButton} w-[44px]`} href={withCalendarReturn(`/workouts/new?date=${date}`,returnTo??null)} aria-label={`Add workout on ${date}`}><Plus aria-hidden="true" size={18}/></Link>;
  const controller=useCalendarActions(events,weekStart);
  const {action,menu,busy,error,message,openMove,setMenu,setError,days}=controller;
  const [dragging,setDragging]=useState<AgendaEvent|null>(null);
  const sensors=useSensors(useSensor(MouseSensor,{activationConstraint:{distance:8}}),useSensor(TouchSensor,{activationConstraint:{delay:180,tolerance:6}}));
  return <div className={`flex flex-col ${compact ? "gap-1" : "gap-3"}`} aria-label="Weekly workout agenda">
    <nav aria-label="Week navigation" className="flex items-center justify-between gap-2">
      <Link prefetch={false} className={button} scroll={false} href={`/calendar?date=${today}${viewSuffix}`}>Today</Link>
      <div className="flex gap-2"><Link prefetch={false} className={button} aria-label="Previous week" scroll={false} href={`/calendar?month=${plus(weekStart,-7).slice(0,7)}&date=${plus(weekStart,-7)}${viewSuffix}`}><ChevronLeft aria-hidden="true" size={18}/></Link><Link prefetch={false} className={button} aria-label="Next week" scroll={false} href={`/calendar?month=${plus(weekStart,7).slice(0,7)}&date=${plus(weekStart,7)}${viewSuffix}`}><ChevronRight aria-hidden="true" size={18}/></Link></div>
    </nav>
    {message&&<p role="status" className="rounded-xl border border-success-line bg-success-soft p-3 text-sm text-success-ink">{message}</p>}
    {error&&!action&&!menu&&<p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger-ink">{error}</p>}
    <p className="sr-only">Hold a grip to drag between days, or use Move to choose a date.</p>
    <DndContext id={`calendar-${weekStart}`} sensors={sensors} onDragStart={({active})=>setDragging(active.data.current?.event as AgendaEvent)} onDragCancel={()=>setDragging(null)} onDragEnd={({active,over})=>{setDragging(null);const event=active.data.current?.event as AgendaEvent|undefined;if(event&&over&&over.id!==event.date)void openMove(event,String(over.id));}}>
      {days.map(date=>{
        const dayEvents=events.filter(event=>event.date===date);
        return <Day date={date} key={date} compact={compact}>
        <div className="flex flex-col items-center gap-1"><time dateTime={date} aria-label={dateLabel(date)} className={`flex w-11 flex-col items-center rounded-xl ${date===today?"bg-brand-soft text-brand-strong":"text-muted"}`}><span className="text-xs font-semibold leading-3">{new Intl.DateTimeFormat("en-US",{weekday:"short",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`))}</span><span className="font-display text-2xl font-bold leading-7">{Number(date.slice(-2))}</span></time>{!compact&&addLink(date)}</div>
        <div className="flex min-w-0 flex-col gap-2">{compact && dayEvents.length > 1 ? <CalendarDayButton date={date} events={dayEvents.map(event=>({...event,href:`${event.href}&date=${date}${viewSuffix}`}))} returnTo={returnTo} disabled={busy}
          className="card touch-target flex min-w-0 items-center gap-2 px-2 py-1 text-left focus-visible:outline-2 focus-visible:outline-brand"
          onOptions={key=>{const event=dayEvents.find(value=>value.key===key);if(event){setError("");setMenu(event);}}}>
          <CalendarStatus status={dayEvents[0].status}/><span className="display min-w-0 flex-1 break-words text-lg leading-5 line-clamp-2">{dayEvents[0].dayName||"Quick workout"}</span><span className="shrink-0 text-xs font-semibold text-muted">+{dayEvents.length-1}</span>
        </CalendarDayButton> : dayEvents.map(event=><article className={`card min-w-0 ${compact?"px-1":"p-3"}`} key={event.key} data-occurrence-id={event.occurrenceId}>
          <div className={`flex ${compact?"items-center gap-1":"items-start gap-2"}`}>
            <Link prefetch={false} href={`${event.href}&date=${date}${viewSuffix}`} scroll={false} aria-label={`${event.title} on ${date}`} className={`touch-target min-w-0 flex-1 ${compact?"flex items-center gap-2":""}`}>
              {compact&&<CalendarStatus status={event.status}/>}
              {!compact&&<p className="truncate text-xs font-medium text-muted">{event.programName||"Workout"}{event.currentWeek?` · Week ${event.currentWeek}`:""}</p>}
              <h4 className={`display break-words ${compact?"min-w-0 text-lg leading-5 line-clamp-2":"mt-0.5 text-2xl"}`}>{event.dayName||"Quick workout"}</h4>
              {!compact&&<p className={`mt-1 text-xs font-semibold ${event.status==="completed"?"text-success-ink":event.status==="skipped"?"text-muted":"text-brand-strong"}`}>{event.status==="completed"?"Completed":event.status==="skipped"?"Skipped":event.status==="in_progress"?"In progress":date<today?"Overdue":"Scheduled"}</p>}
              {!compact&&event.summary&&<p className="mt-2 line-clamp-2 text-sm leading-5 text-muted">{event.summary}</p>}
            </Link>
            {canMoveCalendarEvent(event)&&<DragHandle event={event}/>}
            {compact&&event.occurrenceId&&<button className={`${quietButton} w-[44px]`} disabled={busy} onClick={()=>{setError("");setMenu(event);}}><MoreHorizontal aria-hidden="true" size={18}/><span className="sr-only">More options for {event.dayName}</span></button>}
          </div>
          {!compact&&event.occurrenceId&&<div className="mt-2 flex items-center gap-2">{canMoveCalendarEvent(event)&&<button className={button} disabled={busy} onClick={()=>{void openMove(event);}}><ArrowRightLeft size={16}/>Move</button>}<button className={button} disabled={busy} onClick={()=>{setError("");setMenu(event);}}><MoreHorizontal aria-hidden="true" size={18}/><span className="sr-only">More options for {event.dayName}</span></button></div>}
        </article>)}{dayEvents.length===0&&<p className={`flex ${compact?"min-h-11":"min-h-22"} items-center px-1 text-sm text-muted`}>Rest day</p>}</div>
        {compact&&addLink(date)}
      </Day>})}
      <DragOverlay style={{width:192}} modifiers={[keepPreviewVisible]}>{dragging?<div data-drag-preview className="w-48 rounded-xl border border-brand-line bg-brand-soft p-3 shadow-xl"><p className="text-xs text-muted">Move workout</p><p className="display text-2xl">{dragging.dayName}</p></div>:null}</DragOverlay>
    </DndContext>
    <CalendarActionSheets controller={controller}/>

  </div>;
}
