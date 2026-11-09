import type { PullReadings, PullTest, PullTestSpec, ReadingSource } from "@/types/pullTest";
import { buildPullTestTitle, isPullTestFailed, lowestPull } from "@/lib/pullTest";
import { padReadings } from "@/lib/pullTestMapper";

// =============================================================================
// Demo data for Pull Tests. INVENTED — part numbers, minimums and references
// are made up, never copied from a real spec or a standard's table (the repo
// is public; see CLAUDE.md rule 8). Shaped like the real thing: a machined
// pin with a manufacturer minimum, an any-terminal row "from an industry
// standard", a spec in newtons, one with no minimum yet, and one retired.
// =============================================================================

export const MOCK_PULL_SPECS: PullTestSpec[] = [
  spec(1, "910101", "DEMO-PIN-1", "16", 25, "lbF", "Manufacturer", "DEMO-DS-100"),
  spec(2, "910101", "DEMO-PIN-1", "18", 18, "lbF", "Manufacturer", "DEMO-DS-100"),
  spec(3, "", "", "18", 15, "lbF", "Industry standard", "DEMO-STD Table 1"),
  spec(4, "", "", "20", 10, "lbF", "Industry standard", "DEMO-STD Table 1"),
  spec(5, "910330", "DEMO-TERM-3", "22", 35, "N", "Manufacturer", "DEMO-DS-330"),
  spec(6, "910440", "DEMO-PIN-4", "14", null, "lbF", "Manufacturer", "", "Minimum still to come from the supplier."),
  spec(7, "910550", "DEMO-PIN-5", "16", 22, "lbF", "Manufacturer", "DEMO-DS-550", "", false),
];

function spec(
  id: number,
  terminal: string,
  manufacturerPartNumber: string,
  wireGauge: string,
  minimumForce: number | null,
  unit: PullTestSpec["unit"],
  source: PullTestSpec["source"],
  reference: string,
  notes = "",
  active = true,
): PullTestSpec {
  return { id, terminal, manufacturerPartNumber, wireGauge, minimumForce, unit, source, reference, notes, active };
}

/** Hours before now — keeps the demo inside the current year's log most of the year. */
function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

function test(
  id: number,
  specId: number,
  terminal: string,
  hours: number,
  checkPoint: PullTest["checkPoint"],
  clockNumber: string,
  pulls: PullReadings,
  unit: PullTest["unit"],
  readingSource: ReadingSource,
  extra: Partial<PullTest> = {},
): PullTest {
  const s = MOCK_PULL_SPECS.find((x) => x.id === specId)!;
  const at = hoursAgo(hours);
  const readings = padReadings(pulls);
  const snapshot = { minimumForce: s.minimumForce, specUnit: s.unit };
  return {
    id,
    title: buildPullTestTitle(terminal, s.wireGauge, checkPoint),
    testedAt: at,
    checkPoint,
    clockNumber,
    specId,
    specTerminal: s.terminal,
    terminal,
    wireGauge: s.wireGauge,
    applicator: "",
    minimumForce: s.minimumForce,
    specUnit: s.unit,
    reference: s.reference,
    readings,
    unit,
    lowest: lowestPull(readings),
    failed: isPullTestFailed(readings, unit, snapshot),
    readingSource,
    howFailed: "",
    harnessOrAssembly: "",
    workOrder: "",
    notes: "",
    createdAt: at,
    modifiedAt: at,
    ...extra,
  };
}

export const MOCK_PULL_TESTS: PullTest[] = [
  test(1, 1, "910101", 72, "Start", "101", [31.2, 30.8, 32.0], "lbF", "Tester", {
    howFailed: "Wire broke",
    harnessOrAssembly: "DEMO-H500-1",
    workOrder: "9000000201",
    applicator: "DEMO-TOOL-A",
  }),
  test(2, 1, "910101", 70, "End", "101", [30.1, 29.7, 30.5], "lbF", "Tester", {
    howFailed: "Wire broke",
    harnessOrAssembly: "DEMO-H500-1",
    workOrder: "9000000201",
    applicator: "DEMO-TOOL-A",
  }),
  test(3, 3, "910220", 48, "Start", "202", [17.4, 14.6, 16.9], "lbF", "Typed", {
    howFailed: "Wire pulled out of crimp",
    harnessOrAssembly: "DEMO-H610-3",
    workOrder: "9000000202",
    notes: "Second pull came out of the barrel — tool adjusted and re-tested.",
  }),
  test(4, 3, "910220", 46, "Start", "202", [17.8, 18.2, 17.5], "lbF", "Mixed", {
    harnessOrAssembly: "DEMO-H610-3",
    workOrder: "9000000202",
  }),
  test(5, 5, "910330", 20, "In process", "303", [61.5, 59.0, 63.5], "N", "Tester", {
    howFailed: "Wire broke",
    harnessOrAssembly: "DEMO-H720-2",
    workOrder: "9000000203",
  }),
  test(6, 6, "910440", 5, "Start", "101", [40.2, 39.8, 41.0], "lbF", "Tester", {
    harnessOrAssembly: "DEMO-H800-9",
    workOrder: "9000000204",
  }),
];
