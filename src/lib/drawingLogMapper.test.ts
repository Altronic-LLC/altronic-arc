import { describe, it, expect } from "vitest";
import {
  CHANGE_SLOTS,
  buildChangeWriteFields,
  buildDrawingWriteFields,
  changeDateField,
  changeEcnField,
  changeRevField,
  compareDrawingLogEntries,
  drawingLogLabel,
  drawingLogMatches,
  nextFreeChangeSlot,
  parseChangeLog,
  sortDate,
  toDrawingLogEntry,
} from "./drawingLogMapper";
import { DRAWING_LOG_FIELDS, selectColumns, tableFields, writableFields } from "./drawingLogFields";
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
    expect(changes.map((c) => c.slot)).toEqual([1, 2]);
    expect(changes[0]).toMatchObject({ ecn: "ECN-0142", rev: "B" });
    expect(changes[0].date?.getUTCFullYear()).toBe(2003);
  });

  it("returns nothing for a row with no change columns (Sketches)", () => {
    expect(parseChangeLog({ Title: "A SKETCH" })).toEqual([]);
  });

  it("skips empty slots but keeps sparse ones", () => {
    // Real data has gaps — slot 2 blank between 1 and 3.
    expect(parseChangeLog({ CH_ECN01: "ECN-0007", CH_ECN03: "ECN-0031" }).map((c) => c.slot)).toEqual(
      [1, 3],
    );
  });

  it("keeps a slot that has only ONE of the three values", () => {
    // A change with an ECN but no date is still a change; dropping it because
    // one cell is blank would lose history.
    expect(parseChangeLog({ CH_ECN04: "ECN-9" })).toHaveLength(1);
    expect(parseChangeLog({ CH_DAT05: "2001-01-01T12:00:00Z" })).toHaveLength(1);
    expect(parseChangeLog({ CH_REV06: "D" })).toHaveLength(1);
  });

  it("reads all sixteen slots and ignores a seventeenth", () => {
    const fields: Record<string, unknown> = {};
    for (let i = 1; i <= 16; i += 1) fields[changeEcnField(i)] = `ECN-${i}`;
    expect(parseChangeLog(fields)).toHaveLength(16);
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

  it("returns null when all sixteen are used", () => {
    expect(nextFreeChangeSlot(Array.from({ length: 16 }, (_, i) => ch(i + 1)))).toBeNull();
  });
});

describe("buildChangeWriteFields", () => {
  it("writes the triple into the given slot", () => {
    const fields = buildChangeWriteFields("ccc", 3, {
      date: new Date("2026-05-04T12:00:00Z"),
      ecn: " ECN-1187 ",
      rev: " C ",
    });
    expect(fields.CH_DAT03).toBe("2026-05-04T12:00:00Z");
    expect(fields.CH_ECN03).toBe("ECN-1187");
    expect(fields.CH_REV03).toBe("C");
  });

  it("advances CCC's own revision and revised date", () => {
    // Otherwise the table disagrees with the change log underneath it.
    const fields = buildChangeWriteFields("ccc", 1, {
      date: new Date("2026-05-04T12:00:00Z"),
      ecn: "ECN-1",
      rev: "C",
    });
    expect(fields.REV_NO).toBe("C");
    expect(fields.DATE_REV).toBe("2026-05-04T12:00:00Z");
  });

  it("advances CAD's equivalents, which are named differently", () => {
    // CAD calls them NewRevision and DateCompleted — the whole reason the
    // columns are declared per register rather than hardcoded.
    const fields = buildChangeWriteFields("cad", 1, {
      date: new Date("2026-05-04T12:00:00Z"),
      ecn: "250112",
      rev: "2",
    });
    expect(fields.NewRevision).toBe("2");
    expect(fields.DateCompleted).toBe("2026-05-04T12:00:00Z");
    expect(fields).not.toHaveProperty("REV_NO");
  });

  it("leaves the revision alone when the change carries none", () => {
    const fields = buildChangeWriteFields("ccc", 1, { date: null, ecn: "ECN-1", rev: "" });
    expect(fields).not.toHaveProperty("REV_NO");
    expect(fields.CH_DAT01).toBeNull();
  });
});

describe("field descriptors", () => {
  it("gives CAD its own columns — it is NOT a CCC clone", () => {
    const cad = DRAWING_LOG_FIELDS.cad.fields.map((f) => f.column);
    expect(cad).toContain("CADNumber");
    expect(cad).toContain("DrawingTitle");
    expect(cad).toContain("DateCompleted");
    expect(cad).toContain("SIZE");
    // The CCC spellings simply don't exist on CAD.
    expect(cad).not.toContain("PARTNO");
    expect(cad).not.toContain("DESCR");
    expect(cad).not.toContain("DWG_SIZE");
    expect(cad).not.toContain("REV_NO");
  });

  it("keeps CAD's drawing number and CAD number as separate fields", () => {
    // Title is "501 505" while CADNumber is "501505" — related but not the same.
    const keys = DRAWING_LOG_FIELDS.cad.fields.map((f) => f.key);
    expect(keys).toContain("drawingNo");
    expect(keys).toContain("cadNumber");
  });

  it("selects each register's own columns plus the change log", () => {
    const cad = selectColumns("cad");
    expect(cad).toContain("CADNumber");
    expect(cad).toContain("CH_DAT01");
    expect(cad).toContain("CH_REV16");
    expect(cad.match(/CH_/g)).toHaveLength(48);
  });

  it("asks Sketches for no change columns, because it has none", () => {
    const sketches = selectColumns("sketches");
    expect(sketches).not.toContain("CH_");
    expect(sketches).toContain("SK_Num");
  });

  it("excludes the legacy id from writable fields on every register", () => {
    for (const kind of ["cad", "ccc", "cec", "sketches"] as const) {
      const columns = writableFields(kind).map((f) => f.column);
      expect(columns).not.toContain("PrimKey");
      expect(columns).not.toContain("CCC_ID");
      expect(columns).not.toContain("CEC_ID");
      expect(columns).not.toContain("SK_ID");
    }
  });

  it("shows a sensible subset in the table", () => {
    // Everything appears in the detail panel; the table is narrower on purpose.
    for (const kind of ["cad", "ccc", "cec", "sketches"] as const) {
      const shown = tableFields(kind).length;
      expect(shown).toBeGreaterThan(3);
      expect(shown).toBeLessThanOrEqual(DRAWING_LOG_FIELDS[kind].fields.length);
    }
  });
});

describe("toDrawingLogEntry", () => {
  it("maps a CAD row using CAD's column names", () => {
    const entry = toDrawingLogEntry(
      item(
        {
          Title: "501 505",
          CADNumber: "501505",
          DrawingTitle: "CAPACITOR 66µF, 250VDC",
          SIZE: "B",
          NewRevision: "2",
          DateCompleted: "2025-12-30T12:00:00Z",
          DrawingDATE: "2025-12-30T12:00:00Z",
          PrimKey: 17832,
          CH_DAT01: "2010-04-23T12:00:00Z",
          CH_ECN01: "100027",
          CH_REV01: "1",
        },
        "401",
      ),
      "cad",
    );
    expect(entry.id).toBe(401);
    expect(entry.values.drawingNo).toBe("501 505");
    expect(entry.values.cadNumber).toBe("501505");
    expect(entry.values.drawingTitle).toBe("CAPACITOR 66µF, 250VDC");
    expect(entry.values.size).toBe("B");
    expect(entry.values.legacyId).toBe(17832);
    expect((entry.values.dateCompleted as Date).getUTCFullYear()).toBe(2025);
    expect(entry.changes).toHaveLength(1);
  });

  it("maps a CCC row using CCC's column names", () => {
    const entry = toDrawingLogEntry(
      item({
        Title: "50100008",
        PARTNO: "50100008",
        DESCR: "ASSEMBLY, EXPLODED, AGV10",
        DWG_SIZE: "D",
        REV_NO: "C",
        DATE_ST: "2002-01-15T12:00:00Z",
        CCC_ID: 1,
      }),
      "ccc",
    );
    expect(entry.values.partNo).toBe("50100008");
    expect(entry.values.description).toBe("ASSEMBLY, EXPLODED, AGV10");
    expect(entry.values.revNo).toBe("C");
    expect(entry.values.legacyId).toBe(1);
  });

  it("maps a sketch row, never producing a change log", () => {
    const entry = toDrawingLogEntry(
      item({ Title: "A SKETCH", SK_Num: 2274, V_CODE: 12, VENTURA: "GGT", SK_ID: 3286 }, "701"),
      "sketches",
    );
    expect(entry.values.sketchNumber).toBe(2274);
    expect(entry.values.ventura).toBe("GGT");
    expect(entry.changes).toEqual([]);
  });

  it("defaults absent columns rather than yielding undefined", () => {
    const entry = toDrawingLogEntry(item({}), "cad");
    expect(entry.values.drawingNo).toBe("");
    expect(entry.values.dateCompleted).toBeNull();
    expect(entry.values.legacyId).toBeNull();
  });
});

describe("buildDrawingWriteFields", () => {
  it("writes CAD's columns, trimmed, and never the legacy key", () => {
    const fields = buildDrawingWriteFields("cad", {
      drawingNo: "  501 505  ",
      cadNumber: " 501505 ",
      drawingTitle: " CAPACITOR ",
      size: "B",
      newRevision: "2",
      dateCompleted: new Date("2025-12-30T12:00:00Z"),
      drawingDate: null,
      logBookDate: null,
      newDrawing: "",
      software: "",
    });
    expect(fields.Title).toBe("501 505");
    expect(fields.CADNumber).toBe("501505");
    expect(fields.DrawingTitle).toBe("CAPACITOR");
    expect(fields.DateCompleted).toBe("2025-12-30T12:00:00Z");
    expect(fields.DrawingDATE).toBeNull();
    expect(fields).not.toHaveProperty("PrimKey");
  });

  it("never writes another register's column names", () => {
    const cad = buildDrawingWriteFields("cad", { drawingNo: "X" });
    expect(cad).not.toHaveProperty("PARTNO");
    expect(cad).not.toHaveProperty("DWG_SIZE");

    const sketches = buildDrawingWriteFields("sketches", { title: "X" });
    expect(sketches).not.toHaveProperty("PARTNO");
    expect(sketches).not.toHaveProperty("CADNumber");
    expect(sketches.SK_Num).toBeNull();
  });
});

describe("drawingLogLabel", () => {
  const mk = (kind: DrawingLogEntry["kind"], values: Record<string, unknown>): DrawingLogEntry =>
    ({ id: 1, kind, values, changes: [] }) as unknown as DrawingLogEntry;

  it("pairs CAD's drawing number with its title", () => {
    expect(mk("cad", { drawingNo: "501 505", drawingTitle: "CAPACITOR" })).toBeDefined();
    expect(drawingLogLabel(mk("cad", { drawingNo: "501 505", drawingTitle: "CAPACITOR" }))).toBe(
      "501 505 (CAPACITOR)",
    );
  });

  it("pairs CCC's drawing number with its part number", () => {
    expect(drawingLogLabel(mk("ccc", { drawingNo: "EC09002", partNo: "501500" }))).toBe(
      "EC09002 (501500)",
    );
  });

  it("doesn't repeat itself when both halves match", () => {
    expect(drawingLogLabel(mk("ccc", { drawingNo: "50100008", partNo: "50100008" }))).toBe(
      "50100008",
    );
  });

  it("never returns empty", () => {
    expect(drawingLogLabel(mk("sketches", { title: "" }))).toBe("(untitled drawing)");
  });
});

describe("sorting", () => {
  const mk = (kind: DrawingLogEntry["kind"], id: number, values: Record<string, unknown>) =>
    ({ id, kind, values, changes: [] }) as unknown as DrawingLogEntry;

  it("uses each register's own date columns", () => {
    // CAD sorts on DateCompleted; CCC on DATE_REV.
    expect(sortDate(mk("cad", 1, { dateCompleted: new Date("2026-01-01T12:00:00Z") }))).toBe(
      new Date("2026-01-01T12:00:00Z").getTime(),
    );
    expect(sortDate(mk("ccc", 1, { dateRevised: new Date("2024-01-01T12:00:00Z") }))).toBe(
      new Date("2024-01-01T12:00:00Z").getTime(),
    );
  });

  it("falls back to the next sort key when the first is empty", () => {
    const entry = mk("cad", 1, { dateCompleted: null, drawingDate: new Date("2020-05-05T12:00:00Z") });
    expect(sortDate(entry)).toBe(new Date("2020-05-05T12:00:00Z").getTime());
  });

  it("sorts most recent first and undated last", () => {
    const rows = [
      mk("ccc", 1, { dateRevised: null }),
      mk("ccc", 2, { dateRevised: new Date("2024-01-01T12:00:00Z") }),
      mk("ccc", 3, { dateRevised: new Date("1990-01-01T12:00:00Z") }),
    ].sort(compareDrawingLogEntries);
    expect(rows.map((r) => r.id)).toEqual([2, 3, 1]);
  });
});

describe("drawingLogMatches", () => {
  const entry = {
    id: 1,
    kind: "cad",
    values: {
      drawingNo: "501 505",
      cadNumber: "501505",
      drawingTitle: "CAPACITOR 66µF, 250VDC",
      size: "B",
      legacyId: 17832,
    },
    changes: [{ slot: 1, date: null, ecn: "100027", rev: "1" }],
  } as unknown as DrawingLogEntry;

  it("matches any declared field", () => {
    expect(drawingLogMatches(entry, ["501505"])).toBe(true);
    expect(drawingLogMatches(entry, ["capacitor"])).toBe(true);
    expect(drawingLogMatches(entry, ["17832"])).toBe(true);
  });

  it("finds a drawing by an ECN in its change log", () => {
    // Otherwise unanswerable — the ECNs are buried in 48 columns the table
    // never shows.
    expect(drawingLogMatches(entry, ["100027"])).toBe(true);
  });

  it("requires every token", () => {
    expect(drawingLogMatches(entry, ["capacitor", "100027"])).toBe(true);
    expect(drawingLogMatches(entry, ["capacitor", "nonsense"])).toBe(false);
  });

  it("matches everything with no tokens", () => {
    expect(drawingLogMatches(entry, [])).toBe(true);
  });
});
