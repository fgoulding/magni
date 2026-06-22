import { NextResponse } from "next/server";
import { UnauthorizedError } from "./auth";

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof UnauthorizedError;
}

/** Thrown by readJson when the request body isn't valid JSON. */
export class BadRequestError extends Error {}

export function isBadRequest(error: unknown): error is BadRequestError {
  return error instanceof BadRequestError;
}

/** Parse a JSON request body, turning a malformed body into a typed 400 rather
 *  than letting request.json()'s SyntaxError fall through to a generic 500. */
export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new BadRequestError("Invalid request body");
  }
}

export function numberParam(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

/** Coerce an optional client-supplied string to a length-capped value. Caps
 *  free-text fields (notes, reasons) so a single request can't write an
 *  unbounded blob to the self-hosted SQLite DB. Non-strings become "". */
export function clampText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function requestOrigins(request: Request): Set<string> {
  const origins = new Set<string>();
  const requestUrl = new URL(request.url);
  origins.add(requestUrl.origin);

  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    requestUrl.protocol.replace(/:$/, "");
  const hosts = [
    request.headers.get("host"),
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim(),
  ].filter((host): host is string => !!host);

  for (const host of hosts) {
    origins.add(`${proto}://${host}`);
  }

  return origins;
}

export function assertSameOrigin(request: Request): void {
  const allowedOrigins = requestOrigins(request);
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // A cross-site browser fetch always carries an Origin header, so a foreign
  // Origin is rejected here; SameSite=Lax on the session cookie is the primary
  // defense (the cookie isn't sent on cross-site mutations at all).
  if (origin && !allowedOrigins.has(origin)) {
    throw new Error("Forbidden cross-origin request");
  }

  if (!origin && referer && !allowedOrigins.has(new URL(referer).origin)) {
    throw new Error("Forbidden cross-origin request");
  }
}
