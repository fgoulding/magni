import { NextResponse } from "next/server";
import {
  getExpectedMaxGauge,
  getSharedProgramSyncReview,
} from "@/features/shared-programs/sync";
import { jsonError, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  parsePositiveInteger,
  sharedProgramErrorResponse,
  type SharedProgramRouteContext,
} from "../../route-utils";

export async function GET(request: Request, context: SharedProgramRouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const sharedProgramId = numberParam(id);
    const targetVersionId = parsePositiveInteger(new URL(request.url).searchParams.get("targetVersionId"));

    if (!Number.isInteger(sharedProgramId) || sharedProgramId <= 0) {
      return jsonError("Shared program not found", 404);
    }

    if (!targetVersionId) {
      return jsonError("targetVersionId is required", 400);
    }

    const review = getSharedProgramSyncReview({
      sharedProgramId,
      userId: user.id,
      targetVersionId,
    });
    const expectedMaxGauges = review.requiredExpectedMaxKeys.map((sharedExerciseKey) =>
      getExpectedMaxGauge({ sharedProgramId, sharedExerciseKey, userId: user.id }),
    );

    return NextResponse.json({ ...review, expectedMaxGauges });
  } catch (error) {
    return sharedProgramErrorResponse(error, "Failed to fetch shared program sync review");
  }
}
