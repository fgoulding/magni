"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type Modifier } from "@dnd-kit/core";
import { ArrowRightLeft, ChevronLeft, ChevronRight, Copy, GripVertical, MoreHorizontal, Plus, X } from "lucide-react";
import { withCalendarReturn } from "@/features/calendar/navigation";
import type { CalendarConflict } from "@/features/calendar/calendar-service";

export type AgendaEvent = {
  key:string; date:string; title:string; href:string; programName?:string; dayName?:string;
  occurrenceId?:number; revision?:number; status:string; summary?:string; currentWeek?:number;
};
const button="touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold disabled:opacity-50";
const dateLabel=(date:string)=>new Intl.DateTimeFormat("en-US",{weekday:"short",month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`));
const plus=(date:string,days:number)=>{const result=new Date(`${date}T12:00:00Z`);result.setUTCDate(result.getUTCDate()+days);return result.toISOString().slice(0,10);};
const keepPreviewVisible:Modifier=({transform,overlayNodeRect})=>{
  if(!overlayNodeRect || typeof window==="undefined")return transform;
  return {...transform,x:Math.max(12-overlayNodeRect.left,Math.min(transform.x,window.innerWidth-overlayNodeRect.left-192-12))};
};

function Sheet({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} onCancel={onClose} aria-label={title} className="m-auto max-h-[85dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-4 text-foreground backdrop:bg-foreground/40">
    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="display text-2xl">{title}</h2><button className={button} onClick={onClose} aria-label="Close calendar action"><X size={18}/></button></div>{children}
  </dialog>;
}
function Day({date,children,compact}:{date:string;children:ReactNode;compact:boolean}) {
  const {setNodeRef,isOver}=useDroppable({id:date});
  return <section ref={setNodeRef} data-calendar-date={date} className={`grid ${compact ? "grid-cols-[44px_minmax(0,1fr)_44px] gap-2" : "grid-cols-[2.75rem_minmax(0,1fr)] gap-3"} items-start rounded-xl border-t border-line py-2 ${isOver?"bg-brand-soft outline-2 outline-brand":""}`}>{children}</section>;
}
function DragHandle({event}:{event:AgendaEvent}) {
  const {attributes,listeners,setNodeRef,isDragging}=useDraggable({id:event.key,data:{event}});
  return <button ref={setNodeRef} {...attributes} {...listeners} aria-label={`Drag ${event.dayName} to another day`} className={`${button} w-[44px] shrink-0 touch-none px-0 text-muted ${isDragging?"bg-brand-soft opacity-50":""}`}><GripVertical size={18}/></button>;
}

export function CalendarAgenda({events,weekStart,today,returnTo,compact=false}:{events:AgendaEvent[];weekStart:string;today:string;returnTo?:string;compact?:boolean}) {
  const router=useRouter();
  const viewSuffix=compact?"":"&compact=0";
  const addLink=(date:string)=><Link prefetch={false} className={`${button} px-0 text-muted`} href={withCalendarReturn(`/workouts/new?date=${date}`,returnTo??null)} aria-label={`Add workout on ${date}`}><Plus aria-hidden="true" size={18}/></Link>;
  const [action,setAction]=useState<{event:AgendaEvent;type:"move"|"duplicate";date:string;conflicts?:CalendarConflict[]}|null>(null);
  const [menu,setMenu]=useState<AgendaEvent|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [dragging,setDragging]=useState<AgendaEvent|null>(null);
  const command=useRef<{body:string;requestKey:string}|null>(null);
  const sensors=useSensors(useSensor(MouseSensor,{activationConstraint:{distance:8}}),useSensor(TouchSensor,{activationConstraint:{delay:180,tolerance:6}}));
  const days=Array.from({length:7},(_,index)=>plus(weekStart,index));
  const close=()=>{if(!busy){setAction(null);setMenu(null);setError("");}};
  async function send(body:Record<string,unknown>) {
    if(busy) return null;
    const serialized=JSON.stringify(body);
    if(command.current?.body!==serialized) command.current={body:serialized,requestKey:crypto.randomUUID()};
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/calendar/actions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,requestKey:command.current.requestKey})});
      const result=await response.json();
      if(!response.ok) {
        if(result.conflicts && action) setAction({...action,conflicts:result.conflicts});
        throw new Error(result.error||"Calendar change could not be saved.");
      }
      command.current=null;
      setMessage("Calendar saved. Workout details stayed with their workout.");
      setAction(null);setMenu(null);
      router.refresh();
      return result;
    } catch(caught) {setError(caught instanceof Error?caught.message:"Connection lost. Try again to safely retry this change.");return null;}
    finally {setBusy(false);}
  }
  function chooseDate(event:AgendaEvent,type:"move"|"duplicate",date:string) {
    const conflicts=events.filter(value=>(type==="duplicate"||value.key!==event.key) && value.date===date)
      .map(value=>({key:value.key,id:value.occurrenceId??null,date:value.date,name:value.dayName||"Workout",revision:value.revision??0,canSwap:!!value.occurrenceId&&value.status==="scheduled"}));
    if(conflicts.length) {setAction({event,type,date,conflicts});return;}
    void send({type,occurrenceId:event.occurrenceId,revision:event.revision,date});
  }
  return <div className="flex flex-col gap-3" aria-label="Weekly workout agenda">
    <nav aria-label="Week navigation" className="flex items-center justify-between gap-2">
      <Link prefetch={false} className={button} scroll={false} href={`/calendar?date=${today}${viewSuffix}`}>Today</Link>
      <div className="flex gap-2"><Link prefetch={false} className={button} aria-label="Previous week" scroll={false} href={`/calendar?month=${plus(weekStart,-7).slice(0,7)}&date=${plus(weekStart,-7)}${viewSuffix}`}><ChevronLeft aria-hidden="true" size={18}/></Link><Link prefetch={false} className={button} aria-label="Next week" scroll={false} href={`/calendar?month=${plus(weekStart,7).slice(0,7)}&date=${plus(weekStart,7)}${viewSuffix}`}><ChevronRight aria-hidden="true" size={18}/></Link></div>
    </nav>
    {message&&<p role="status" className="rounded-xl border border-success-line bg-success-soft p-3 text-sm text-success-ink">{message}</p>}
    {error&&!action&&!menu&&<p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger-ink">{error}</p>}
    <p className="sr-only">Hold a grip to drag between days, or use Move to choose a date.</p>
    <DndContext id={`calendar-${weekStart}`} sensors={sensors} onDragStart={({active})=>setDragging(active.data.current?.event as AgendaEvent)} onDragCancel={()=>setDragging(null)} onDragEnd={({active,over})=>{setDragging(null);const event=active.data.current?.event as AgendaEvent|undefined;if(event&&over&&over.id!==event.date)chooseDate(event,"move",String(over.id));}}>
      {days.map(date=><Day date={date} key={date} compact={compact}>
        <div className="flex flex-col items-center gap-1"><time dateTime={date} aria-label={dateLabel(date)} className={`flex w-11 flex-col items-center rounded-xl ${date===today?"bg-brand-soft text-brand-strong":"text-muted"}`}><span className="text-xs font-semibold uppercase leading-3">{new Intl.DateTimeFormat("en-US",{weekday:"short",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`))}</span><span className="font-display text-2xl font-bold leading-7">{Number(date.slice(-2))}</span></time>{!compact&&addLink(date)}</div>
        <div className="flex flex-col gap-2">{events.filter(event=>event.date===date).map(event=><article className={`card min-w-0 ${compact?"p-2":"p-3"}`} key={event.key} data-occurrence-id={event.occurrenceId}>
          <div className={`flex gap-2 ${compact?"items-center":"items-start"}`}>
            <Link prefetch={false} href={`${event.href}&date=${date}${viewSuffix}`} scroll={false} aria-label={`${event.title} on ${date}`} className={`touch-target min-w-0 flex-1 ${compact?"flex items-center gap-2":""}`}>
              {compact&&<span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${event.status==="completed"?"bg-success":event.status==="skipped"?"bg-muted":"bg-brand"}`}/>}
              {!compact&&<p className="truncate text-xs font-medium text-muted">{event.programName||"Workout"}{event.currentWeek?` · Week ${event.currentWeek}`:""}</p>}
              <h4 className={`display break-words ${compact?"min-w-0 text-xl":"mt-0.5 text-2xl"}`}>{event.dayName||"Quick workout"}</h4>
              {!compact&&<p className={`mt-1 text-xs font-semibold ${event.status==="completed"?"text-success-ink":event.status==="skipped"?"text-muted":"text-brand-strong"}`}>{event.status==="completed"?"Completed":event.status==="skipped"?"Skipped":event.status==="in_progress"?"In progress":date<today?"Overdue":"Scheduled"}</p>}
              {!compact&&event.summary&&<p className="mt-2 line-clamp-2 text-sm leading-5 text-muted">{event.summary}</p>}
            </Link>
            {event.occurrenceId&&event.status==="scheduled"&&<DragHandle event={event}/>}
            {compact&&event.occurrenceId&&<button className={`${button} w-[44px] shrink-0 px-0`} disabled={busy} onClick={()=>{setError("");setMenu(event);}}><MoreHorizontal aria-hidden="true" size={18}/><span className="sr-only">More options for {event.dayName}</span></button>}
          </div>
          {!compact&&event.occurrenceId&&<div className="mt-2 flex items-center gap-2">{event.status==="scheduled"&&<button className={button} disabled={busy} onClick={()=>{setError("");setAction({event,type:"move",date:event.date});}}><ArrowRightLeft size={16}/>Move</button>}<button className={button} disabled={busy} onClick={()=>{setError("");setMenu(event);}}><MoreHorizontal aria-hidden="true" size={18}/><span className="sr-only">More options for {event.dayName}</span></button></div>}
        </article>)}{!events.some(event=>event.date===date)&&<p className={`flex ${compact?"min-h-11":"min-h-22"} items-center px-1 text-sm text-muted`}>Rest day</p>}</div>
        {compact&&addLink(date)}
      </Day>)}
      <DragOverlay style={{width:192}} modifiers={[keepPreviewVisible]}>{dragging?<div data-drag-preview className="w-48 rounded-xl border border-brand-line bg-brand-soft p-3 shadow-xl"><p className="text-xs text-muted">Move workout</p><p className="display text-2xl">{dragging.dayName}</p></div>:null}</DragOverlay>
    </DndContext>
    {action&&<Sheet title={`${action.type==="move"?"Move":"Duplicate"} ${action.event.dayName}`} onClose={close}>
      <p className="mb-3 text-sm text-muted">Week {action.event.currentWeek} · {action.event.programName}. {action.type==="duplicate"?"Adds a new exposure to this run and reopens it if completed.":"The workout and its sets stay together."}</p>
      {action.conflicts?.length?<div className="flex flex-col gap-2"><p className="rounded-xl bg-warn-soft p-3 text-sm text-warn-ink">{dateLabel(action.date)} already has {action.conflicts.map(row=>row.name).join(", ")}.</p><button className={`${button} bg-foreground text-background`} disabled={busy} onClick={()=>void send({type:action.type,occurrenceId:action.event.occurrenceId,revision:action.event.revision,date:action.date,collision:"move"})}>{action.type==="duplicate"?"Duplicate":"Move"} here · keep both</button>{action.type==="move"&&action.conflicts.filter(target=>target.canSwap).map(target=><button key={target.key} className={button} disabled={busy} onClick={()=>void send({type:"move",occurrenceId:action.event.occurrenceId,revision:action.event.revision,date:action.date,collision:"swap",targetId:target.id,targetRevision:target.revision})}>Swap with {target.name}</button>)}<button className={button} onClick={()=>setAction({...action,conflicts:undefined})}>Choose another date</button></div>:<><div className="grid grid-cols-2 gap-2">{days.map(date=><button key={date} className={button} disabled={busy||(action.type==="move"&&date===action.event.date)} onClick={()=>chooseDate(action.event,action.type,date)}>{dateLabel(date)}</button>)}</div><div className="mt-4 flex items-end gap-2"><label className="min-w-0 flex-1 text-sm font-semibold">Another date<input type="date" value={action.date} onChange={e=>setAction({...action,date:e.target.value})} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3"/></label><button className={`${button} bg-foreground text-background`} disabled={busy||!action.date} onClick={()=>chooseDate(action.event,action.type,action.date)}>Save date</button></div></>}
      {error&&<p role="alert" className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger-ink">{error}</p>}
    </Sheet>}
    {menu&&<Sheet title={`${menu.dayName} options`} onClose={close}><div className="flex flex-col gap-2">{menu.status==="scheduled"&&<button className={button} onClick={()=>{setAction({event:menu,type:"move",date:menu.date});setMenu(null);}}><ArrowRightLeft size={16}/>Move</button>}<button className={button} onClick={()=>{setAction({event:menu,type:"duplicate",date:plus(menu.date,1)});setMenu(null);}}><Copy size={16}/>Duplicate workout</button>{menu.status==="scheduled"&&<button className={`${button} text-danger-ink`} disabled={busy} onClick={()=>void send({type:"skip",occurrenceId:menu.occurrenceId,revision:menu.revision})}>Skip this workout</button>}<p className="text-sm text-muted">Skipped workouts stay on their calendar date.</p>{error&&<p role="alert" className="text-danger-ink">{error}</p>}</div></Sheet>}
  </div>;
}
