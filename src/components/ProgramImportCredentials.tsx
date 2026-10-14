"use client";
import { useEffect, useRef, useState } from "react";

type ImportToken = { id: string; name: string; createdAt: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null };
const control = "touch-target w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-foreground outline-none focus:border-brand";
const button = "touch-target rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold disabled:opacity-50";
async function fetchCredentials(signal?: AbortSignal): Promise<ImportToken[]> {
  const response = await fetch("/api/program-import-tokens", signal ? { signal } : undefined);
  const result = await response.json();
  if (!response.ok || !Array.isArray(result.tokens)) throw new Error(result.error ?? "Could not load credentials.");
  return result.tokens;
}
export function ProgramImportCredentials() {
  const [tokens, setTokens] = useState<ImportToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState(30);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    setLoading(true); setError("");
    try {
      setTokens(await fetchCredentials());
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load credentials."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetchCredentials(controller.signal).then(tokens => {
      if (!controller.signal.aborted) { setTokens(tokens); setLoading(false); }
    }, failure => {
      if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : "Could not load credentials."); setLoading(false); }
    });
    return () => controller.abort();
  }, []);
  async function create() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice(""); setSecret(null);
    try {
      const response = await fetch("/api/program-import-tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), expiresInDays: days }) });
      const result = await response.json();
      if (!response.ok || !result.token?.id || typeof result.secret !== "string") throw new Error(result.error ?? "Could not confirm credential creation. Refresh the list before creating another; a saved credential can be revoked.");
      setTokens(current => [result.token, ...current]); setSecret({ id: result.token.id, value: result.secret }); setName("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not confirm creation. Refresh the list to check for a saved credential."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function revoke(token: ImportToken) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/program-import-tokens/${encodeURIComponent(token.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not revoke this credential. Retry safely.");
      setTokens(current => current.map(item => item.id === token.id ? { ...item, revokedAt: new Date().toISOString() } : item));
      if (secret?.id === token.id) setSecret(null);
      setNotice(`${token.name} revoked.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not revoke this credential."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <div className="mt-3 flex min-w-0 flex-col gap-4">
    <p className="text-sm leading-6 text-muted">Let a tool submit programs directly to your private drafts. A credential can only import programs; you still review and start them yourself.</p>
    <div className="grid gap-3 sm:grid-cols-2"><label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Credential name<input className={control} maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="For example, my training tool" /></label><label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">Expires in<select className={control} value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label></div>
    <button type="button" className={`${button} self-start`} disabled={loading || busy || !name.trim()} onClick={() => { void create(); }}>{busy ? "Working…" : "Create credential"}</button>
    {secret && <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-warn-line bg-warn-soft p-3"><p className="text-sm font-semibold text-warn-ink">Copy this secret now. It is shown only once and disappears when you leave or close this section.</p><label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">New credential secret<textarea className={`${control} break-all font-mono text-sm`} readOnly value={secret.value} /></label><button type="button" className={button} onClick={() => { void navigator.clipboard.writeText(secret.value).then(() => setNotice("Credential copied."), () => setError("Copy failed. Select the secret and copy it manually.")); }}>Copy credential</button><button type="button" className={button} onClick={() => setSecret(null)}>Hide secret</button></section>}
    {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}{notice && <p role="status" className="text-sm text-muted">{notice}</p>}
    {loading ? <p role="status" className="text-sm text-muted">Loading credentials…</p> : <ul className="space-y-2" aria-label="Import credentials">{tokens.map(token => <li key={token.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3"><div className="min-w-0"><p className="break-words font-semibold">{token.name}</p><p className="text-xs text-muted">{token.revokedAt ? "Revoked" : `Expires ${token.expiresAt.slice(0, 10)}`}{token.lastUsedAt ? ` · Last used ${token.lastUsedAt.slice(0, 10)}` : " · Never used"}</p></div>{!token.revokedAt && <button type="button" className={`${button} text-danger-ink`} disabled={busy} aria-label={`Revoke ${token.name}`} onClick={() => { void revoke(token); }}>Revoke</button>}</li>)}</ul>}
    <button type="button" className={`${button} self-start`} disabled={loading || busy} onClick={() => { void load(); }}>Refresh credentials</button>
    <details><summary className="touch-target cursor-pointer text-sm font-semibold">How to submit</summary><div className="mt-2 flex flex-col gap-2 text-sm text-muted"><p>Send a POST request to <code className="break-all">https://magni.tylergould.ing/api/program-imports</code> with <code>Authorization: Bearer YOUR_CREDENTIAL</code> and <code>Content-Type: application/json</code>.</p><pre className="whitespace-pre-wrap break-words rounded-xl bg-surface-muted p-3 text-xs">{'{\n  "requestKey": "a-new-UUID-for-this-program",\n  "file": { "format": "magni.program", "…": "your program JSON" }\n}'}</pre><p>Retry with the same request key and identical file if the response is lost. The response contains a review URL for the private draft. Keep your credential out of shared files and program exports.</p></div></details>
  </div>;
}
