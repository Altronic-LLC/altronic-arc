import { describe, expect, it } from "vitest";
import { MOCK_ALTRONIC_COMPONENTS, MOCK_ALTRONIC_PARTS } from "@/data/altronicPartsMockData";
import {
  applyFieldQueries,
  applyRangeQueries,
  unreadableCount,
  buildPartsBooks,
  fieldQueryMatches,
  fieldQueryTerms,
  parsePartsQuery,
  partPath,
  toGlobalRows,
  type SearchField,
} from "./partSearch";

describe("field queries — the old app's rules", () => {
  it("is a case-insensitive substring match", () => {
    // The guide's own example: "apacit" finds capacitor.
    expect(fieldQueryMatches("CAPACITOR - CERAMIC", "apacit")).toBe(true);
    expect(fieldQueryMatches("RESISTOR", "apacit")).toBe(false);
  });

  it("treats an empty query as no constraint", () => {
    expect(fieldQueryTerms("")).toEqual([]);
    expect(fieldQueryTerms("   ")).toEqual([]);
    expect(fieldQueryMatches("anything", "")).toBe(true);
  });

  it("with &, requires every term", () => {
    expect(fieldQueryMatches("Resistor 1K 1/4W", "resistor&1k")).toBe(true);
    expect(fieldQueryMatches("Resistor 10K", "resistor&1/4w")).toBe(false);
  });

  it("keeps the spaces around & — they are part of the search", () => {
    // The guide: "hello & world" does NOT match "helloworld".
    expect(fieldQueryMatches("helloworld", "hello & world")).toBe(false);
    expect(fieldQueryMatches("hello there world", "hello & world")).toBe(true);
    expect(fieldQueryMatches("helloworld", "hello&world")).toBe(true);
  });

  it("trims a query with no & — a trailing space is a typo", () => {
    expect(fieldQueryMatches("RESISTOR", "resistor ")).toBe(true);
  });

  it("ignores empty terms either side of an &", () => {
    expect(fieldQueryTerms("resistor&")).toEqual(["resistor"]);
    expect(fieldQueryTerms("& &1k")).toEqual(["1k"]);
  });

  it("ANDs across fields and skips the empty ones", () => {
    type Row = { a: string; b: string };
    const fields: SearchField<Row>[] = [
      { key: "a", label: "A", value: (r) => r.a },
      { key: "b", label: "B", value: (r) => r.b },
    ];
    const rows: Row[] = [
      { a: "resistor", b: "vishay" },
      { a: "resistor", b: "yageo" },
      { a: "diode", b: "vishay" },
    ];
    expect(applyFieldQueries(rows, fields, { a: "res", b: "vish" })).toEqual([rows[0]]);
    expect(applyFieldQueries(rows, fields, { a: "", b: "vish" })).toEqual([rows[0], rows[2]]);
    expect(applyFieldQueries(rows, fields, {})).toBe(rows);
  });
});

describe("field queries — value fields match where a number starts", () => {
  it("finds 1uF but not .1uF, .01uF or 11uF", () => {
    expect(fieldQueryMatches("1uF", "1uF", true)).toBe(true);
    expect(fieldQueryMatches("1UF", "1uf", true)).toBe(true);
    expect(fieldQueryMatches(".1uF", "1uF", true)).toBe(false);
    expect(fieldQueryMatches(".01uF", "1uF", true)).toBe(false);
    expect(fieldQueryMatches("0.1uF", "1uF", true)).toBe(false);
    expect(fieldQueryMatches("11uF", "1uF", true)).toBe(false);
  });

  it("still matches a number after a space, label or sign", () => {
    expect(fieldQueryMatches("C: 1uF", "1uF", true)).toBe(true);
    expect(fieldQueryMatches("±10%", "10%", true)).toBe(true);
    expect(fieldQueryMatches("-55°C", "55", true)).toBe(true);
    expect(fieldQueryMatches("4.5V TO 5.5V", "5.5v", true)).toBe(true);
  });

  it("stops 50V finding 250V", () => {
    expect(fieldQueryMatches("250V", "50V", true)).toBe(false);
    expect(fieldQueryMatches("50V", "50V", true)).toBe(true);
  });

  it("lets .1uF find 0.1uF, its other spelling, but not 1.1uF", () => {
    expect(fieldQueryMatches(".1uF", ".1uF", true)).toBe(true);
    expect(fieldQueryMatches("0.1uF", ".1uF", true)).toBe(true);
    expect(fieldQueryMatches("1.1uF", ".1uF", true)).toBe(false);
    expect(fieldQueryMatches("10.1uF", ".1uF", true)).toBe(false);
  });

  it("finds a later occurrence when the first is mid-number", () => {
    expect(fieldQueryMatches(".1uF OR 1uF", "1uF", true)).toBe(true);
  });

  it("leaves a term starting with a letter as plain substring", () => {
    // A digit after a LETTER is fine — only a digit or "." before it is mid-number.
    expect(fieldQueryMatches("X7R", "7r", true)).toBe(true);
    expect(fieldQueryMatches("X7R", "x7", true)).toBe(true);
    expect(fieldQueryMatches("ISOLATED", "sol", true)).toBe(true);
  });

  it("is off for the other fields — 1018 still finds 701018", () => {
    expect(fieldQueryMatches("701018", "1018")).toBe(true);
    expect(fieldQueryMatches(".1uF", "1uF")).toBe(true);
  });

  it("applyFieldQueries uses it on range fields only", () => {
    type Row = { pn: string; rating: string };
    const fields: SearchField<Row>[] = [
      { key: "pn", label: "Part #", value: (r) => r.pn },
      { key: "rating", label: "Rating A", value: (r) => r.rating, range: true },
    ];
    const rows: Row[] = [
      { pn: "701018", rating: ".01uF" },
      { pn: "701112", rating: "1uF" },
      { pn: "701135", rating: ".1uF" },
    ];
    expect(applyFieldQueries(rows, fields, { rating: "1uF" })).toEqual([rows[1]]);
    expect(applyFieldQueries(rows, fields, { pn: "1018" })).toEqual([rows[0]]);
  });
});

describe("buildPartsBooks", () => {
  it("groups by first digit, then three-digit list, with counts", () => {
    const books = buildPartsBooks(["601110", "601138", "611075", "101022", "610086"]);
    expect(books.map((b) => b.book)).toEqual([1, 6]);
    const six = books.find((b) => b.book === 6)!;
    expect(six.count).toBe(4);
    expect(six.lists).toEqual([
      { prefix: "601", count: 2, component: true },
      { prefix: "610", count: 1, component: false },
      { prefix: "611", count: 1, component: true },
    ]);
  });

  it("leaves out a number with no three-digit list", () => {
    expect(buildPartsBooks(["", "AB123"])).toEqual([]);
  });

  it("counts every mock part exactly once", () => {
    const all = [...MOCK_ALTRONIC_PARTS, ...MOCK_ALTRONIC_COMPONENTS].map((p) => p.partNumber);
    const total = buildPartsBooks(all).reduce((n, b) => n + b.count, 0);
    expect(total).toBe(all.length);
  });
});

describe("parsePartsQuery — the landing page's box", () => {
  it("opens a book for a single digit", () => {
    expect(parsePartsQuery("6")).toEqual({ kind: "book", book: 6 });
  });

  it("opens a list for three digits", () => {
    expect(parsePartsQuery(" 601 ")).toEqual({ kind: "list", prefix: "601" });
  });

  it("jumps to a part for a whole part number, suffix and all", () => {
    expect(parsePartsQuery("601110")).toEqual({ kind: "part", partNumber: "601110" });
    expect(parsePartsQuery("601427HT")).toEqual({ kind: "part", partNumber: "601427HT" });
    expect(parsePartsQuery("791950-08")).toEqual({ kind: "part", partNumber: "791950-08" });
  });

  it("searches for anything else, so the box is never a dead end", () => {
    expect(parsePartsQuery("usb modbus")).toEqual({ kind: "search", query: "usb modbus" });
    expect(parsePartsQuery("0")).toEqual({ kind: "search", query: "0" });
  });

  it("does nothing for an empty box", () => {
    expect(parsePartsQuery("  ")).toBeNull();
  });
});

describe("toGlobalRows", () => {
  const rows = toGlobalRows(MOCK_ALTRONIC_PARTS, MOCK_ALTRONIC_COMPONENTS);

  it("holds every part from both lists", () => {
    expect(rows).toHaveLength(MOCK_ALTRONIC_PARTS.length + MOCK_ALTRONIC_COMPONENTS.length);
  });

  it("gives every row a key unique across both lists", () => {
    // Item ids repeat across the two lists (both start at 1).
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("maps the two lists' manufacturer columns onto one", () => {
    const part = rows.find((r) => r.partNumber === "504017")!;
    expect(part).toMatchObject({ kind: "part", manufacturer: "Panduit", mfgNumber: "LCA2-14-L", kindLabel: "Part List" });
    const comp = rows.find((r) => r.partNumber === "601110")!;
    expect(comp).toMatchObject({ kind: "component", manufacturer: "VISHAY", mfgNumber: "MBA02040C1003FRP00", kindLabel: "Through Hole", list: "601" });
  });

  it("sorts by part number across both lists", () => {
    const numbers = rows.map((r) => r.partNumber);
    expect(numbers.indexOf("602350")).toBeLessThan(numbers.indexOf("604596"));
    expect(numbers.indexOf("601466")).toBeLessThan(numbers.indexOf("602350"));
  });

  it("links each row to its own list's page", () => {
    expect(partPath("part", 4)).toBe("/engineering/parts/part/4");
    expect(partPath("component", 4)).toBe("/engineering/parts/component/4");
  });
});

describe("applyRangeQueries", () => {
  interface Row {
    id: number;
    rating: string;
    temp: string;
  }
  const rows: Row[] = [
    { id: 1, rating: "4K7", temp: "125°C" },
    { id: 2, rating: "10K0", temp: "155°C" },
    { id: 3, rating: "SEE DATA SHEET", temp: "85°C" },
    { id: 4, rating: "", temp: "-55°C" },
  ];
  const fields = [
    { key: "rating", label: "Rating", value: (r: Row) => r.rating, range: true },
    { key: "temp", label: "Temp", value: (r: Row) => r.temp, range: true },
    { key: "plain", label: "Plain", value: (r: Row) => r.rating },
  ];
  const ids = (out: Row[]) => out.map((r) => r.id);

  it("keeps rows whose value is in range", () => {
    expect(ids(applyRangeQueries(rows, fields, { rating: { from: "1K", to: "5K" } }))).toEqual([1]);
  });

  it("ANDs ranges across fields, like the text boxes", () => {
    expect(ids(applyRangeQueries(rows, fields, { rating: { from: "1K", to: "" }, temp: { from: "150", to: "" } }))).toEqual([2]);
  });

  it("is no constraint with nothing readable typed", () => {
    expect(applyRangeQueries(rows, fields, { rating: { from: "abc", to: "" } })).toBe(rows);
  });

  it("ignores a range on a field that doesn't offer one", () => {
    expect(applyRangeQueries(rows, fields, { plain: { from: "1K", to: "5K" } })).toBe(rows);
  });

  it("counts values with no number in them, but not blanks", () => {
    expect(unreadableCount(rows, fields[0])).toBe(1);
  });
});

describe("toGlobalRows — ratings for range search", () => {
  const rows = toGlobalRows(MOCK_ALTRONIC_PARTS, MOCK_ALTRONIC_COMPONENTS);

  it("carries a component's ratings and temperatures", () => {
    expect(rows.find((r) => r.partNumber === "701990")).toMatchObject({ ratingA: "4K7", tempMax: "155" });
  });

  it("leaves them blank on a Part List part, which has none", () => {
    expect(rows.find((r) => r.partNumber === "604596")).toMatchObject({ ratingA: "", tempMin: "", tempMax: "" });
  });
});
