import { describe, expect, it } from "vitest";
import {
  QUOTE_NUMBER_PREFIX,
  formatQuoteBase,
  formatQuoteNumber,
  isLatestRevision,
  latestRevisions,
  nextQuoteSequence,
  nextRevFor,
  parseQuoteNumber,
  revisionsOf,
} from "./quoteNumber";

describe("formatting", () => {
  it("pads the sequence to four digits and widens past 9999", () => {
    expect(QUOTE_NUMBER_PREFIX).toBe("IQ");
    expect(formatQuoteBase("COO", 42)).toBe("IQ-COO-0042");
    expect(formatQuoteBase(" wab ", 7)).toBe("IQ-WAB-0007");
    expect(formatQuoteBase("AB", 12345)).toBe("IQ-AB-12345");
  });

  it("refuses a bad code or sequence", () => {
    expect(() => formatQuoteBase("C", 1)).toThrow(/customer code/);
    expect(() => formatQuoteBase("TOOLONG", 1)).toThrow(/customer code/);
    expect(() => formatQuoteBase("C-O", 1)).toThrow(/customer code/);
    expect(() => formatQuoteBase("COO", 0)).toThrow(/sequence/);
    expect(() => formatQuoteBase("COO", 1.5)).toThrow(/sequence/);
  });

  it("appends the rev", () => {
    expect(formatQuoteNumber("IQ-COO-0042", 1)).toBe("IQ-COO-0042-R1");
    expect(formatQuoteNumber("iq-coo-0042", 12)).toBe("IQ-COO-0042-R12");
    expect(() => formatQuoteNumber("IQ-COO-0042", 0)).toThrow(/revision/);
  });
});

describe("parseQuoteNumber", () => {
  it("parses a full number and a bare base", () => {
    expect(parseQuoteNumber("IQ-COO-0042-R2")).toEqual({
      prefix: "IQ",
      code: "COO",
      seq: 42,
      rev: 2,
      base: "IQ-COO-0042",
    });
    expect(parseQuoteNumber(" iq-wab2-0100 ")).toEqual({
      prefix: "IQ",
      code: "WAB2",
      seq: 100,
      rev: null,
      base: "IQ-WAB2-0100",
    });
  });

  it("round-trips what it formats", () => {
    const n = formatQuoteNumber(formatQuoteBase("COO", 12345), 3);
    expect(parseQuoteNumber(n)).toMatchObject({ code: "COO", seq: 12345, rev: 3 });
  });

  it("returns null for anything that isn't a quote number", () => {
    for (const bad of [
      "",
      "Quote for Cooper",
      "IQ-COO-42",
      "IQ-COO-0042-R",
      "IQ-COO-0042-R0",
      "IQ-COO-0000",
      "XQ-COO-0042",
      "IQ-C-0042",
      "IQ-COO-0042-R1 extra",
    ]) {
      expect(parseQuoteNumber(bad)).toBeNull();
    }
    expect(parseQuoteNumber(null)).toBeNull();
    expect(parseQuoteNumber(undefined)).toBeNull();
  });
});

describe("nextQuoteSequence — GLOBAL, highest + 1", () => {
  it("starts at 1", () => {
    expect(nextQuoteSequence([])).toBe(1);
  });

  it("is global across customers", () => {
    expect(nextQuoteSequence(["IQ-COO-0003-R1", "IQ-WAB-0007-R1", "IQ-INN-0005-R2"])).toBe(8);
  });

  it("skips gaps: highest + 1, never count + 1", () => {
    // Three rows, but 0041 is the highest — a count would hand out 0004 again.
    expect(nextQuoteSequence(["IQ-COO-0001-R1", "IQ-COO-0041-R1", "IQ-WAB-0002-R1"])).toBe(42);
  });

  it("accepts bases and numbers mixed, and counts revs of one base once", () => {
    expect(nextQuoteSequence(["IQ-COO-0010", "IQ-COO-0010-R3", "IQ-WAB-0009-R1"])).toBe(11);
  });

  it("ignores malformed titles", () => {
    expect(nextQuoteSequence(["junk", "", "IQ-COO-99", "Quote 9999", "IQ-COO-0004-R1"])).toBe(5);
  });
});

const QUOTES = [
  { id: 1, quoteBase: "IQ-COO-0001", rev: 1 },
  { id: 2, quoteBase: "IQ-COO-0001", rev: 3 },
  { id: 3, quoteBase: "IQ-WAB-0002", rev: 1 },
  { id: 4, quoteBase: "IQ-COO-0001", rev: 2 },
];

describe("revisions", () => {
  it("nextRevFor is the highest rev of that base + 1", () => {
    expect(nextRevFor("IQ-COO-0001", QUOTES)).toBe(4);
    expect(nextRevFor("iq-wab-0002", QUOTES)).toBe(2);
    expect(nextRevFor("IQ-NEW-0009", QUOTES)).toBe(1);
  });

  it("nextRevFor skips a missing rev rather than reusing it", () => {
    expect(nextRevFor("IQ-X-0001", [{ quoteBase: "IQ-X-0001", rev: 1 }, { quoteBase: "IQ-X-0001", rev: 5 }])).toBe(6);
  });

  it("latestRevisions keeps the highest rev per base, in first-appearance order", () => {
    expect(latestRevisions(QUOTES).map((q) => q.id)).toEqual([2, 3]);
    expect(latestRevisions([])).toEqual([]);
  });

  it("isLatestRevision", () => {
    expect(isLatestRevision(QUOTES[1], QUOTES)).toBe(true);
    expect(isLatestRevision(QUOTES[0], QUOTES)).toBe(false);
    expect(isLatestRevision(QUOTES[2], QUOTES)).toBe(true);
  });

  it("revisionsOf lists one base, newest first", () => {
    expect(revisionsOf("IQ-COO-0001", QUOTES).map((q) => q.rev)).toEqual([3, 2, 1]);
    expect(revisionsOf("IQ-NONE-0001", QUOTES)).toEqual([]);
  });
});
