import { describe, expect, it } from "vitest";
import {
  allColumnOptions,
  applyColumnFilters,
  columnOptions,
  compareRows,
  compareText,
  dayLabel,
  leadingNumber,
  peopleLabel,
  sortRows,
  type SortColumn,
} from "./tableSort";

interface Row {
  id: number;
  name: string;
  qty: number | null;
  when: Date | null;
  /** A TEXT column that usually holds a number — QC Time's `hoursRaw` shape. */
  hours: string;
}

function row(over: Partial<Row> = {}): Row {
  return { id: 1, name: "", qty: null, when: null, hours: "", ...over };
}

const COLUMNS: SortColumn<Row>[] = [
  { key: "name", label: "Name", value: (r) => r.name },
  { key: "qty", label: "Qty", kind: "number", value: (r) => (r.qty === null ? "" : String(r.qty)), sortValue: (r) => r.qty },
  { key: "when", label: "When", kind: "date", value: (r) => dayLabel(r.when), sortValue: (r) => r.when },
  { key: "hours", label: "Hours", kind: "numeric-text", value: (r) => r.hours },
];

const byId = (r: Row) => r.id;
const sort = (rows: Row[], key: string, direction: "asc" | "desc" = "asc") =>
  sortRows(rows, COLUMNS, key, direction, byId);

describe("compareText", () => {
  it("is case-insensitive", () => {
    expect(compareText("Alpha", "beta")).toBeLessThan(0);
  });

  it("orders embedded numbers naturally", () => {
    // "Panel 10" AFTER "Panel 9", not before it.
    expect(compareText("Panel 9", "Panel 10")).toBeLessThan(0);
  });
});

describe("leadingNumber", () => {
  it("reads a plain number, with or without a unit", () => {
    expect(leadingNumber("6.5")).toBe(6.5);
    expect(leadingNumber(" 4 ")).toBe(4);
    expect(leadingNumber("6.5 hrs")).toBe(6.5);
    expect(leadingNumber("-2")).toBe(-2);
  });

  it("is null when there is no number at the START", () => {
    // "abc 5" is a note that contains a digit, not five of anything.
    expect(leadingNumber("see notes")).toBeNull();
    expect(leadingNumber("abc 5")).toBeNull();
    expect(leadingNumber("")).toBeNull();
    expect(leadingNumber("   ")).toBeNull();
  });
});

describe("text columns", () => {
  it("sorts A→Z and Z→A", () => {
    const rows = [row({ id: 1, name: "Gemini" }), row({ id: 2, name: "AJAX" })];
    expect(sort(rows, "name").map((r) => r.name)).toEqual(["AJAX", "Gemini"]);
    expect(sort(rows, "name", "desc").map((r) => r.name)).toEqual(["Gemini", "AJAX"]);
  });

  it("sinks a BLANK to the bottom in both directions", () => {
    // A blank is the absence of a value, not the smallest one.
    const filled = row({ id: 1, name: "AJAX" });
    const empty = row({ id: 2, name: "" });
    for (const d of ["asc", "desc"] as const) {
      expect(sort([empty, filled], "name", d).map((r) => r.id)).toEqual([1, 2]);
    }
  });
});

describe("number columns", () => {
  it("sorts numerically, not as text", () => {
    // As text "10" would sort before "9".
    const rows = [row({ id: 1, qty: 10 }), row({ id: 2, qty: 9 })];
    expect(sort(rows, "qty").map((r) => r.qty)).toEqual([9, 10]);
  });

  it("sinks null in both directions", () => {
    const filled = row({ id: 1, qty: 5 });
    const empty = row({ id: 2, qty: null });
    for (const d of ["asc", "desc"] as const) {
      expect(sort([empty, filled], "qty", d).map((r) => r.id)).toEqual([1, 2]);
    }
  });

  it("treats a real 0 as a value, not as empty", () => {
    const zero = row({ id: 1, qty: 0 });
    const five = row({ id: 2, qty: 5 });
    expect(sort([five, zero], "qty").map((r) => r.qty)).toEqual([0, 5]);
  });
});

describe("date columns", () => {
  it("sorts oldest-first ascending", () => {
    const rows = [
      row({ id: 1, when: new Date("2026-08-20") }),
      row({ id: 2, when: new Date("2026-08-10") }),
    ];
    expect(sort(rows, "when").map((r) => r.id)).toEqual([2, 1]);
  });

  it("sinks undated rows in both directions", () => {
    const dated = row({ id: 1, when: new Date("2026-08-20") });
    const undated = row({ id: 2, when: null });
    for (const d of ["asc", "desc"] as const) {
      expect(sort([undated, dated], "when", d).map((r) => r.id)).toEqual([1, 2]);
    }
  });

  it("treats an Invalid Date as unsortable rather than ordering by NaN", () => {
    const bad = row({ id: 2, when: new Date("nonsense") });
    const good = row({ id: 1, when: new Date("2026-08-20") });
    expect(sort([bad, good], "when").map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("numeric-text columns — the QC Time Hours lesson, generalised", () => {
  const two = row({ id: 1, hours: "2" });
  const nine = row({ id: 2, hours: "9.5" });
  const note = row({ id: 3, hours: "see notes" });
  const blank = row({ id: 4, hours: "" });
  const all = [two, nine, note, blank];

  it("orders numerically, not as text", () => {
    const rows = [row({ id: 1, hours: "10" }), row({ id: 2, hours: "9.5" })];
    expect(sort(rows, "hours").map((r) => r.hours)).toEqual(["9.5", "10"]);
  });

  it("puts the largest first when descending", () => {
    expect(sort(all, "hours", "desc").slice(0, 2).map((r) => r.hours)).toEqual(["9.5", "2"]);
  });

  it("GROUPS non-numeric values at the end in BOTH directions", () => {
    // A naive numeric sort makes these NaN, and every NaN comparison is
    // false — so they scatter through the list looking correctly sorted.
    for (const d of ["asc", "desc"] as const) {
      const out = sort(all, "hours", d);
      const tail = out.slice(-2).map((r) => r.id);
      expect(tail).toContain(note.id);
      expect(tail).toContain(blank.id);
    }
  });

  it("keeps every row — nothing is dropped for being unparseable", () => {
    expect(sort(all, "hours")).toHaveLength(all.length);
  });

  it("orders the non-numeric tail by its own text, not arbitrarily", () => {
    const a = row({ id: 1, hours: "see notes" });
    const b = row({ id: 2, hours: "ask Kim" });
    expect(sort([a, b], "hours").map((r) => r.hours)).toEqual(["ask Kim", "see notes"]);
  });
});

describe("stability", () => {
  it("breaks ties on the stable key, descending, in both directions", () => {
    const rows = [row({ id: 1, name: "Same" }), row({ id: 5, name: "Same" }), row({ id: 3, name: "Same" })];
    for (const d of ["asc", "desc"] as const) {
      expect(sort(rows, "name", d).map((r) => r.id)).toEqual([5, 3, 1]);
    }
  });
});

describe("an unknown sort key", () => {
  it("returns the rows unchanged rather than throwing", () => {
    // A stale `?sort=` from an older build must not break the screen.
    const rows = [row({ id: 1 }), row({ id: 2 })];
    expect(sort(rows, "nope").map((r) => r.id)).toEqual([1, 2]);
  });

  it("does not mutate the input", () => {
    const rows = [row({ id: 2, name: "b" }), row({ id: 1, name: "a" })];
    sort(rows, "name");
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
  });
});

describe("column options", () => {
  const rows = [
    row({ id: 1, name: "AJAX" }),
    row({ id: 2, name: "Gemini" }),
    row({ id: 3, name: "AJAX" }),
    row({ id: 4, name: "" }),
  ];

  it("lists each distinct value once, blanks excluded, sorted", () => {
    expect(columnOptions(rows, COLUMNS[0])).toEqual(["AJAX", "Gemini"]);
  });

  it("computes every column at once", () => {
    const all = allColumnOptions(rows, COLUMNS);
    expect(all.name).toEqual(["AJAX", "Gemini"]);
    expect(all.hours).toEqual([]);
  });

  it("gives a noFilter column no options", () => {
    const cols: SortColumn<Row>[] = [
      { key: "name", label: "Name", value: (r) => r.name, noFilter: true },
    ];
    expect(allColumnOptions(rows, cols).name).toEqual([]);
  });
});

describe("column filters", () => {
  const a = row({ id: 1, name: "AJAX", hours: "2" });
  const b = row({ id: 2, name: "Gemini", hours: "2" });
  const c = row({ id: 3, name: "AJAX", hours: "9" });
  const all = [a, b, c];

  it("narrows to the picked values", () => {
    const out = applyColumnFilters(all, COLUMNS, { name: new Set(["AJAX"]) });
    expect(out.map((r) => r.id)).toEqual([1, 3]);
  });

  it("ANDs across columns", () => {
    const out = applyColumnFilters(all, COLUMNS, {
      name: new Set(["AJAX"]),
      hours: new Set(["9"]),
    });
    expect(out.map((r) => r.id)).toEqual([3]);
  });

  it("treats an absent or empty set as 'all'", () => {
    expect(applyColumnFilters(all, COLUMNS, {})).toHaveLength(3);
    expect(applyColumnFilters(all, COLUMNS, { name: new Set() })).toHaveLength(3);
  });

  it("ignores a filter for a column that no longer exists", () => {
    expect(applyColumnFilters(all, COLUMNS, { gone: new Set(["x"]) })).toHaveLength(3);
  });
});

describe("label helpers", () => {
  it("joins people, skipping nameless ones", () => {
    expect(peopleLabel([{ displayName: "Kim" }, { displayName: "" }, { displayName: "Ray" }])).toBe(
      "Kim, Ray",
    );
    expect(peopleLabel([])).toBe("");
  });

  it("renders a date as YYYY-MM-DD, and null as blank", () => {
    expect(dayLabel(new Date("2026-08-20T00:00:00Z"))).toBe("2026-08-20");
    expect(dayLabel(null)).toBe("");
  });
});

describe("compareRows directly", () => {
  it("never flips the tiebreak with direction", () => {
    // Otherwise equal rows reorder every time the direction changes, which
    // reads as the table shuffling for no reason.
    const a = row({ id: 1, name: "Same" });
    const b = row({ id: 2, name: "Same" });
    const asc = compareRows(a, b, COLUMNS[0], "asc", byId);
    const desc = compareRows(a, b, COLUMNS[0], "desc", byId);
    expect(Math.sign(asc)).toBe(Math.sign(desc));
  });
});
