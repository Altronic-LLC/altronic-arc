import { describe, expect, it } from "vitest";
import { compareMcnNumbers, nextMcnNumber, parseMcnNumber, sameMcnNumber } from "./mcnNumber";

const in2026 = new Date(2026, 9, 26);

describe("nextMcnNumber", () => {
  it("is one past the HIGHEST number this year, three digits", () => {
    expect(nextMcnNumber(["MCN26001", "MCN26004", "MCN26002"], in2026)).toBe("MCN26005");
  });

  it("restarts each year — last year's numbers don't count", () => {
    expect(nextMcnNumber(["MCN25001", "MCN25009"], in2026)).toBe("MCN26001");
  });

  it("is never count + 1 — a gap left by a deleted number isn't handed out again", () => {
    // Two MCNs this year, but the highest is 5: the next is 6, not 3.
    expect(nextMcnNumber(["MCN26001", "MCN26005"], in2026)).toBe("MCN26006");
  });

  it("ignores anything that isn't MCNyy###, and reads lower case", () => {
    expect(nextMcnNumber(["", "MCN-26-099", "mcn26003"], in2026)).toBe("MCN26004");
  });

  it("starts at 001 on an empty list", () => {
    expect(nextMcnNumber([], in2026)).toBe("MCN26001");
  });
});

describe("parse, compare, same", () => {
  it("reads the year and the sequence", () => {
    expect(parseMcnNumber("MCN20002")).toEqual({ year: 20, seq: 2 });
    expect(parseMcnNumber("ECN20002")).toBeNull();
  });

  it("orders newest first by year, then sequence, with unparsable last", () => {
    const sorted = ["MCN25001", "junk", "MCN26002", "MCN26010"].sort(compareMcnNumbers);
    expect(sorted).toEqual(["MCN26010", "MCN26002", "MCN25001", "junk"]);
  });

  it("matches regardless of case and spaces, never two blanks", () => {
    expect(sameMcnNumber("mcn26002 ", "MCN26002")).toBe(true);
    expect(sameMcnNumber("", "")).toBe(false);
  });
});
