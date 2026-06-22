import { NextResponse } from "next/server";
import { addDefinitionExerciseForDay } from "@/features/programs/program-service";
import type { ExerciseCategory } from "@/features/training-templates/types";
import { assertSameOrigin, isBadRequest, jsonError, isUnauthorized, numberParam, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ dayId: string }>;
};

type ExerciseCreateBody = {
  name?: unknown;
  trainingMax?: unknown;
  category?: unknown;
  progressionType?: unknown;
  sets?: unknown;
  reps?: unknown;
};

function positiveInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function validCategory(category: unknown): ExerciseCategory | null {
  if (category === undefined) return "main";
  if (category === "main" || category === "aux" || category === "accessory") return category;
  return null;
}

function normalizeTemplateId(value: unknown): string {
  if (typeof value !== "string") return "custom";

  const templateId = value.trim().toLowerCase();
  return templateId === "" ? "custom" : templateId;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { dayId } = await context.params;
    const id = numberParam(dayId);
    const body = await readJson<ExerciseCreateBody>(request);

    if (typeof body.name !== "string" || body.name.trim() === "") {
      return jsonError("name is required", 400);
    }

    const trainingMax = Number(body.trainingMax);
    if (!Number.isFinite(trainingMax) || trainingMax <= 0) {
      return jsonError("valid trainingMax is required", 400);
    }

    const category = validCategory(body.category);
    if (!category) return jsonError("invalid category", 400);

    const templateId = normalizeTemplateId(body.progressionType);
    const exerciseName = body.name.trim();
    const exercise = addDefinitionExerciseForDay({
      userId: user.id,
      legacyDayId: id,
      name: exerciseName,
      trainingMax,
      category,
      progressionType: templateId,
      setCount: positiveInt(body.sets),
      repCount: positiveInt(body.reps),
    });

    return NextResponse.json({ id: exercise.legacyExerciseId, name: exerciseName, trainingMax, category }, { status: 201 });
  } catch (error) {
    if (isBadRequest(error)) return jsonError(error.message, 400);
    if (isUnauthorized(error)) return jsonError("Unauthorized", 401);
    if (error instanceof Error && error.message === "Forbidden cross-origin request") {
      return jsonError(error.message, 403);
    }
    if (error instanceof Error && error.message.startsWith("Unknown training template")) {
      return jsonError(error.message, 400);
    }
    if (error instanceof Error && error.message.includes("does not support")) {
      return jsonError(error.message, 400);
    }
    if (error instanceof Error && error.message === "Day not found") {
      return jsonError(error.message, 404);
    }
    return jsonError("Failed to create exercise", 500);
  }
}
