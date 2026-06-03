import { NextResponse } from "next/server";
import { rollbackSharedProgramVersion } from "@/features/shared-programs/sync";
import { assertSameOrigin, jsonError, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  parseExpectedMaxes,
  parsePositiveInteger,
  sharedProgramErrorResponse,
  type SharedProgramRouteContext,
} from "../../route-utils";

type RollbackBody = {
  targetVersionId?: unknown;
  expectedMaxes?: unknown;
};

export async function POST(request: Request, context: SharedProgramRouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const sharedProgramId = numberParam(id);
    const body = (await request.json()) as RollbackBody;
    const targetVersionId = parsePositiveInteger(body.targetVersionId);

    if (!Number.isInteger(sharedProgramId) || sharedProgramId <= 0) {
      return jsonError("Shared program not found", 404);
    }

    if (!targetVersionId) {
      return jsonError("targetVersionId is required", 400);
    }

    const result = rollbackSharedProgramVersion({
      sharedProgramId,
      userId: user.id,
      targetVersionId,
      expectedMaxes: parseExpectedMaxes(body.expectedMaxes),
    });

    return NextResponse.json(result);
  } catch (error) {
    return sharedProgramErrorResponse(error, "Failed to roll back shared program");
  }
}
