import { SharedProgramPermissionError } from "@/features/shared-programs/repository";
import { parseSharedProgramSnapshot } from "@/features/shared-programs/snapshot";
import type { SharedProgramSnapshot } from "@/features/shared-programs/types";
import { isUnauthorized, jsonError } from "@/lib/api";
import { isRecord } from "@/lib/guards";

export type SharedProgramRouteContext = {
  params: Promise<{ id: string }>;
};

export function parseSnapshotValue(value: unknown): SharedProgramSnapshot {
  return parseSharedProgramSnapshot(JSON.stringify(value));
}

export function parsePositiveInteger(value: unknown): number | null {
  const numberValue = Number(value);

  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

export function parseExpectedMaxes(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  const expectedMaxes: Record<string, number> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    const expectedMax = Number(rawValue);

    if (!Number.isFinite(expectedMax) || expectedMax <= 0) {
      throw new Error(`Expected max must be positive for ${key}`);
    }

    expectedMaxes[key] = expectedMax;
  }

  return expectedMaxes;
}

export function sharedProgramErrorResponse(error: unknown, fallbackMessage: string): Response {
  if (isUnauthorized(error)) return jsonError("Unauthorized", 401);

  if (error instanceof SharedProgramPermissionError || isMembershipError(error)) {
    return jsonError(error instanceof Error ? error.message : "Forbidden", 403);
  }

  if (error instanceof Error && error.message === "Forbidden cross-origin request") {
    return jsonError(error.message, 403);
  }

  if (error instanceof SyntaxError) {
    return jsonError("Invalid JSON body", 400);
  }

  if (error instanceof Error) {
    if (error.message.includes("not found")) {
      return jsonError(error.message, 404);
    }

    if (
      error.message.includes("Expected max") ||
      error.message.includes("snapshot") ||
      error.message.includes("Snapshot") ||
      error.message.includes("required") ||
      error.message.includes("must be") ||
      error.message.includes("At least") ||
      error.message.includes("Unsupported") ||
      error.message.includes("Duplicate")
    ) {
      return jsonError(error.message, 400);
    }
  }

  return jsonError(fallbackMessage, 500);
}

function isMembershipError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("Shared program access requires")
  );
}
