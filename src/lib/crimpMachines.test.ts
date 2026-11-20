import { describe, expect, it } from "vitest";
import {
  crimpMachineOptions,
  crimpMachines,
  isCrimpMachine,
  machineNames,
  parseMachineRefs,
  specRunsOn,
  withMachineNames,
} from "./crimpMachines";
import { MOCK_CRIMP_MACHINES } from "@/data/crimpMockData";
import type { CrimpMachine } from "@/types/crimp";

const asset = (over: Partial<CrimpMachine>): CrimpMachine => ({
  id: 1,
  name: "DEMO PRESS",
  equipmentType: "PRESS",
  serialNo: "",
  location: "HARNESS DEPARTMENT",
  retired: false,
  ...over,
});

describe("isCrimpMachine", () => {
  it("is a press in a Harness location — either spelling of Harness", () => {
    expect(isCrimpMachine(asset({}))).toBe(true);
    expect(isCrimpMachine(asset({ location: "HARNESS" }))).toBe(true);
    expect(isCrimpMachine(asset({ equipmentType: " press " }))).toBe(true);
  });

  it("offers the Schleuniger crimp center by name, though it's typed CUT/STRP — unless retired", () => {
    const schleuniger = asset({ name: " schcc36s ", equipmentType: "CUT/STRP", location: "" });
    expect(isCrimpMachine(schleuniger)).toBe(true);
    expect(isCrimpMachine({ ...schleuniger, retired: true })).toBe(false);
    expect(isCrimpMachine(asset({ name: "OTHER CUTTER", equipmentType: "CUT/STRP" }))).toBe(false);
  });

  it("leaves out applicators, presses elsewhere, retired presses and an unknown location", () => {
    expect(isCrimpMachine(asset({ equipmentType: "APPLI" }))).toBe(false);
    expect(isCrimpMachine(asset({ location: "DIGITAL PRODUCTION FLOOR" }))).toBe(false);
    expect(isCrimpMachine(asset({ retired: true }))).toBe(false);
    expect(isCrimpMachine(asset({ location: "" }))).toBe(false);
  });
});

describe("crimpMachines / crimpMachineOptions", () => {
  it("offers the Harness presses by name", () => {
    expect(crimpMachines(MOCK_CRIMP_MACHINES).map((m) => m.name)).toEqual([
      "DEMO COLOUR PRESS",
      "DEMO PRESS #1",
      "DEMO PRESS #2",
    ]);
  });

  it("keeps a picked machine that no longer passes the filter, saying why — and a stand-in for one that's gone", () => {
    const options = crimpMachineOptions(MOCK_CRIMP_MACHINES, [
      { id: 906, name: "DEMO OLD PRESS" },
      { id: 904, name: "DEMO APPLICATOR #1" },
      { id: 999, name: "" },
    ]);
    expect(options.slice(3).map((o) => o.label)).toEqual([
      "Asset #999 (not in the asset list)",
      "DEMO APPLICATOR #1 (not a Harness press)",
      "DEMO OLD PRESS (retired)",
    ]);
  });

  it("doesn't list an offered machine twice when it's also picked", () => {
    expect(crimpMachineOptions(MOCK_CRIMP_MACHINES, [{ id: 901, name: "DEMO PRESS #1" }])).toHaveLength(3);
  });
});

describe("parseMachineRefs", () => {
  it("reads Graph's multi lookup, ids as numbers or strings, without repeats", () => {
    expect(
      parseMachineRefs([
        { LookupId: 71, LookupValue: "A" },
        { LookupId: "72", LookupValue: "B" },
        { LookupId: 71, LookupValue: "A" },
      ]),
    ).toEqual([
      { id: 71, name: "A" },
      { id: 72, name: "B" },
    ]);
  });

  it("falls back to the bare id array, and reads nothing as none", () => {
    expect(parseMachineRefs(undefined, ["71", "x", 0])).toEqual([{ id: 71, name: "" }]);
    expect(parseMachineRefs(null)).toEqual([]);
    expect(parseMachineRefs({ results: [{ LookupId: 5, LookupValue: "C" }] })).toEqual([{ id: 5, name: "C" }]);
  });
});

describe("names", () => {
  it("names a bare id from the register, and never leaves one blank", () => {
    expect(withMachineNames([{ id: 901, name: "" }, { id: 77, name: "" }], MOCK_CRIMP_MACHINES)).toEqual([
      { id: 901, name: "DEMO PRESS #1" },
      { id: 77, name: "Asset #77" },
    ]);
  });

  it("joins names in order", () => {
    expect(machineNames([{ id: 2, name: "PRESS #2" }, { id: 1, name: "PRESS #10" }, { id: 3, name: "PRESS #1" }])).toBe(
      "PRESS #1, PRESS #2, PRESS #10",
    );
    expect(machineNames([])).toBe("");
  });
});

describe("specRunsOn", () => {
  const on = (...ids: number[]) => ({ machines: ids.map((id) => ({ id, name: "" })) });

  it("matches a spec naming the press, and leaves out one naming others", () => {
    expect(specRunsOn(on(1, 2), 2)).toBe("yes");
    expect(specRunsOn(on(1), 2)).toBe("no");
  });

  it("calls a spec with no machine unassigned, whatever press is picked", () => {
    expect(specRunsOn(on(), 2)).toBe("unassigned");
    expect(specRunsOn(on(), null)).toBe("unassigned");
  });
});
