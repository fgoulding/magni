"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ProgramImportCredentials } from "./ProgramImportCredentials";
import { PROGRAM_FILE_AI_INSTRUCTIONS } from "@/features/program-files/example";

const control = "touch-target w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-foreground outline-none focus:border-brand";
const button = "touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold disabled:opacity-50";
type Attempt = { requestKey: string; file: unknown; text: string };
const subscribe = () => () => {};
export function ImportJSON({ userId }: { userId: number }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return hydrated ? <ImportForm key={userId} userId={userId} /> : <p role="status">Opening import…</p>;
}
export function humanProgramPath(path: string) {
  return path.replace(/^program\./, "").replace(/weeks\.(\d+)\.days\.(\d+)\.exercises\.(\d+)/, (_, w, d, e) => `Week ${Number(w) + 1}, day ${Number(d) + 1}, exercise ${Number(e) + 1}`).replace(/weeks\.(\d+)\.days\.(\d+)/, (_, w, d) => `Week ${Number(w) + 1}, day ${Number(d) + 1}`).replace(/sets\.(\d+)/, (_, s) => `set ${Number(s) + 1}`).replaceAll(".", " · ");
}
function ImportForm({ userId }: { userId: number }) {
  const router = useRouter();
  const storageKey = `magni:program-import:${userId}`;
  const [initial] = useState<Attempt | null>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (stored && /^[0-9a-f-]{36}$/i.test(stored.requestKey) && typeof stored.text === "string" && stored.text.length <= 2_000_000 && "file" in stored) return stored;
    } catch { /* The server retains acknowledged imports; malformed local storage is ignored. */ }
    return null;
  });
  const [text, setText] = useState(initial?.text ?? "");
  const [pending, setPending] = useState(initial);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);
  const [notice, setNotice] = useState("");
  const [directOpen, setDirectOpen] = useState(false);
  async function readFile(file: File | undefined) {
    if (!file) return;
    setError(""); setIssues([]);
    try {
      if (file.size > 2_000_000) throw new Error("Choose a JSON file smaller than 2 MB.");
      setText(await file.text()); setNotice(`${file.name} loaded. Review or edit the JSON below.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not read this file."); }
  }
  async function submit() {
    if (busyRef.current) return;
    setError(""); setIssues([]); setNotice("");
    let attempt = pending;
    if (!attempt) {
      if (new TextEncoder().encode(text).length > 2_000_000) { setError("Program files must be smaller than 2 MB."); return; }
      let file: unknown;
      try { file = JSON.parse(text); } catch { setError("Enter valid JSON, or choose a JSON file. Your input is retained below."); return; }
      attempt = { requestKey: crypto.randomUUID(), file, text };
      // Persist before sending so a lost response/reload cannot create a second draft.
      try { sessionStorage.setItem(storageKey, JSON.stringify(attempt)); }
      catch { setError("Device storage is unavailable. Enable it before importing so a retry cannot create duplicate drafts."); return; }
      setPending(attempt);
    }
    busyRef.current = true; setBusy(true);
    try {
      const response = await fetch("/api/program-imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestKey: attempt.requestKey, file: attempt.file }) });
      const result = await response.json();
      if (!response.ok) {
        // A definite client rejection did not create a draft; edits can get a fresh request.
        if ([400, 409, 410, 413].includes(response.status)) { sessionStorage.removeItem(storageKey); setPending(null); }
        if (Array.isArray(result.issues)) setIssues(result.issues.filter((issue: { path?: unknown; message?: unknown }) => typeof issue.path === "string" && typeof issue.message === "string"));
        throw new Error(result.error ?? "Could not import this program.");
      }
      if (!/^[0-9a-f-]{36}$/i.test(result.draftId ?? "")) throw new Error("The response was incomplete. Retry to recover the same private draft.");
      sessionStorage.removeItem(storageKey);
      router.push(`/programs/editor/${result.draftId}`);
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Connection lost. Retry the same import safely."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <div className="flex min-w-0 flex-col gap-5">
    <section className="card flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <p className="text-sm leading-6 text-muted">Choose a file or paste JSON. It opens as a private draft in the program builder, ready to review and edit.</p>
      <label className="flex min-w-0 flex-col gap-2 text-sm font-semibold">JSON file<input type="file" accept=".json,application/json" disabled={!!pending || busy} className={`${control} file:mr-3 file:rounded-lg file:border-0 file:bg-surface-muted file:px-3 file:py-2 file:font-semibold file:text-foreground`} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <label className="flex min-w-0 flex-col gap-2 text-sm font-semibold">JSON content<textarea className={`${control} min-h-64 font-mono text-sm`} spellCheck={false} disabled={!!pending || busy} value={text} onChange={event => { setText(event.target.value); setError(""); setIssues([]); }} placeholder="Paste your Magni program JSON here" /></label>
      {error && <div role="alert" className="rounded-xl border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink"><p>{error}</p>{issues.map((issue, index) => <p key={index} className="mt-2 break-words"><strong>{humanProgramPath(issue.path)}</strong>: {issue.message}</p>)}</div>}
      {pending && !busy && <p className="text-sm text-muted">The previous import may already be saved. Retry to open that same draft before changing this JSON.</p>}
      {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
      <button type="button" disabled={busy || !text.trim()} className="touch-target rounded-xl bg-foreground px-4 py-3 font-semibold text-background disabled:opacity-50" onClick={() => { void submit(); }}>{busy ? "Importing…" : pending ? "Retry import" : "Import as draft"}</button>
    </section>
    <details className="rounded-xl border border-line p-4"><summary className="touch-target cursor-pointer font-semibold">JSON format & examples</summary><div className="mt-3 flex flex-col gap-3"><p className="text-sm leading-6 text-muted">Use the versioned Magni program format. Older Magni program files are also accepted. Export JSON from any program to use it as a starting point.</p><div className="flex flex-wrap gap-2"><a className={button} href="/api/program-imports/example" download="example.magni.json">Download example JSON</a><a className={button} href="/api/program-imports/schema" target="_blank" rel="noreferrer">View JSON schema</a><button type="button" className={button} onClick={() => { void navigator.clipboard.writeText(PROGRAM_FILE_AI_INSTRUCTIONS).then(() => setNotice("AI instructions copied."), () => setError("Copy failed. Select and copy the instructions below.")); }}>Copy AI instructions</button></div><details><summary className="touch-target cursor-pointer text-sm font-semibold">Read authoring instructions</summary><pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-surface-muted p-3 text-xs leading-5 text-muted">{PROGRAM_FILE_AI_INSTRUCTIONS}</pre></details></div></details>
    <details className="rounded-xl border border-line p-4" onToggle={event => setDirectOpen(event.currentTarget.open)}><summary className="touch-target cursor-pointer font-semibold">Direct upload</summary>{directOpen && <ProgramImportCredentials />}</details>
  </div>;
}
