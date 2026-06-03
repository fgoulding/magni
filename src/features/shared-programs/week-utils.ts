import type { TemplateWeek } from "@/features/training-templates/types";

export function getSnapshotWeek(
  weeks: readonly TemplateWeek[],
  weekNumber: number,
): TemplateWeek {
  if (weeks.length === 0) {
    return { weekNumber, intensityPct: 0.7, reps: 5, sets: 5, repOutTarget: 10 };
  }

  const week = weeks[(weekNumber - 1) % weeks.length];

  return {
    weekNumber,
    intensityPct: week.intensityPct,
    reps: week.reps,
    sets: week.sets,
    repOutTarget: week.repOutTarget,
    ramp: week.ramp,
  };
}
