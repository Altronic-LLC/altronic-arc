import { describe, expect, it } from "vitest";
import {
  applyQcTimeColumnFilters,
  compareQcTimeBy,
  hoursValue,
  onHoldOnly,
  qcTimeColumnOptions,
  qcTimeColumnValue,
  QC_TIME_SORT_COLUMNS,
} from "./qcTimeSort";
import type { QcTimeEntry } from "@/types/task";

function entry(over: Partial<QcTimeEntry> = {}): QcTimeEntry {
  return {
    id: 1,
    project: "",
    week: null,
    dateIntoQc: null,
    dateStarted: null,
    sapNo: "",
    serialNo: "",
    performedBy: [],
    performedByRaw: "",
    hoursRaw: "",
    effortType: null,
    notes: "",
    onHold: false,
    holdReason: "",
    createdAt: new Date("2026-01-01"),
    modifiedAt: new Date("2026-01-01"),
    ...over,
  };
}

/** Sort a list the way the view does, so a test reads like the screen. */
function sorted(
  entries: QcTimeEntry[],
  key: Parameters<typeof compareQcTimeBy>[2],
  direction: "asc" | "desc" = "asc",
): QcTimeEntry[] {
  return [...entries].sort((a, b) => compareQcTimeBy(a, b, key, direction));
}

describe("hoursValue — the column is TEXT, not a number", () => {
  it("reads a plain number", () => {
    expect(hoursValue("6.5")).toBe(6.5);
    expect(hoursValue("4")).toBe(4);
  });

  it("tolerates whitespace and a trailing unit", () => {
    expect(hoursValue(" 2.25 ")).toBe(2.25);
    expect(hoursValue("6.5 hrs")).toBe(6.5);
  });

  it("returns null for a value that isn't a number at all", () => {
    // Real data: the source CSV genuinely contains this.
    expect(hoursValue("see notes")).toBeNull();
    expect(hoursValue("")).toBeNull();
    expect(hoursValue("   ")).toBeNull();
  });

  it("returns null when the number isn't at the start", () => {
    // "abc 5" is a note that happens to contain a digit, not 5 hours.
    expect(hoursValue("abc 5")).toBeNull();
  });
});

describe("sorting by hours — spotting the long jobs", () => {
  const short = entry({ id: 1, hoursRaw: "2" });
  const long = entry({ id: 2, hoursRaw: "9.5" });
  const middling = entry({ id: 3, hoursRaw: "6" });
  const nonNumeric = entry({ id: 4, hoursRaw: "see notes" });
  const blank = entry({ id: 5, hoursRaw: "" });
  const all = [short, long, middling, nonNumeric, blank];

  it("orders numerically, not as text", () => {
    // As text, "9.5" sorts before "10" — the bug this guards against.
    const out = sorted([entry({ id: 1, hoursRaw: "10" }), entry({ id: 2, hoursRaw: "9.5" })], "hoursRaw");
    expect(out.map((e) => e.hoursRaw)).toEqual(["9.5", "10"]);
  });

  it("puts the longest first when descending — the actual use case", () => {
    const out = sorted(all, "hoursRaw", "desc");
    expect(out.slice(0, 3).map((e) => e.hoursRaw)).toEqual(["9.5", "6", "2"]);
  });

  it("GROUPS non-numeric hours at the end, in BOTH directions", () => {
    // "see notes" is not zero hours, so it must not sit beside the quick
    // jobs — and it must not vanish either.
    for (const direction of ["asc", "desc"] as const) {
      const out = sorted(all, "hoursRaw", direction);
      const tail = out.slice(-2).map((e) => e.id);
      expect(tail).toContain(nonNumeric.id);
      expect(tail).toContain(blank.id);
    }
  });

  it("keeps every row — nothing is dropped by being unparseable", () => {
    expect(sorted(all, "hoursRaw")).toHaveLength(all.length);
  });
});

describe("sorting by project — alphabetical, as asked", () => {
  it("sorts A→Z and Z→A", () => {
    const entries = [
      entry({ id: 1, project: "Gemini Panel" }),
      entry({ id: 2, project: "AJAX Retrofit" }),
      entry({ id: 3, project: "NGI-5000" }),
    ];
    expect(sorted(entries, "project").map((e) => e.project)).toEqual([
      "AJAX Retrofit",
      "Gemini Panel",
      "NGI-5000",
    ]);
    expect(sorted(entries, "project", "desc").map((e) => e.project)).toEqual([
      "NGI-5000",
      "Gemini Panel",
      "AJAX Retrofit",
    ]);
  });

  it("is case-insensitive", () => {
    const entries = [entry({ id: 1, project: "beta" }), entry({ id: 2, project: "Alpha" })];
    expect(sorted(entries, "project").map((e) => e.project)).toEqual(["Alpha", "beta"]);
  });

  it("orders embedded numbers naturally", () => {
    // "Panel 10" after "Panel 9", not before it.
    const entries = [entry({ id: 1, project: "Panel 10" }), entry({ id: 2, project: "Panel 9" })];
    expect(sorted(entries, "project").map((e) => e.project)).toEqual(["Panel 9", "Panel 10"]);
  });
});

describe("sorting by date", () => {
  it("orders oldest-first ascending", () => {
    const entries = [
      entry({ id: 1, dateStarted: new Date("2026-08-20") }),
      entry({ id: 2, dateStarted: new Date("2026-08-10") }),
    ];
    expect(sorted(entries, "dateStarted").map((e) => e.id)).toEqual([2, 1]);
  });

  it("sinks undated rows to the bottom in BOTH directions", () => {
    // A blank date is the absence of a value, not the earliest one — floating
    // a screenful of blanks to the top buries what was asked for.
    const dated = entry({ id: 1, dateStarted: new Date("2026-08-20") });
    const undated = entry({ id: 2, dateStarted: null });
    for (const direction of ["asc", "desc"] as const) {
      expect(sorted([undated, dated], "dateStarted", direction).map((e) => e.id)).toEqual([1, 2]);
    }
  });
});

describe("the empty-last rule holds for every column", () => {
  it("sinks a blank text value in both directions", () => {
    const filled = entry({ id: 1, sapNo: "SAP-1" });
    const empty = entry({ id: 2, sapNo: "" });
    for (const direction of ["asc", "desc"] as const) {
      expect(sorted([empty, filled], "sapNo", direction).map((e) => e.id)).toEqual([1, 2]);
    }
  });

  it("sinks a blank week in both directions", () => {
    const filled = entry({ id: 1, week: 34 });
    const empty = entry({ id: 2, week: null });
    for (const direction of ["asc", "desc"] as const) {
      expect(sorted([empty, filled], "week", direction).map((e) => e.id)).toEqual([1, 2]);
    }
  });
});

describe("ties are stable", () => {
  it("breaks equal values on id, so an unrelated edit doesn't reshuffle", () => {
    const entries = [
      entry({ id: 1, project: "Same" }),
      entry({ id: 5, project: "Same" }),
      entry({ id: 3, project: "Same" }),
    ];
    expect(sorted(entries, "project").map((e) => e.id)).toEqual([5, 3, 1]);
  });
});

describe("the hold flag", () => {
  it("groups by the REASON, not by Yes/No", () => {
    // "Why are panels stalling" is the question worth answering.
    expect(qcTimeColumnValue(entry({ onHold: true, holdReason: "Missing parts" }), "onHold")).toBe(
      "Missing parts",
    );
  });

  it("falls back to 'On hold' when no reason was given", () => {
    expect(qcTimeColumnValue(entry({ onHold: true, holdReason: "" }), "onHold")).toBe("On hold");
  });

  it("is blank when the panel isn't on hold", () => {
    expect(qcTimeColumnValue(entry({ onHold: false, holdReason: "Missing parts" }), "onHold")).toBe(
      "",
    );
  });

  it("onHoldOnly keeps just the stalled panels", () => {
    const held = entry({ id: 1, onHold: true, holdReason: "Missing parts" });
    const running = entry({ id: 2 });
    expect(onHoldOnly([held, running]).map((e) => e.id)).toEqual([1]);
  });
});

describe("column filters", () => {
  const a = entry({ id: 1, project: "AJAX", effortType: "Support" });
  const b = entry({ id: 2, project: "Gemini", effortType: "New Panel" });
  const c = entry({ id: 3, project: "AJAX", effortType: "New Panel" });
  const all = [a, b, c];

  it("offers each distinct value, blanks excluded", () => {
    expect(qcTimeColumnOptions(all, "project")).toEqual(["AJAX", "Gemini"]);
    expect(qcTimeColumnOptions([...all, entry({ id: 4 })], "project")).toEqual(["AJAX", "Gemini"]);
  });

  it("narrows to the picked values", () => {
    const out = applyQcTimeColumnFilters(all, { project: new Set(["AJAX"]) });
    expect(out.map((e) => e.id)).toEqual([1, 3]);
  });

  it("ANDs across columns", () => {
    const out = applyQcTimeColumnFilters(all, {
      project: new Set(["AJAX"]),
      effortType: new Set(["New Panel"]),
    });
    expect(out.map((e) => e.id)).toEqual([3]);
  });

  it("treats an absent or empty set as 'all'", () => {
    expect(applyQcTimeColumnFilters(all, {})).toHaveLength(3);
    expect(applyQcTimeColumnFilters(all, { project: new Set() })).toHaveLength(3);
  });
});

describe("the column list", () => {
  it("covers every sortable key exactly once", () => {
    const keys = QC_TIME_SORT_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every column a value function that returns a string", () => {
    // A missing switch branch would be `undefined` and break both sort and
    // filter for that column.
    for (const { key } of QC_TIME_SORT_COLUMNS) {
      expect(typeof qcTimeColumnValue(entry(), key)).toBe("string");
    }
  });
});
