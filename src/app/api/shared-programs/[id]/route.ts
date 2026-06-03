import { NextResponse } from "next/server";
import {
  getLatestSharedProgramVersion,
  getSharedProgramForUser,
} from "@/features/shared-programs/repository";
import { jsonError, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  sharedProgramErrorResponse,
  type SharedProgramRouteContext,
} from "../route-utils";

export async function GET(_request: Request, context: SharedProgramRouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const sharedProgramId = numberParam(id);

    if (!Number.isInteger(sharedProgramId) || sharedProgramId <= 0) {
      return jsonError("Shared program not found", 404);
    }

    const sharedProgram = getSharedProgramForUser(sharedProgramId, user.id);
    const latestVersion = getLatestSharedProgramVersion(sharedProgramId, user.id);

    return NextResponse.json({ ...sharedProgram, latestVersion });
  } catch (error) {
    return sharedProgramErrorResponse(error, "Failed to fetch shared program");
  }
}
