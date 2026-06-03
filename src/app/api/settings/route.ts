import { NextResponse } from "next/server";
import { assertSameOrigin, jsonError, isUnauthorized } from "@/lib/api";
import { getSettings, requireUser, setSetting } from "@/lib/auth";

type SettingsBody = {
  rounding?: unknown;
};

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(getSettings(user.id));
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to fetch settings", 500);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = (await request.json()) as SettingsBody;

    if (body.rounding !== undefined) {
      const rounding = Number(body.rounding);
      if (!Number.isFinite(rounding) || rounding <= 0 || rounding > 100) {
        return jsonError("rounding must be a positive number", 400);
      }
      setSetting(user.id, "rounding", String(rounding));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    return jsonError("Failed to save settings", 500);
  }
}
