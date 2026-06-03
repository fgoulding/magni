import { NextResponse } from "next/server";
import {
  addSharedProgramMember,
  type SharedProgramRole,
} from "@/features/shared-programs/repository";
import { assertSameOrigin, jsonError, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  parsePositiveInteger,
  sharedProgramErrorResponse,
  type SharedProgramRouteContext,
} from "../../route-utils";

type MemberCreateBody = {
  userId?: unknown;
  role?: unknown;
};

export async function POST(request: Request, context: SharedProgramRouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const sharedProgramId = numberParam(id);
    const body = (await request.json()) as MemberCreateBody;
    const targetUserId = parsePositiveInteger(body.userId);
    const role = parseMemberRole(body.role);

    if (!Number.isInteger(sharedProgramId) || sharedProgramId <= 0) {
      return jsonError("Shared program not found", 404);
    }

    if (!targetUserId) {
      return jsonError("userId is required", 400);
    }

    if (!role) {
      return jsonError("role must be member or admin", 400);
    }

    const targetUser = db.prepare("SELECT id FROM users WHERE id = ?").get(targetUserId);
    if (!targetUser) {
      return jsonError("User not found", 404);
    }

    const member = addSharedProgramMember({
      sharedProgramId,
      actingUserId: user.id,
      targetUserId,
      role,
    });

    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    return sharedProgramErrorResponse(error, "Failed to add shared program member");
  }
}

function parseMemberRole(value: unknown): Exclude<SharedProgramRole, "owner"> | null {
  return value === "member" || value === "admin" ? value : null;
}
