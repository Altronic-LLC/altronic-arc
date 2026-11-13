import { describe, expect, it } from "vitest";
import type { QcFormField } from "./qcFormEngine";
import { sheetBlank, sheetDate, type SheetCtx } from "./qcFormSheet";

// =============================================================================
// The shared sheet helpers. Where each value lands is per form (e.g.
// qcCpu95Sheet.test.ts); what's pinned here is HOW a value is written onto a
// blank, for every form: a tick for Yes, the words for No / N/A, a date as
// MM/DD/YYYY, nothing for a hidden or blank-form field, and N/A in print on a
// line the unit doesn't use.
// =============================================================================

const FIELDS: QcFormField[] = [
  { key: "done", column: "Done", label: "Done", kind: "check", section: "S" },
  { key: "flagged", column: "Flagged", label: "Flagged", kind: "flag", section: "S" },
  { key: "tested", column: "Tested", label: "Tested", kind: "date", section: "S" },
  { key: "by", column: "By", label: "By", kind: "text", section: "S" },
];

function ctx(values: Record<string, string>, opts: Partial<SheetCtx> = {}): SheetCtx {
  return {
    ops: [],
    values,
    visible: new Set(FIELDS.map((f) => f.key)),
    filled: true,
    known: true,
    fieldByKey: Object.fromEntries(FIELDS.map((f) => [f.key, f])),
    ...opts,
  };
}

const texts = (c: SheetCtx) => c.ops.flatMap((o) => (o.type === "text" ? [o.text] : []));
const ticks = (c: SheetCtx) => c.ops.filter((o) => o.type === "check").length;

describe("sheetDate", () => {
  it("reads yyyy-mm-dd as MM/DD/YYYY and leaves anything else alone", () => {
    expect(sheetDate("2026-01-05")).toBe("01/05/2026");
    expect(sheetDate(" 5/1/26 ")).toBe("5/1/26");
  });
});

describe("sheetBlank", () => {
  it("always rules the line", () => {
    const c = ctx({});
    sheetBlank(c, 10, 50, 100, "by");
    expect(c.ops[0]).toEqual({ type: "line", x1: 10, y1: 102, x2: 50, y2: 102 });
  });

  it("ticks a Yes check and a set flag, and writes No / N/A in words", () => {
    const c = ctx({ done: "Yes", flagged: "Yes" });
    sheetBlank(c, 0, 10, 0, "done");
    sheetBlank(c, 0, 10, 0, "flagged");
    expect(ticks(c)).toBe(2);

    const no = ctx({ done: "N/A" });
    sheetBlank(no, 0, 10, 0, "done");
    expect(texts(no)).toEqual(["N/A"]);
    expect(no.ops.some((o) => o.type === "text" && o.filled)).toBe(true);
  });

  it("writes a date as MM/DD/YYYY", () => {
    const c = ctx({ tested: "2026-10-14" });
    sheetBlank(c, 0, 10, 0, "tested");
    expect(texts(c)).toEqual(["10/14/2026"]);
  });

  it("writes nothing on a blank form, or for a field the unit hides on an unknown unit", () => {
    const blank = ctx({ by: "JN" }, { filled: false, known: false });
    sheetBlank(blank, 0, 10, 0, "by");
    expect(texts(blank)).toEqual([]);
  });

  it("prints N/A in black on a line the unit doesn't use, never its stale value", () => {
    const c = ctx({ by: "JN" }, { visible: new Set() });
    sheetBlank(c, 0, 10, 0, "by");
    expect(texts(c)).toEqual(["N/A"]);
    expect(c.ops.some((o) => o.type === "text" && o.filled)).toBe(false);
  });
});
