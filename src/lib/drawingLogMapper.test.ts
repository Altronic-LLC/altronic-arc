import { describe, it, expect } from "vitest";
import {
  CHANGE_SLOTS,
  buildChangeWriteFields,
  changeDateField,
  changeEcnField,
  changeRevField,
  compareDrawingLogEntries,
  drawingLogLabel,
  drawingLogMatches,
  legacyIdField,
  nextFreeChangeSlot,
  parseChangeLog,
  toDrawingLogEntry,
} from "./drawingLogMapper";
import type { DrawingChange, DrawingLogEntry, GraphListItem } from "@/types/task";

function item(fields: Record<string, unknown>, id = "501"): GraphListItem {
  return {
    id,
    createdDateTime: "2020-01-06T10:00:00Z",
    lastModifiedDateTime: "2026-06-02T11:30:00Z",
    fields: fields as GraphListItem["fields"],
  };
}

describe("change-log column names", () => {
  it("zero-pads the slot, matching the SharePoint columns", () => {
    expect(changeDateField(1)).toBe("CH_DAT01");
    expect(changeEcnField(9)).toBe("CH_ECN09");
    expect(changeRevField(16)).toBe("CH_REV16");
  });

  it("has sixteen slots — the schema's hard ceiling", () => {
    expect(CHANGE_SLOTS).toBe(16);
  });
});

describe("parseChangeLog", () => {
  it("folds the CH_ triples into a list, oldest slot first", () => {
    const changes = parseChangeLog({
      CH_DAT01: "2003-02-13T12:00:00Z",
      CH_ECN01: "ECN-0142",
      CH_REV01: "B",
      CH_DAT02: "2024-03-11T12:00:00Z",
      CH_ECN02: "ECN-1187",
      CH_REV02: "C",
    });
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ slot: 1, ecn: "ECN-0142", rev: "B" });
    expect(changes[1]).toMatchObject({ slot: 2, ecn: "ECN-1187", rev: "C" });
    expect(changes[0].date?.getUTCFullYear()).toBe(2003);
  });

  it("returns nothing for a row with no change columns at all (Sketches)", () => {
    expect(parseChangeLog({ Title: "A SKETCH" })).toEqual([]);
  });

  it("skips empty slots but keeps sparse ones", () => {
    // Real data has gaps — slot 2 blank between 1 and 3.
    const changes = parseChangeLog({
      CH_ECN01: "ECN-0007",
      CH_ECN03: "ECN-0031",
    });
    expect(changes.map((c) => c.slot)).toEqual([1, 3]);
  });

  it("keeps a slot that has only ONE of the three values", () => {
    // A change with an ECN but no date recorded is still a change; dropping it
    // because one cell is blank would lose history.
    expect(parseChangeLog({ CH_ECN04: "ECN-9" })).toHaveLength(1);
    expect(parseChangeLog({ CH_DAT05: "2001-01-01T12:00:00Z" })).toHaveLength(1);
    expect(parseChangeLog({ CH_REV06: "D" })).toHaveLength(1);
  });

  it("trims stray whitespace out of the text values", () => {
    const [change] = parseChangeLog({ CH_ECN01: "  ECN-1  ", CH_REV01: " B " });
    expect(change.ecn).toBe("ECN-1");
    expect(change.rev).toBe("B");
  });

  it("reads all sixteen slots", () => {
    const fields: Record<string, unknown> = {};
    for (let i = 1; i <= 16; i += 1) fields[changeEcnField(i)] = `ECN-${i}`;
    expect(parseChangeLog(fields)).toHaveLength(16);
  });

  it("ignores a seventeenth slot — there is no CH_ECN17 column", () => {
    expect(parseChangeLog({ CH_ECN17: "ECN-nope" })).toEqual([]);
  });
});

describe("nextFreeChangeSlot", () => {
  const ch = (slot: number): DrawingChange => ({ slot, date: null, ecn: "x", rev: "" });

  it("returns 1 for an empty log", () => {
    expect(nextFreeChangeSlot([])).toBe(1);
  });

  it("fills the FIRST gap, not highest + 1", () => {
    // Slot 2 is genuinely empty and usable; skipping it would waste one of only
    // sixteen slots.
    expect(nextFreeChangeSlot([ch(1), ch(3)])).toBe(2);
  });

  it("returns the next slot when the log is contiguous", () => {
    expect(nextFreeChangeSlot([ch(1), ch(2), ch(3)])).toBe(4);
  });

  it("returns null when all sixteen are used", () => {
    const full = Array.from({ length: 16 }, (_, i) => ch(i + 1));
    expect(nextFreeChangeSlot(full)).toBeNull();
  });
});

describe("buildChangeWriteFields", () => {
  it("writes the triple into the given slot", () => {
    const fields = buildChangeWriteFields(3, {
      date: new Date("2026-05-04T12:00:00Z"),
      ecn: " ECN-1187 ",
      rev: " C ",
    });
    expect(fields.CH_DAT03).toBe("2026-05-04T12:00:00Z");
    expect(fields.CH_ECN03).toBe("ECN-1187");
    expect(fields.CH_REV03).toBe("C");
  });

  it("advances the drawing's own revision and revised date to match", () => {
    // Otherwise the table would disagree with the change log underneath it.
    const fields = buildChangeWriteFields(1, {
      date: new Date("2026-05-04T12:00:00Z"),
      ecn: "ECN-1",
      rev: "C",
    });
    expect(fields.REV_NO).toBe("C");
    expect(fields.DATE_REV).toBe("2026-05-04T12:00:00Z");
  });

  it("leaves REV_NO alone when the change carries no revision letter", () => {
    const fields = buildChangeWriteFields(1, { date: null, ecn: "ECN-1", rev: "" });
    expect(fields).not.toHaveProperty("REV_NO");
    expect(fields.CH_DAT01).toBeNull();
  });
});

describe("legacyIdField", () => {
  it("uses each list's own id column", () => {
    expect(legacyIdField("ccc")).toBe("CCC_ID");
    expect(legacyIdField("cec")).toBe("CEC_ID");
    expect(legacyIdField("sketches")).toBe("SK_ID");
    expect(legacyIdField("cad")).toBe("CAD_ID");
  });
});

describe("toDrawingLogEntry", () => {
  it("maps a drawing row including its change log", () => {
    const entry = toDrawingLogEntry(
      item({
        Title: "50100008",
        PARTNO: "50100008",
        DESCR: "ASSEMBLY, EXPLODED, AGV10",
        DATE_ST: "2002-01-15T12:00:00Z",
        DATE_REV: "2003-02-13T12:00:00Z",
        DWG_SIZE: "D",
        REV_NO: "B",
        CCC_ID: 1,
        CH_DAT01: "2003-02-13T12:00:00Z",
        CH_ECN01: "ECN-0142",
        CH_REV01: "B",
      }),
      "ccc",
    );
    expect(entry).toMatchObject({
      id: 501,
      kind: "ccc",
      title: "50100008",
      partNo: "50100008",
      size: "D",
      revNo: "B",
      legacyId: 1,
    });
    expect(entry.changes).toHaveLength(1);
    expect(entry.dateStarted?.getUTCFullYear()).toBe(2002);
  });

  it("maps a sketch row — own fields, no change log", () => {
    const entry = toDrawingLogEntry(
      item(
        {
          Title: "WARTSILLA RUBBER ELEMENT (DAMPER)",
          DATE_ST: "2024-01-24T12:00:00Z",
          DWG_SIZE: "B",
          SK_ID: 3286,
          SK_Num: 2274,
          V_CODE: 12,
          VENTURA: "GGT",
        },
        "701",
      ),
      "sketches",
    );
    expect(entry).toMatchObject({
      kind: "sketches",
      sketchNumber: 2274,
      vCode: 12,
      ventura: "GGT",
      legacyId: 3286,
      partNo: "",
      revNo: "",
    });
    expect(entry.changes).toEqual([]);
  });

  it("defaults absent columns rather than yielding undefined", () => {
    const entry = toDrawingLogEntry(item({}), "ccc");
    expect(entry.title).toBe("");
    expect(entry.partNo).toBe("");
    expect(entry.dateStarted).toBeNull();
    expect(entry.legacyId).toBeNull();
    expect(entry.changes).toEqual([]);
  });
});

describe("drawingLogLabel", () => {
  it("pairs the drawing number with the part number when they differ", () => {
    expect(drawingLogLabel({ title: "EC09002", partNo: "501500" })).toBe("EC09002 (501500)");
  });

  it("doesn't repeat itself when they're the same", () => {
    expect(drawingLogLabel({ title: "50100008", partNo: "50100008" })).toBe("50100008");
  });

  it("falls back to whichever exists, and never returns empty", () => {
    expect(drawingLogLabel({ title: "A SKETCH", partNo: "" })).toBe("A SKETCH");
    expect(drawingLogLabel({ title: "", partNo: "" })).toBe("(untitled drawing)");
  });
});

describe("compareDrawingLogEntries", () => {
  const mk = (id: number, revised: string | null, started: string | null = null) =>
    ({
      id,
      dateRevised: revised ? new Date(revised) : null,
      dateStarted: started ? new Date(started) : null,
    }) as DrawingLogEntry;

  it("sorts most recently revised first", () => {
    const sorted = [mk(1, "1990-01-01T12:00:00Z"), mk(2, "2024-01-01T12:00:00Z")].sort(
      compareDrawingLogEntries,
    );
    expect(sorted.map((e) => e.id)).toEqual([2, 1]);
  });

  it("falls back to the start date when never revised", () => {
    const sorted = [
      mk(1, null, "2001-01-01T12:00:00Z"),
      mk(2, null, "2020-01-01T12:00:00Z"),
    ].sort(compareDrawingLogEntries);
    expect(sorted.map((e) => e.id)).toEqual([2, 1]);
  });

  it("puts rows with no dates at all last", () => {
    const sorted = [mk(1, null), mk(2, "2010-01-01T12:00:00Z"), mk(3, null)].sort(
      compareDrawingLogEntries,
    );
    expect(sorted[0].id).toBe(2);
  });
});

describe("drawingLogMatches", () => {
  const entry = {
    title: "EC09002",
    partNo: "501500",
    description: "PICK-UP / DISC INSTALLATION",
    size: "B",
    revNo: "2",
    ventura: "",
    sketchNumber: null,
    legacyId: 1,
    changes: [
      { slot: 1, date: null, ecn: "ECN-0007", rev: "1" },
      { slot: 3, date: null, ecn: "ECN-0031", rev: "2" },
    ],
  } as DrawingLogEntry;

  it("matches the drawing number, part number and description", () => {
    expect(drawingLogMatches(entry, ["ec09002"])).toBe(true);
    expect(drawingLogMatches(entry, ["501500"])).toBe(true);
    expect(drawingLogMatches(entry, ["pick-up"])).toBe(true);
  });

  it("finds a drawing by an ECN in its change log", () => {
    // "Which drawing did ECN-0031 change?" is otherwise unanswerable — the ECNs
    // are buried in 48 columns and never appear in the table.
    expect(drawingLogMatches(entry, ["ecn-0031"])).toBe(true);
  });

  it("requires every token", () => {
    expect(drawingLogMatches(entry, ["ec09002", "ecn-0007"])).toBe(true);
    expect(drawingLogMatches(entry, ["ec09002", "nonsense"])).toBe(false);
  });

  it("matches everything with no tokens", () => {
    expect(drawingLogMatches(entry, [])).toBe(true);
  });
});
