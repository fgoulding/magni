import { NextResponse } from "next/server";
import { createSharedProgram } from "@/features/shared-programs/repository";
import { assertSameOrigin, jsonError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseSnapshotValue, sharedProgramErrorResponse } from "./route-utils";

type SharedProgramCreateBody = {
  name?: unknown;
  description?: unknown;
  snapshot?: unknown;
};

export async function GET() {
  try {
    const user = await requireUser();
    const rows = db
      .prepare(
        `
          SELECT
            sp.id,
            sp.owner_user_id AS ownerUserId,
            sp.name,
            sp.description,
            sp.active_version_id AS activeVersionId,
            sp.created_at AS createdAt,
            spm.role
          FROM shared_programs sp
          INNER JOIN shared_program_members spm ON spm.shared_program_id = sp.id
          WHERE spm.user_id = ?
          ORDER BY sp.created_at DESC, sp.id DESC
        `,
      )
      .all(user.id);

    return NextResponse.json(rows);
  } catch (error) {
    return sharedProgramErrorResponse(error, "Failed to fetch shared programs");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = (await request.json()) as SharedProgramCreateBody;

    if (typeof body.name !== "string" || body.name.trim() === "") {
      return jsonError("name is required", 400);
    }

    const description = typeof body.description === "string" ? body.description : "";
    const snapshot = parseSnapshotValue(body.snapshot);
    const sharedProgram = createSharedProgram({
      ownerUserId: user.id,
      name: body.name.trim(),
      description,
      snapshot,
    });

    return NextResponse.json(sharedProgram, { status: 201 });
  } catch (error) {
    return sharedProgramErrorResponse(error, "Failed to create shared program");
  }
}
