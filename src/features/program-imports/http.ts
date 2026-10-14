import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { assertSameOrigin, isUnauthorized } from "@/lib/api";
import { ProgramFileError } from "../program-files/file";
import { authenticateImportToken, ProgramImportError } from "./repository";

export function privateJson(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
export async function importPrincipal(request: Request): Promise<{userId:number;tokenId?:string}> {
  const header = request.headers.get("authorization");
  if (header !== null) {
    const match = /^Bearer (\S+)$/i.exec(header);
    if (!match) throw new ProgramImportError(401, "invalid_credential", "Use a valid Bearer import credential.");
    return authenticateImportToken(match[1]);
  }
  assertSameOrigin(request);
  return { userId: (await requireUser()).id };
}
export async function importSession(request: Request, write = false) {
  if (request.headers.has("authorization")) throw new ProgramImportError(401, "session_required", "Sign in to manage import credentials.");
  if (write) assertSameOrigin(request);
  return requireUser();
}
export async function readImportBody(request: Request, allowed: string[], maxBytes = 2_050_000): Promise<Record<string,unknown>> {
  const tooLarge = () => new ProgramImportError(413, "request_too_large", "The request is too large. Program JSON must be smaller than 2 MB.");
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw tooLarge();
  if (!request.body) throw new ProgramImportError(400, "invalid_request", "A JSON request body is required.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try {
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
    body = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  } catch { throw new ProgramImportError(400, "invalid_json", "Enter a valid JSON request body."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ProgramImportError(400, "invalid_request", "A JSON object is required.");
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ProgramImportError(400, "unsupported_field", "The request contains unsupported fields.");
  return body as Record<string,unknown>;
}
export function importFailure(error: unknown) {
  if (error instanceof ProgramFileError) return privateJson({ error: "Check the program JSON fields.", code: "invalid_program_file", issues: error.issues },400);
  if (error instanceof ProgramImportError) return privateJson({ error: error.message, code: error.code },error.status);
  if (isUnauthorized(error)) return privateJson({ error: "Sign in or provide a valid import credential.", code: "unauthorized" },401);
  if (error instanceof Error && error.message === "Forbidden cross-origin request") return privateJson({ error: error.message, code: "forbidden_origin" },403);
  // Never log uploaded program content, credentials, or raw request bodies.
  console.error("[program-import] Request failed");
  return privateJson({ error: "Could not save the import. Retry with the same request key.", code: "import_failed" },500);
}
