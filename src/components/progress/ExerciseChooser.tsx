"use client";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ExerciseFinderItem, ProgressPage } from "@/features/progress/types";
import { actualResult } from "./ExerciseRows";
import { progressButton, progressInput } from "./ProgressChrome";
import { progressUrl } from "./navigation";

export function ExerciseChooser({ initialItems, selectedKey, currentHref = "/history", onChoose, onClose }: { initialItems: ExerciseFinderItem[]; selectedKey: string; currentHref?: string; onChoose: (key: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(""), [cursor, setCursor] = useState("");
  const [page, setPage] = useState<ProgressPage<ExerciseFinderItem> | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => { dialog.current?.showModal(); input.current?.focus(); }, []);
  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true); setError("");
      try {
        const response = await fetch(progressUrl("/api/progress/exercises", { q: query.trim(), sort: "name", cursor }), { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Search failed");
        const result = await response.json() as ProgressPage<ExerciseFinderItem>;
        if (!controller.signal.aborted) setPage(result);
      } catch { if (!controller.signal.aborted) setError("Could not search your exercises. Your query is still here."); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, cursor ? 0 : 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, cursor, retry]);
  function close() { dialog.current?.close(); onClose(); }
  function changeQuery(value: string) { setQuery(value); setCursor(""); setPage(null); setError(""); setBusy(!!value.trim()); }
  function changePage(value: string) { setCursor(value); setPage(null); setBusy(true); }
  const items = query.trim() ? page?.items ?? [] : initialItems.slice(0, 7);
  return <dialog ref={dialog} aria-label="Choose exercise" onCancel={event => { event.preventDefault(); close(); }} className="m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-4 text-foreground backdrop:bg-foreground/40">
    <header className="flex items-center justify-between gap-3"><h2 className="display text-3xl">Choose exercise</h2><button type="button" aria-label="Close exercise chooser" className={progressButton} onClick={close}><X aria-hidden="true" size={18} /></button></header>
    <form role="search" aria-label="Exercise chooser" className="mt-3" onSubmit={event => { event.preventDefault(); if (query.trim()) { setBusy(true); setRetry(retry + 1); } }}><label className="text-sm font-semibold">Search exercises<input ref={input} type="search" value={query} onChange={event => changeQuery(event.target.value)} className={`${progressInput} mt-2`} placeholder="Name or past label" /></label></form>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-sm text-muted">{busy ? "Searching…" : error ? "Search unavailable" : query.trim() ? items.length ? `${items.length} results shown` : `No matches for “${query.trim()}”` : "Favorites and recently trained"}</p>{query && <button type="button" className={progressButton} onClick={() => changeQuery("")}>Clear search</button>}</div>
    {error && <div className="mt-2"><p role="alert" className="text-sm text-danger-ink">{error}</p><button type="button" className={`${progressButton} mt-2`} onClick={() => { setBusy(true); setRetry(retry + 1); }}>Retry search</button></div>}
    <ul className="mt-2 divide-y divide-line">{items.map(item => <li key={item.key}><button type="button" data-testid="exercise-choice" className="touch-target flex w-full items-center justify-between gap-3 py-3 text-left" onClick={() => { dialog.current?.close(); onChoose(item.key); }}><span className="min-w-0"><span className="display block break-words text-xl">{item.kind === "unlinked" ? `Records named ${item.name}` : item.name}</span><span className="mt-1 block text-sm text-muted">{item.kind === "unlinked" ? "Choose records to connect" : actualResult(item.latest)}</span></span>{item.key === selectedKey && <Check aria-label="Selected" size={18} className="shrink-0 text-brand-strong" />}</button></li>)}</ul>
    {!query && !items.length && <p className="my-4 text-sm text-muted">No favorites or recent training. Search a recorded name or browse your history.</p>}
    {query && !busy && page && <nav aria-label="Exercise result pages" className="mt-3 flex flex-wrap justify-between gap-2">{page.previousCursor !== null && page.previousCursor !== undefined ? <button type="button" className={progressButton} onClick={() => changePage(page.previousCursor!)}>Previous results</button> : <span />}{page.nextCursor && <button type="button" className={progressButton} onClick={() => changePage(page.nextCursor!)}>Next results</button>}</nav>}
    <footer className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3"><Link href={progressUrl("/history/exercises", { q: query.trim(), returnTo: currentHref })} className={progressButton} onClick={close}>Browse all exercises</Link><Link href={progressUrl("/history/pins", { returnTo: currentHref })} className={progressButton} onClick={close}>Manage favorites</Link></footer>
  </dialog>;
}
