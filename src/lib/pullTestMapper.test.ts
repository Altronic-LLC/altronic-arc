import { describe, expect, it } from "vitest";
import {
  buildPullTestFields,
  buildPullTestSpecFields,
  comparePullTestSpecs,
  PULL_TEST_SELECT,
  toPullTest,
  toPullTestSpec,
} from "./pullTestMapper";
import { MOCK_PULL_SPECS } from "@/data/pullTestMockData";
import type { PullTestInput } from "@/types/pullTest";

const item = (fields: Record<string, unknown>, id = "7") => ({
  id,
  createdDateTime: "2026-11-09T12:00:00Z",
  lastModifiedDateTime: "2026-11-09T12:00:00Z",
  fields,
});

describe("toPullTestSpec", () => {
  it("reads a spec, and a missing unit or Active as lbF and active", () => {
    const s = toPullTestSpec(item({ Title: "", WireGauge: "18", MinimumForce: 15, SpecSource: "Industry standard", SpecReference: "Std" }));
    expect(s).toMatchObject({ terminal: "", wireGauge: "18", minimumForce: 15, unit: "lbF", source: "Industry standard", active: true });
  });

  it("reads an unknown source as none rather than guessing", () => {
    expect(toPullTestSpec(item({ SpecSource: "Somebody said" })).source).toBeNull();
  });
});

describe("buildPullTestSpecFields", () => {
  it("upper-cases the terminal and sends every column", () => {
    const f = buildPullTestSpecFields({ ...MOCK_PULL_SPECS[0], terminal: " 504041a " });
    expect(f).toMatchObject({ Title: "504041A", ForceUnit: "lbF", SpecSource: "Manufacturer", Active: true });
  });
});

describe("comparePullTestSpecs", () => {
  it("lists terminal specs first and any-terminal specs last", () => {
    const sorted = [...MOCK_PULL_SPECS].sort(comparePullTestSpecs);
    expect(sorted.at(-1)!.terminal).toBe("");
    expect(sorted[0].terminal).not.toBe("");
  });
});

describe("pull tests", () => {
  const input: PullTestInput = {
    testedAt: new Date("2026-11-09T14:30:00Z"),
    checkPoint: "Start",
    clockNumber: " ab12 ",
    terminal: "910220",
    applicator: " Tool-A ",
    snapshot: { specId: 3, specTerminal: "", wireGauge: "18", minimumForce: 15, specUnit: "lbF", reference: "Std" },
    readings: [17.4, 14.6, 16.9],
    unit: "lbF",
    readingSource: "Tester",
    howFailed: "  Wire broke ",
    harnessOrAssembly: "H1",
    workOrder: " 9000000202 ",
    notes: "",
  };

  it("derives Title, LowestPull and Failed, pads to five pulls, and writes SpecRef as a bare integer", () => {
    const f = buildPullTestFields(input);
    expect(f).toMatchObject({
      Title: "910220 / 18 AWG / Start",
      ClockNumber: "AB12",
      SpecRefLookupId: 3,
      Pull1: 17.4,
      Pull2: 14.6,
      Pull3: 16.9,
      Pull4: null,
      Pull5: null,
      LowestPull: 14.6,
      Failed: true,
      ReadingSource: "Tester",
      WorkOrder: "9000000202",
      Applicator: "Tool-A",
      HowFailed: "Wire broke",
    });
    expect(f).not.toHaveProperty("SpecRef");
  });

  it("selects both every pull column and the bare lookup id", () => {
    expect(PULL_TEST_SELECT).toContain("SpecRefLookupId");
    expect(PULL_TEST_SELECT).toContain("HowFailed");
    for (let i = 1; i <= 5; i++) expect(PULL_TEST_SELECT).toContain(`Pull${i}`);
  });

  it("reads a row back, with the lookup id Graph sends as a string", () => {
    const t = toPullTest(item({ ...buildPullTestFields(input), SpecRefLookupId: "3" }));
    expect(t).toMatchObject({ specId: 3, terminal: "910220", unit: "lbF", failed: true, lowest: 14.6, readingSource: "Tester", howFailed: "Wire broke" });
    expect(t.readings).toEqual([17.4, 14.6, 16.9, null, null]);
    expect(t.testedAt?.toISOString()).toBe("2026-11-09T14:30:00.000Z");
  });
});
