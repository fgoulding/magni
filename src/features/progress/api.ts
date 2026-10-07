import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { assertSameOrigin, isUnauthorized, jsonError } from "@/lib/api";
import { ProgressError } from "./identity";
import type { ProgressFilters } from "./types";
export async function progressApi(request:Request,write:boolean,run:(userId:number)=>unknown|Promise<unknown>):Promise<NextResponse> {
  try {if(write)assertSameOrigin(request);const user=await requireUser();return NextResponse.json(await run(user.id),{headers:{"Cache-Control":"no-store"}});}
  catch(error){if(error instanceof ProgressError)return jsonError(error.message,error.status);if(isUnauthorized(error))return jsonError("Unauthorized",401);
    if(error instanceof Error&&error.message==="Forbidden cross-origin request")return jsonError(error.message,403);
    console.error("[progress] Request failed",error);return jsonError("Could not load or save progress. Please retry.",500);}
}
export async function progressBody<T>(request:Request):Promise<T> {
  const text=await request.text();if(text.length>50_000)throw new ProgressError(400,"This change is too large.");
  try{const body=JSON.parse(text);if(!body||typeof body!=="object"||Array.isArray(body))throw new Error();return body;}catch{throw new ProgressError(400,"Enter a valid change.");}
}
export function progressFilters(request:Request):ProgressFilters {
  const p=new URL(request.url).searchParams;
  return {search:p.get("q")??p.get("search")??undefined,from:p.get("from")??undefined,to:p.get("to")??undefined,period:p.get("period") as ProgressFilters["period"]??undefined,
    programId:p.has("programId")?Number(p.get("programId")):undefined,cursor:p.get("cursor")??undefined,sort:p.get("sort") as ProgressFilters["sort"]??undefined,initial:p.get("initial")??undefined};
}
