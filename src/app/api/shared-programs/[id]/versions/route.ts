import { NextResponse } from "next/server";
import { publishSharedProgramVersion } from "@/features/shared-programs/repository";
import { assertSameOrigin, jsonError, numberParam } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseSharedProgramSnapshot } from "@/features/shared-programs/snapshot";
import {
  parseSnapshotValue,
  sharedProgramErrorResponse,
  type SharedProgramRouteContext,
} from "../../route-utils";

type VersionCreateBody = {
  snapshot?: unknown;
};

export async function GET(_request: Request, context: SharedProgramRouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const sharedProgramId = numberParam(id);

    if (!Number.isInteger(sharedProgramId) || sharedProgramId <= 0) {
      return jsonError("Shared program not found", 404);
    }

    const member = db
      .prepare("SELECT 1 AS found FROM shared_program_members WHERE shared_program_id = ? AND user_id = ?")
      .get(sharedProgramId, user.id);
    if (!member) return jsonError("Shared program access requires shared program membership", 403);

    const rows = db
      .prepare(
        `
          SELECT
            id,
            shared_program_id AS sharedProgramId,
            version_number AS versionNumber,
            published_by_user_id AS publishedByUserId,
            snapshot_json AS snapshotJson,
            created_at AS createdAt
          FROM shared_program_versions
          WHERE shared_program_id = ?
          ORDER BY version_number DESC
        `,
      )
      .all(sharedProgramId) as {
      id: number;
      sharedProgramId: number;
      versionNumber: number;
      publishedByUserId: number;
      snapshotJson: string;
      createdAt: string;
    }[];

    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        sharedProgramId: row.sharedProgramId,
        versionNumber: row.versionNumber,
        publishedByUserId: row.publishedByUserId,
        snapshot: parseSharedProgramSnapshot(row.snapshotJson),
        createdAt: row.createdAt,
      })),
    );
  } catch (error) {
    return sharedProgramErrorResponse(error, "Failed to fetch shared program versions");
  }
}

export async function POST(request: Request, context: SharedProgramRouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const sharedProgramId = numberParam(id);
    const body = (await request.json()) as VersionCreateBody;

    if (!Number.isInteger(sharedProgramId) || sharedProgramId <= 0) {
      return jsonError("Shared program not found", 404);
    }

    const version = publishSharedProgramVersion({
      sharedProgramId,
      actingUserId: user.id,
      snapshot: parseSnapshotValue(body.snapshot),
    });

    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    return sharedProgramErrorResponse(error, "Failed to publish shared program version");
  }
}
