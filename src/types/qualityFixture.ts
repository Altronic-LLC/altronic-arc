// =============================================================================
// Quality Fixture Log (Quality Control) — the "Quality Control Custom
// Equipment Log (calibration not required)": one row per custom QC fixture,
// numbered QF1, QF2 … QF63A … on the QFLOG list (PMO site).
// =============================================================================

export interface QualityFixture {
  id: number;
  /** Title — "QF12", "QF63A". Unique across the log, retired fixtures included. */
  number: string;
  /** field_1 */
  description: string;
  /** field_2 — a short free-text comment. */
  comment: string;
  /** Where the fixture is kept. */
  location: string;
  /** The products or part numbers it tests — free text, one per line. */
  partNumbers: string;
  /** False = retired. Never deleted, so a number is never reused. A blank reads as active. */
  active: boolean;
  hasAttachments: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

export interface QualityFixtureInput {
  number: string;
  description: string;
  comment: string;
  location: string;
  partNumbers: string;
  active: boolean;
}

/** Lowercase, stored as a CSV in the Quality Fixture Roles list's `Roles` column. */
export const QUALITY_FIXTURE_ROLES = ["editor", "admin"] as const;
export type QualityFixtureRole = (typeof QUALITY_FIXTURE_ROLES)[number];

export const QUALITY_FIXTURE_ROLE_LABELS: Record<QualityFixtureRole, string> = {
  editor: "Editor",
  admin: "Fixture Log admin",
};

export interface QualityFixtureRoleEntry {
  id: number;
  /** Title — lower-cased email. */
  email: string;
  displayName: string;
  roles: QualityFixtureRole[];
  note: string;
}

export interface QualityFixtureRoleInput {
  email: string;
  displayName: string;
  roles: QualityFixtureRole[];
  note: string;
}
