export interface PottingSampleEntry {
  id: string;
  date: string; // ISO datetime
  volume: number;
  weight: number;
}

export interface PottingLimits {
  lowerLimit: number;
  upperLimit: number;
}

export interface PsrNotificationPerson {
  id: string;
  displayName: string;
  email: string;
}

export const DEFAULT_POTTING_VOLUME = 125;

/** Which limit (if any) a sample's weight breaches. */
export type LimitBreach = "below-lower" | "above-upper" | null;

export function checkLimitBreach(weight: number, limits: PottingLimits): LimitBreach {
  if (weight < limits.lowerLimit) return "below-lower";
  if (weight > limits.upperLimit) return "above-upper";
  return null;
}
