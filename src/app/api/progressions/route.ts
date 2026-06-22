import { NextResponse } from "next/server";
import { assertSameOrigin, isUnauthorized, jsonError, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  createUserTrainingTemplate,
  listUserTrainingTemplates,
} from "@/features/training-templates/user-templates";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(listUserTrainingTemplates(user.id));
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to load progressions", 500);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await readJson<Record<string, unknown>>(request);
    const template = createUserTrainingTemplate({
      userId: user.id,
      name: body.name,
      description: body.description,
      weeks: body.weeks,
      rule: body.rule,
    });
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return jsonError(error.message, 403);
    }
    // The remaining throws are validation (name/grid/rule) — surface them to the user.
    if (error instanceof Error) return jsonError(error.message, 400);
    return jsonError("Failed to create progression", 500);
  }
}
