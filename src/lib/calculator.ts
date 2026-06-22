const MIN_TRAINING_MAX = 2.5;

export function calculateWeight(trainingMax: number, intensityPct: number, rounding: number): number {
  if (rounding <= 0) {
    throw new Error("rounding must be positive");
  }

  return Math.round((trainingMax * intensityPct) / rounding) * rounding;
}

export function calculateTmDelta(
  actualReps: number,
  repOutTarget: number,
  adjustmentPerRep: number,
): number {
  return (actualReps - repOutTarget) * adjustmentPerRep;
}

export function applyTmDelta(currentTrainingMax: number, delta: number): number {
  // Round to 0.1 lb (the manual-override grain) so IEEE-754 residue from custom
  // increments can't accumulate in the stored training max over many weeks.
  const next = Math.round((currentTrainingMax + delta) * 10) / 10;
  return Math.max(MIN_TRAINING_MAX, next);
}

export function getAdjustmentPerRep(category: string): number {
  switch (category) {
    case "aux":
    case "accessory":
      return 1.25;
    case "main":
    default:
      return 2.5;
  }
}
