import { NextResponse } from "next/server";
import { applyCalendarAction, CalendarError } from "@/features/calendar/calendar-service";
import { assertSameOrigin, isBadRequest, isUnauthorized, jsonError, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { EditorRepositoryError } from "@/features/program-editor/repository";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user=await requireUser();
    return NextResponse.json(applyCalendarAction(user.id,await readJson(request)));
  } catch(error) {
    if (error instanceof CalendarError) return NextResponse.json({error:error.message,conflicts:error.conflicts},{status:error.status});
    if (error instanceof EditorRepositoryError) return jsonError(error.message,error.status);
    if (isBadRequest(error)) return jsonError(error.message,400);
    if (isUnauthorized(error)) return jsonError("Unauthorized",401);
    if (error instanceof Error && error.message==="Forbidden cross-origin request") return jsonError(error.message,403);
    return jsonError("Calendar change could not be saved. Try again.",500);
  }
}
