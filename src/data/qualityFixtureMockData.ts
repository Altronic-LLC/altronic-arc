import type { QualityFixture, QualityFixtureRoleEntry } from "@/types/qualityFixture";

// =============================================================================
// Quality Fixture Log demo data — INVENTED fixtures and people, shaped like
// the real log (QF numbers with a gap and a lettered pair, upper-case legacy
// descriptions beside newer mixed-case ones, one retired) but not copied from
// it. The repo is public.
// =============================================================================

const created = new Date("2026-02-27T16:06:10Z");

function fixture(
  id: number,
  number: string,
  description: string,
  extra: Partial<QualityFixture> = {},
): QualityFixture {
  return {
    id,
    number,
    description,
    comment: "",
    location: "",
    partNumbers: "",
    active: true,
    hasAttachments: false,
    createdAt: created,
    modifiedAt: created,
    ...extra,
  };
}

export const MOCK_QUALITY_FIXTURES: QualityFixture[] = [
  fixture(1, "QF1", "STATOR RESISTANCE CHECK FIXTURE", { location: "QC bench 1" }),
  fixture(2, "QF2", "ROTOR TEST STAND ADAPTER"),
  fixture(3, "QF3", "CORE RING GO/NO-GO GAUGE", { location: "Gauge cabinet" }),
  fixture(4, "QF4A", "STEPPER MOTOR TEST ASSEMBLY"),
  fixture(5, "QF4B", "STEPPER MOTOR TEST ASSEMBLY, SPARE"),
  fixture(6, "QF5", "PICK-UP TESTER (OLD STYLE)", {
    active: false,
    comment: "Replaced by QF203",
  }),
  fixture(7, "QF200", "Coil firing adapter", {
    location: "Coil test room",
    partNumbers: "900100-01\n900100-02",
    hasAttachments: true,
  }),
  fixture(8, "QF201", "Harness continuity tester", { location: "Harness area" }),
  fixture(9, "QF202", "Display board programming fixture", { partNumbers: "900200" }),
  fixture(10, "QF203", "Pick-up functional tester", { location: "QC bench 2", comment: "Calibration not required" }),
];

export const MOCK_QUALITY_FIXTURE_ROLES: QualityFixtureRoleEntry[] = [
  { id: 1, email: "demo.user@altronic-llc.com", displayName: "Demo User", roles: ["editor", "admin"], note: "" },
  { id: 2, email: "quality.lead@example.com", displayName: "Quality Lead", roles: ["editor"], note: "" },
];
