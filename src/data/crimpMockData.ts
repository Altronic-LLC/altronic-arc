import type { CrimpCheck, CrimpSpec } from "@/types/crimp";
import { buildCrimpCheckTitle, crimpAverage, crimpLimits, isOutOfSpec } from "@/lib/crimpCheck";

// =============================================================================
// Demo data for Crimp Height Checks. INVENTED — terminal numbers, applicator
// serials and specs are made up, never copied from the real spec sheet (the
// repo is public; see CLAUDE.md rule 8). Shaped like the real thing: one
// applicator crimping three gauges, a non-Mecal press with a colour instead of
// a serial, and one spec still waiting for its crimp height.
// =============================================================================

export const MOCK_CRIMP_SPECS: CrimpSpec[] = [
  spec(1, "900101", "DEMO-10-1", "A1001", "14", "0.10", "1.90", "", 0.09, 0.002),
  spec(2, "900101", "DEMO-10-1", "A1001", "16", "", "2.10", "", 0.082, 0.002),
  spec(3, "900101", "DEMO-10-1", "A1001", "20", "", "2.35", "", 0.074, 0.002),
  spec(4, "900215", "DEMO-22-4", "A1002", "18", "", "2.00", "1.20", 0.042, 0.002),
  spec(5, "900330", "DEMO-31-7", "BLUE", "18", "", "E-1", "", 0.04, 0.002),
  spec(6, "900442", "DEMO-44-2", "A1003", "22", "", "2.50", "1.70", 0.031, 0.002),
  spec(7, "900550", "DEMO-55-0", "A1004", "16", "", "", "", null, null, "Crimp height still to be measured."),
  spec(8, "900660", "DEMO-66-6", "A1005", "20", "", "2.40", "1.50", 0.047, 0.002, "", false),
];

function spec(
  id: number,
  terminal: string,
  manufacturerPartNumber: string,
  applicator: string,
  wireGauge: string,
  tableHeight: string,
  wireSetting: string,
  insulationSetting: string,
  crimpHeight: number | null,
  tolerance: number | null,
  notes = "",
  active = true,
): CrimpSpec {
  return {
    id,
    terminal,
    manufacturerPartNumber,
    applicator,
    wireGauge,
    tableHeight,
    wireSetting,
    insulationSetting,
    crimpHeight,
    tolerance,
    notes,
    active,
  };
}

/** Hours before now — keeps the demo inside the current year's log most of the year. */
function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

function check(
  id: number,
  specId: number,
  hours: number,
  checkPoint: CrimpCheck["checkPoint"],
  clockNumber: string,
  readings: CrimpCheck["readings"],
  extra: Partial<CrimpCheck> = {},
): CrimpCheck {
  const s = MOCK_CRIMP_SPECS.find((x) => x.id === specId)!;
  const at = hoursAgo(hours);
  return {
    id,
    title: buildCrimpCheckTitle(s.terminal, s.wireGauge, checkPoint),
    checkedAt: at,
    checkPoint,
    clockNumber,
    specId,
    terminal: s.terminal,
    wireGauge: s.wireGauge,
    applicator: s.applicator,
    crimpHeight: s.crimpHeight,
    tolerance: s.tolerance,
    readings,
    average: crimpAverage(readings),
    outOfSpec: isOutOfSpec(readings, crimpLimits(s.crimpHeight, s.tolerance)),
    applicatorChange: "",
    verifierClock: "",
    harnessOrAssembly: "",
    notes: "",
    createdAt: at,
    modifiedAt: at,
    ...extra,
  };
}

export const MOCK_CRIMP_CHECKS: CrimpCheck[] = [
  check(1, 5, 70, "Start", "101", [0.04, 0.039, 0.04], { harnessOrAssembly: "DEMO-H100-5", verifierClock: "101" }),
  check(2, 5, 68, "End", "101", [0.039, 0.039, 0.039], { harnessOrAssembly: "DEMO-H100-5", verifierClock: "101" }),
  check(3, 1, 50, "Start", "202", [0.09, 0.091, 0.09], { harnessOrAssembly: "DEMO-H220-1" }),
  check(4, 1, 49, "In process", "202", [0.091, 0.089, 0.09], { harnessOrAssembly: "DEMO-H220-1" }),
  check(5, 4, 30, "Start", "303", [0.042, 0.045, 0.043], {
    harnessOrAssembly: "DEMO-H310-2",
    applicatorChange: "No",
    notes: "Second reading high — applicator adjusted and re-checked.",
  }),
  check(6, 4, 29, "Start", "303", [0.042, 0.041, 0.042], {
    harnessOrAssembly: "DEMO-H310-2",
    applicatorChange: "Adjusted wire setting",
    verifierClock: "202",
  }),
  check(7, 6, 6, "Start", "101", [0.031, 0.03, 0.031], { harnessOrAssembly: "DEMO-H400-9" }),
];
