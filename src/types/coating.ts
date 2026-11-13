// =============================================================================
// Conformal Coating Thickness Checks — types and constants (BusinessIT#60,
// Operations). Raised by David Bulkley through Feature Request #34.
//
// At the start of each shift an operator measures an UNCOATED board three
// times and a COATED board three times, in millimetres (the default) or
// decimal inches. The two averages are subtracted and divided by how many
// sides the spec coats, and that coating thickness is judged against the
// spec's min / max IN THE SPEC'S OWN UNIT — a spec is entered in mm or inches,
// and readings in either unit are compared against it. Mils are shown for
// reference only (Tim, 2026-11-04).
//
// Two lists on the PMO site, created by scripts/create-coating-lists.ps1:
//
//   Coating Specs     one row per spec — min / max thickness (stored in mm,
//                     entered in mm or inches), how many sides are coated.
//                     ARC admins manage it.
//   Coating Checks    one row per check: six readings, the machine, the
//                     operator and when it was measured.
// =============================================================================

/**
 * What the micrometer was set to. The SharePoint `Unit` choice holds exactly
 * these. Millimetres is the DEFAULT (Tim, 2026-11-04) — listed first, picked
 * on a new check until somebody chooses inches in that browser.
 */
export const COATING_UNITS = ["mm", "in"] as const;
export const DEFAULT_COATING_UNIT: CoatingUnit = "mm";
export type CoatingUnit = (typeof COATING_UNITS)[number];

/** Sides the coating covers — a micrometer across the board picks up both faces. */
export const COATED_SIDES = [1, 2] as const;
export type CoatedSides = (typeof COATED_SIDES)[number];

/** One row of the Coating Specs list. Limits are STORED in millimetres, whatever unit they were entered in. */
export interface CoatingSpec {
  id: number;
  /** `Title` — what the spec is for: a coating, a product, "Standard". */
  name: string;
  /** Lowest acceptable coating thickness, mm. Null only on a row edited outside ARC. */
  minMm: number | null;
  /** Highest acceptable coating thickness, mm. */
  maxMm: number | null;
  /**
   * The unit the limits were ENTERED in, and so the unit a check is judged in.
   * A missing value reads as mm.
   */
  specUnit: CoatingUnit;
  /**
   * Coated sides on the board being measured. The coated-minus-uncoated
   * difference is divided by this: two faces coated means the difference is
   * two coats (Tim, 2026-11-04 — set per spec, not one rule for every board).
   */
  coatedSides: CoatedSides;
  notes: string;
  /** A missing `Active` reads as active — a row created outside ARC must not vanish. */
  active: boolean;
}

export type CoatingSpecInput = Omit<CoatingSpec, "id">;

/** Three readings, in order, in the check's unit. */
export type CoatingReadings = [number | null, number | null, number | null];

/**
 * What a check copies from its spec when it is saved — the CPU-95 / crimp
 * rule: an admin tightening the limits next month must not turn last month's
 * passes into failures, and a check keeps the sides it was divided by.
 */
export interface CoatingSpecSnapshot {
  specId: number | null;
  specName: string;
  minMm: number | null;
  maxMm: number | null;
  specUnit: CoatingUnit;
  coatedSides: CoatedSides;
}

export interface CoatingCheck extends CoatingSpecSnapshot {
  id: number;
  /** App-derived: "SPRAY-1 / Acrylic / 2026-11-04". */
  title: string;
  measuredAt: Date | null;
  machine: string;
  /** Whoever measured, as written — the floor may share a login. */
  operator: string;
  unit: CoatingUnit;
  uncoated: CoatingReadings;
  coated: CoatingReadings;
  /** Stored so SharePoint's own views show them; ARC recomputes all six on every save. */
  uncoatedAverage: number | null;
  coatedAverage: number | null;
  /** The coating thickness, mm. Judged in the spec's unit. */
  thicknessMm: number | null;
  /** The same thickness in inches. */
  thicknessIn: number | null;
  /** The same thickness in mils, for reference only. Never judged. */
  thicknessMils: number | null;
  outOfSpec: boolean;
  notes: string;
  createdAt: Date;
  modifiedAt: Date;
}

export interface CoatingCheckInput {
  measuredAt: Date;
  machine: string;
  operator: string;
  unit: CoatingUnit;
  snapshot: CoatingSpecSnapshot;
  uncoated: CoatingReadings;
  coated: CoatingReadings;
  notes: string;
}
