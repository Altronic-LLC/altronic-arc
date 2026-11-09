import { describe, expect, it } from "vitest";
import { describeSerialError, parseMark10Line, takeLines } from "./mark10";

// The line shapes are the WT-205 User's Guide §12: "124.8 lbF<CR><LF>" with
// Numeric + Units, "124.8<CR><LF>" with Numeric Only, "*10" for a bad command,
// and the peak + date/time stamp the Auto Settings output sends after a break.

describe("parseMark10Line", () => {
  it("reads the manual's example and each unit", () => {
    expect(parseMark10Line("124.8 lbF")).toEqual({ ok: true, value: 124.8, unit: "lbF" });
    expect(parseMark10Line("52.5 N")).toEqual({ ok: true, value: 52.5, unit: "N" });
    expect(parseMark10Line("2.31 kgF")).toEqual({ ok: true, value: 2.31, unit: "kgF" });
    expect(parseMark10Line("40.0 ozF")).toEqual({ ok: true, value: 40, unit: "ozF" });
    expect(parseMark10Line("0.25 kN")).toEqual({ ok: true, value: 0.25, unit: "kN" });
  });

  it("reads Numeric Only as a value with no unit", () => {
    expect(parseMark10Line("  24.8 ")).toEqual({ ok: true, value: 24.8, unit: null });
  });

  it("ignores a date/time stamp after the reading", () => {
    expect(parseMark10Line("52.8 lbF 01/20/2025 11:35:08 AM")).toEqual({ ok: true, value: 52.8, unit: "lbF" });
  });

  it("refuses a negative reading rather than guessing it's tension", () => {
    const r = parseMark10Line("-24.8 lbF");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/negative/);
  });

  it("refuses an unknown unit, the tester's error code, and noise", () => {
    expect(parseMark10Line("120 gF").ok).toBe(false);
    const err = parseMark10Line("*10");
    expect(err.ok).toBe(false);
    if (!err.ok) expect(err.reason).toMatch(/refused a command/);
    expect(parseMark10Line("MEMORY FULL").ok).toBe(false);
    expect(parseMark10Line("").ok).toBe(false);
  });
});

describe("takeLines", () => {
  it("splits on CR LF and keeps the unfinished tail", () => {
    expect(takeLines("24.8 lbF\r\n25.1 lb")).toEqual({ lines: ["24.8 lbF"], rest: "25.1 lb" });
  });

  it("copes with a CR and its LF arriving in different chunks", () => {
    const first = takeLines("24.8 lbF\r");
    expect(first.lines).toEqual(["24.8 lbF"]);
    expect(takeLines(first.rest + "\n30.2 lbF\r\n")).toEqual({ lines: ["30.2 lbF"], rest: "" });
  });
});

describe("describeSerialError", () => {
  it("says nothing when the person closed the port chooser", () => {
    expect(describeSerialError({ name: "NotFoundError", message: "No port selected by the user." })).toBeNull();
  });

  it("names the port being in use, and a lost tester", () => {
    expect(describeSerialError({ name: "InvalidStateError", message: "The port is already open." })).toMatch(/already open/);
    expect(describeSerialError({ name: "NetworkError", message: "Failed to open serial port." })).toMatch(/lost the tester/);
  });
});
