import { NextResponse } from "next/server";
import { UnauthorizedError } from "./auth";

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof UnauthorizedError;
}

export function numberParam(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
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

  if (origin && !allowedOrigins.has(origin)) {
    throw new Error("Forbidden cross-origin request");
  }

  if (!origin && referer && !allowedOrigins.has(new URL(referer).origin)) {
    throw new Error("Forbidden cross-origin request");
  }
}
