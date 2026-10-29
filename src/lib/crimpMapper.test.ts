import { describe, expect, it } from "vitest";
import { buildCrimpCheckFields, buildCrimpSpecFields, toCrimpCheck, toCrimpSpec } from "./crimpMapper";
import type { CrimpCheckInput } from "@/types/crimp";

const meta = { createdDateTime: "2026-10-27T10:00:00Z", lastModifiedDateTime: "2026-10-27T10:00:00Z" };

describe("toCrimpSpec", () => {
  it("reads a spec, with a missing Active as ACTIVE", () => {
    const spec = toCrimpSpec({
      id: "7",
      fields: { Title: " 900101 ", WireGauge: "14", Applicator: "A1001", CrimpHeight: 0.09, Tolerance: "0.002" },
      ...meta,
    });
    expect(spec).toMatchObject({ id: 7, terminal: "900101", crimpHeight: 0.09, tolerance: 0.002, active: true });
  });

  it("reads a blank crimp height as unknown, never zero", () => {
    expect(toCrimpSpec({ id: "8", fields: { Title: "900550", Active: false }, ...meta })).toMatchObject({
      crimpHeight: null,
      tolerance: null,
      active: false,
    });
  });
});

describe("buildCrimpSpecFields", () => {
  it("upper-cases the terminal and applicator and sends every column", () => {
    const fields = buildCrimpSpecFields({
      terminal: " 09g0465 ",
      manufacturerPartNumber: "x",
      applicator: "l93538",
      wireGauge: "22",
      tableHeight: "",
      wireSetting: "",
      insulationSetting: "",
      crimpHeight: null,
      tolerance: null,
      notes: "",
      active: true,
    });
    expect(fields).toMatchObject({ Title: "09G0465", Applicator: "L93538", CrimpHeight: null, Active: true });
  });
});

describe("toCrimpCheck", () => {
  it("reads the bare SpecRefLookupId Graph hands back as a string", () => {
    const check = toCrimpCheck({
      id: "12",
      fields: {
        SpecRefLookupId: "5",
        Terminal: "900330",
        WireGauge: "18",
        CheckPoint: "Start",
        CheckedAt: "2026-10-27T13:00:00Z",
        Reading1: 0.04,
        Reading2: "0.039",
        OutOfSpec: true,
        WorkOrder: " 1000209528 ",
      },
      ...meta,
    });
    expect(check).toMatchObject({
      id: 12,
      specId: 5,
      checkPoint: "Start",
      readings: [0.04, 0.039, null],
      outOfSpec: true,
      title: "900330 / 18 AWG / Start",
      workOrder: "1000209528",
    });
    expect(check.checkedAt?.toISOString()).toBe("2026-10-27T13:00:00.000Z");
  });

  it("reads a missing WorkOrder as blank — checks saved before the column existed", () => {
    expect(toCrimpCheck({ id: "1", fields: {}, ...meta }).workOrder).toBe("");
  });

  it("drops a check point SharePoint has that ARC doesn't know", () => {
    expect(toCrimpCheck({ id: "1", fields: { CheckPoint: "Lunch" }, ...meta }).checkPoint).toBeNull();
  });
});

describe("buildCrimpCheckFields", () => {
  const input: CrimpCheckInput = {
    checkedAt: new Date("2026-10-27T13:00:00Z"),
    checkPoint: "End",
    clockNumber: " 342 ",
    snapshot: { specId: 5, terminal: "900330", wireGauge: "18", applicator: "BLUE", crimpHeight: 0.04, tolerance: 0.002 },
    readings: [0.038, 0.037, 0.039],
    applicatorChange: "",
    verifierClock: "",
    harnessOrAssembly: "",
    workOrder: " 1000209528 ",
    notes: "",
  };

  it("writes SpecRef as a BARE integer — a single lookup, never Collection(Edm.Int32)", () => {
    const fields = buildCrimpCheckFields(input);
    expect(fields.SpecRefLookupId).toBe(5);
    expect(Object.keys(fields).some((k) => k.includes("@odata.type"))).toBe(false);
  });

  it("derives Average, OutOfSpec and Title from what it writes", () => {
    expect(buildCrimpCheckFields(input)).toMatchObject({
      Title: "900330 / 18 AWG / End",
      Average: 0.038,
      OutOfSpec: true,
      ClockNumber: "342",
      WorkOrder: "1000209528",
      CrimpHeight: 0.04,
      Tolerance: 0.002,
    });
    expect(buildCrimpCheckFields({ ...input, readings: [0.038, 0.038, 0.038] }).OutOfSpec).toBe(false);
  });
});
