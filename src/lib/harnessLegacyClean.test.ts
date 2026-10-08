import { describe, expect, it } from "vitest";
import {
  cleanCode,
  cleanHarnessExport,
  cleanWorkOrder,
  dayNumber,
  decidePartSpellings,
  isWellFormedPart,
  legacySourceKey,
  mechanicalPart,
  oneEditApart,
  parseCsv,
  parseTypedDate,
  readCount,
  readLegacyRows,
  settleDates,
  type LegacyHarnessRow,
} from "./harnessLegacyClean";

const TODAY = "2026-10-08";

function row(line: number, partial: Partial<LegacyHarnessRow>): LegacyHarnessRow {
  return {
    line,
    date: "",
    workOrder: "",
    partNumber: "",
    qty: "",
    reworkQty: "",
    comments: "",
    clockNumber: "",
    visualCheck: "",
    field1: "",
    ...partial,
  };
}

describe("parseCsv / readLegacyRows", () => {
  it("reads quoted fields, doubled quotes and CRLF", () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\r\n')).toEqual([
      ["a", "b,c", 'd "e"'],
      ["1", "2", "3"],
    ]);
  });

  it("skips the header and numbers lines from 2", () => {
    const rows = readLegacyRows("DATE,WO\n5/22/2018,1000068378,783023-1,40,0,,AW,,\n");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ line: 2, date: "5/22/2018", partNumber: "783023-1", clockNumber: "AW" });
  });
});

describe("parseTypedDate", () => {
  it("reads four- and two-digit years", () => {
    expect(parseTypedDate("5/22/2018")).toEqual({ month: 5, day: 22, year: 2018 });
    expect(parseTypedDate("12/4/24")).toEqual({ month: 12, day: 4, year: 2024 });
  });

  it("leaves the year to the neighbours when there is none, or it is garbage", () => {
    expect(parseTypedDate("12/4")).toEqual({ month: 12, day: 4, year: null });
    expect(parseTypedDate("10/8/269")).toEqual({ month: 10, day: 8, year: null });
  });

  it("accepts dashes, doubled and trailing slashes, and stray asterisks", () => {
    expect(parseTypedDate("6-29-22")).toEqual({ month: 6, day: 29, year: 2022 });
    expect(parseTypedDate("8//1/22")).toEqual({ month: 8, day: 1, year: 2022 });
    expect(parseTypedDate("7/8/24/")).toEqual({ month: 7, day: 8, year: 2024 });
    expect(parseTypedDate("9/13*/2021")).toEqual({ month: 9, day: 13, year: 2021 });
  });

  it("refuses what isn't a date", () => {
    expect(parseTypedDate("2/202026")).toBeNull();
    expect(parseTypedDate("30/20/23")).toBeNull();
    expect(parseTypedDate("")).toBeNull();
  });
});

describe("dayNumber", () => {
  it("refuses a date that doesn't exist", () => {
    expect(dayNumber(2023, 2, 29)).toBeNull();
    expect(dayNumber(2024, 2, 29)).not.toBeNull();
  });
});

describe("settleDates", () => {
  const around = (mid: string) => [
    ...Array.from({ length: 5 }, () => "10/14/2019"),
    mid,
    ...Array.from({ length: 5 }, () => "10/16/2019"),
  ];

  it("believes a plausible date that sits with its neighbours", () => {
    const out = settleDates(around("10/15/2019"), TODAY);
    expect(out[5]).toEqual({ date: "2019-10-15", note: null });
  });

  it("supplies a missing year from the neighbours", () => {
    expect(settleDates(around("10/15"), TODAY)[5].date).toBe("2019-10-15");
  });

  it("repairs a wrong year typed among its neighbours", () => {
    expect(settleDates(around("10/15/2014"), TODAY)[5].date).toBe("2019-10-15");
  });

  it("repairs a month that lost a digit, choosing the reading nearest its neighbours", () => {
    expect(settleDates(around("1/15/2019"), TODAY)[5].date).toBe("2019-10-15");
  });

  it("keeps a complete real date no repair explains, and says so", () => {
    const out = settleDates(around("02/20/2026"), TODAY)[5];
    expect(out.date).toBe("2026-02-20");
    expect(out.note).toMatch(/kept as typed/);
  });

  it("falls back to the row before for something unreadable, and says so", () => {
    const out = settleDates(around("2/202026"), TODAY)[5];
    expect(out.date).toBe("2019-10-14");
    expect(out.note).toMatch(/couldn't be read/);
  });

  it("gives a blank date the previous row's", () => {
    const out = settleDates(["5/22/2018", ""], TODAY);
    expect(out[1].date).toBe("2018-05-22");
    expect(out[1].note).toMatch(/blank/);
  });

  it("never accepts a date after today", () => {
    const out = settleDates(["10/1/2026", "12/25/2026", "10/2/2026"], TODAY);
    expect(out[1].date).not.toBe("2026-12-25");
  });
});

describe("part numbers", () => {
  it("mechanicalPart tidies without changing meaning", () => {
    expect(mechanicalPart(" 593506-021a ")).toBe("593506-021A");
    expect(mechanicalPart("593075=2")).toBe("593075-2");
    expect(mechanicalPart("593027*-12")).toBe("593027-12");
    expect(mechanicalPart("593162.15")).toBe("593162-15");
    expect(mechanicalPart("783038--2")).toBe("783038-2");
    expect(mechanicalPart("-593075-2")).toBe("593075-2");
    expect(mechanicalPart("6OT-064176L")).toBe("60T-064176L");
    expect(mechanicalPart("06-220305-001")).toBe("6-220305-001");
    expect(mechanicalPart("1012-4714-00")).toBe("1013-4714-00");
    expect(mechanicalPart("SKETCH #3  -72")).toBe("SKETCH #3-72");
    expect(mechanicalPart("*")).toBe("");
  });

  it("isWellFormedPart knows the shapes", () => {
    for (const ok of ["593027-15", "793089B-1", "EC93005-5", "6-220303-001", "1013-4714-00", "G11012", "593826-231-1Z"]) {
      expect(isWellFormedPart(ok)).toBe(true);
    }
    for (const bad of ["59327-30", "6930008-10", "59305248", "10165"]) {
      expect(isWellFormedPart(bad)).toBe(false);
    }
  });

  it("oneEditApart", () => {
    expect(oneEditApart("59327-30", "593027-30")).toBe(true);
    expect(oneEditApart("6930008-10", "693008-10")).toBe(true);
    expect(oneEditApart("593075-1", "593075-2")).toBe(true);
    expect(oneEditApart("abc", "abc")).toBe(false);
    expect(oneEditApart("abc", "axyz")).toBe(false);
  });

  const counts = (entries: Record<string, number>) => new Map(Object.entries(entries));

  it("fixes a malformed spelling one edit from exactly one known part", () => {
    const d = decidePartSpellings(counts({ "593027-30": 10, "59327-30": 1 }));
    expect(d.get("59327-30")).toMatchObject({ to: "593027-30", flagged: false });
  });

  it("fixes dash placement", () => {
    const d = decidePartSpellings(counts({ "593052-48": 5, "59305248": 2 }));
    expect(d.get("59305248")?.to).toBe("593052-48");
  });

  it("adds a missing suffix only when exactly one variant is known", () => {
    expect(decidePartSpellings(counts({ "793142-1": 9, "793142": 1 })).get("793142")?.to).toBe("793142-1");
    const two = decidePartSpellings(counts({ "593075-1": 9, "593075-2": 9, "593075": 1 }));
    expect(two.get("593075")?.to).toBe("593075");
  });

  it("flags rather than guesses when two spellings are one edit away", () => {
    const d = decidePartSpellings(counts({ "593152-36": 4, "593154-36": 1, "5931542-36": 1 }));
    expect(d.get("5931542-36")).toMatchObject({ to: "5931542-36", flagged: true });
  });

  it("never 'fixes' a dashless run of digits by dropping one", () => {
    const d = decidePartSpellings(counts({ "593050": 5, "5930502": 1 }));
    expect(d.get("5930502")).toMatchObject({ to: "5930502", flagged: true });
  });

  it("leaves a rare well-formed number alone — it may be a real part", () => {
    const d = decidePartSpellings(counts({ "593027-15": 50, "593029-15": 1 }));
    expect(d.get("593029-15")).toMatchObject({ to: "593029-15", flagged: false });
  });
});

describe("the small field cleaners", () => {
  it("cleanWorkOrder keeps odd values, flags them, and never invents one", () => {
    expect(cleanWorkOrder(" 1000209528. ")).toEqual({ value: "1000209528", odd: false });
    expect(cleanWorkOrder("parts order")).toEqual({ value: "PARTS ORDER", odd: false });
    expect(cleanWorkOrder("N/A")).toEqual({ value: "", odd: false });
    expect(cleanWorkOrder("10222222")).toEqual({ value: "10222222", odd: true });
  });

  it("readCount reads whole numbers only", () => {
    expect(readCount(" 12 ")).toBe(12);
    expect(readCount("")).toBeNull();
    expect(readCount("twelve")).toBeNull();
  });

  it("cleanCode upper-cases and drops a lone full stop", () => {
    expect(cleanCode(" lf ")).toBe("LF");
    expect(cleanCode(".")).toBe("");
  });

  it("legacySourceKey is built from raw values, not the line", () => {
    const a = legacySourceKey(row(2, { date: "1/2/2020", workOrder: "1000000001", partNumber: "x" }), 0);
    const b = legacySourceKey(row(99, { date: "1/2/2020", workOrder: "1000000001", partNumber: "x" }), 0);
    expect(a).toBe(b);
    expect(a).toMatch(/^ACCESS:.*#0$/);
  });
});

describe("cleanHarnessExport", () => {
  const legacy = [
    row(2, { date: "4/26/2018", workOrder: "", partNumber: "102228-12", qty: "25", clockNumber: "KN" }),
    row(3, { date: "1/1/2018", workOrder: "999888777", partNumber: "999888", qty: "25" }),
    row(4, { date: "5/22/2018", workOrder: "1000073021", partNumber: "593027-15", qty: "25", reworkQty: "0", clockNumber: "323" }),
    row(5, { date: "5/22/2018", workOrder: "1000073571", partNumber: "593027-15", qty: "25", reworkQty: "0" }),
    row(6, { date: "5/23/2018", workOrder: "1000073572", partNumber: "593027-15 ", qty: "10", reworkQty: "0" }),
    row(7, { date: "5/23", workOrder: "1000073573", partNumber: "59327-15", qty: "4", reworkQty: "8117" }),
    row(8, { date: "5/24/2018", workOrder: "593027-15", partNumber: "1000073574", qty: "3", reworkQty: "5" }),
    row(9, { date: "5/24/2018", workOrder: "1000073575", partNumber: "295495F", qty: "", field1: "6/" }),
    row(10, { date: "", workOrder: "", partNumber: "", qty: "" }),
    row(11, { date: "5/25/2018", workOrder: "1000073576", partNumber: "", qty: "2", visualCheck: "." }),
  ];
  const result = cleanHarnessExport(legacy, { today: TODAY });
  const byLine = (line: number) => result.rows.find((r) => r.line === line)!;

  it("drops the setup rows before the first real work order, and blank rows", () => {
    expect(result.excluded.map((e) => e.line)).toEqual([2, 3, 10]);
  });

  it("fixes a typo'd part and notes the original", () => {
    expect(byLine(7).partNumber).toBe("593027-15");
    expect(byLine(7).notes.join(" ")).toMatch(/typed as "59327-15"/);
  });

  it("supplies a missing year and blanks an implausible rework", () => {
    expect(byLine(7).date).toBe("2018-05-23");
    expect(byLine(7).reworkQuantity).toBeNull();
    expect(byLine(7).notes.join(" ")).toMatch(/implausible/);
  });

  it("swaps a work order and part typed into each other's columns", () => {
    expect(byLine(8)).toMatchObject({ workOrder: "1000073574", partNumber: "593027-15" });
    expect(byLine(8).notes.join(" ")).toMatch(/swapped/);
    expect(byLine(8).notes.join(" ")).toMatch(/more than Qty/);
  });

  it("maps a Waukesha number and records the unnamed column", () => {
    expect(byLine(9).partNumber).toBe("EC93005-5");
    expect(byLine(9).quantity).toBeNull();
    expect(byLine(9).notes.join(" ")).toMatch(/extra column held "6\/"/);
  });

  it("leaves a blank part blank, and a lone full stop out of Visual Check", () => {
    expect(byLine(11)).toMatchObject({ partNumber: null, visualCheck: "" });
    expect(byLine(11).notes).toContain("Part Number was blank.");
  });

  it("does not note a row it didn't change", () => {
    expect(byLine(4).notes).toEqual([]);
    expect(byLine(4).builtBy).toBe("323");
  });

  it("lists each part once, with its last use, and retires the old ones", () => {
    const part = result.parts.find((p) => p.partNumber === "593027-15")!;
    expect(part.uses).toBe(5);
    expect(part.lastUsed).toBe("2018-05-24");
    expect(part.active).toBe(false);
    expect(part.note).toMatch(/retired on import/);
  });

  it("keeps a part built recently active", () => {
    const fresh = cleanHarnessExport(
      [row(2, { date: "9/1/2026", workOrder: "1002000001", partNumber: "593075-1", qty: "1" })],
      { today: TODAY },
    );
    expect(fresh.parts[0]).toMatchObject({ partNumber: "593075-1", active: true, note: "" });
  });

  it("reports the spelling changes it made", () => {
    expect(result.partChanges.find((c) => c.from === "59327-15")).toMatchObject({ to: "593027-15", rows: 1 });
    expect(result.partChanges.find((c) => c.from === "295495F")?.rule).toBe("Waukesha number");
  });

  it("gives genuine duplicate rows distinct keys", () => {
    const dup = row(4, { date: "5/22/2018", workOrder: "1000073021", partNumber: "593027-15", qty: "25" });
    const out = cleanHarnessExport([dup, { ...dup, line: 5 }], { today: TODAY });
    expect(out.rows[0].legacySource).not.toBe(out.rows[1].legacySource);
  });
});
