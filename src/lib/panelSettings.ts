import { CAPACITY_AMBER_RATIO } from "./capacity";

// =============================================================================
// Panel Settings (pure) — the panel team's adjustable settings, read from the
// Panel Settings list's Title/Value rows. A value ARC can't read falls back to
// the default rather than breaking the screen that uses it.
// =============================================================================

export interface PanelSettings {
  /** The Capacity view turns a day amber above this share of capacity (a whole %). */
  amberPercent: number;
}

/** The rows' Titles. Never rename one: the list is keyed by them. */
export const PANEL_SETTING_KEYS = { amberPercent: "CapacityAmberPercent" } as const;

export const DEFAULT_PANEL_SETTINGS: PanelSettings = {
  amberPercent: Math.round(CAPACITY_AMBER_RATIO * 100),
};

/** The lowest and highest amber threshold ARC accepts. */
export const AMBER_PERCENT_MIN = 50;
export const AMBER_PERCENT_MAX = 100;

/** What's wrong with a typed amber threshold, or null. */
export function amberPercentProblem(n: number): string | null {
  if (!Number.isInteger(n) || n < AMBER_PERCENT_MIN || n > AMBER_PERCENT_MAX) {
    return `Amber must be a whole percentage from ${AMBER_PERCENT_MIN} to ${AMBER_PERCENT_MAX}.`;
  }
  return null;
}

/** The settings from the list's rows; anything missing or unreadable is the default. */
export function parsePanelSettings(rows: Readonly<Record<string, string>>): PanelSettings {
  const raw = rows[PANEL_SETTING_KEYS.amberPercent];
  const n = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  return {
    amberPercent: amberPercentProblem(n) ? DEFAULT_PANEL_SETTINGS.amberPercent : n,
  };
}
