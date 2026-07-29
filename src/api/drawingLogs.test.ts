import { describe, it, expect } from "vitest";
import {
  DRAWING_LOGS,
  appendDrawingChange,
  availableDrawingLogs,
  buildDrawingWriteFields,
  createDrawingLogEntry,
  deleteDrawingLogEntry,
  isDrawingLogAvailable,
  listDrawingLog,
  updateDrawingLogEntry,
} from "./drawingLogs";
import type { DrawingLogInput } from "@/types/task";

// USE_MOCK is true under Vitest — these exercise the in-memory drawing store.

const drawingInput: DrawingLogInput = {
  title: "  90000001  ",
  partNo: "  90000001  ",
  description: "  TEST ASSEMBLY  ",
  size: " C ",
  revNo: " A ",
  dateStarted: new Date("2026-02-02T12:00:00Z"),
  dateRevised: null,
  sketchNumber: null,
  vCode: null,
  ventura: "",
};

const sketchInput: DrawingLogInput = {
  ...drawingInput,
  title: "A TEST SKETCH",
  sketchNumber: 9999,
  vCode: 7,
  ventura: "TST",
};

describe("DRAWING_LOGS registry", () => {
  it("marks which logs carry the change log", () => {
    expect(DRAWING_LOGS.ccc.hasChangeLog).toBe(true);
    expect(DRAWING_LOGS.cec.hasChangeLog).toBe(true);
    expect(DRAWING_LOGS.cad.hasChangeLog).toBe(true);
    // Sketches genuinely has no CH_ columns.
    expect(DRAWING_LOGS.sketches.hasChangeLog).toBe(false);
  });

  it("selects all 48 change columns for the drawing logs", () => {
    for (const kind of ["ccc", "cec", "cad"] as const) {
      const select = DRAWING_LOGS[kind].select;
      expect(select).toContain("CH_DAT01");
      expect(select).toContain("CH_REV16");
      // 16 slots × 3 columns.
      expect(select.match(/CH_/g)).toHaveLength(48);
    }
  });

  it("doesn't ask the Sketches list for columns it hasn't got", () => {
    const select = DRAWING_LOGS.sketches.select;
    expect(select).not.toContain("CH_");
    expect(select).not.toContain("PARTNO");
    expect(select).toContain("SK_Num");
  });

  it("treats every log as available in mock mode", () => {
    // Demo mode shows all four tabs even though CAD has no real list id yet.
    expect(availableDrawingLogs().map((s) => s.kind)).toEqual(["cad", "ccc", "cec", "sketches"]);
    expect(isDrawingLogAvailable("cad")).toBe(true);
  });
});

describe("buildDrawingWriteFields", () => {
  it("writes the drawing columns, trimmed", () => {
    const fields = buildDrawingWriteFields("ccc", drawingInput);
    expect(fields.Title).toBe("90000001");
    expect(fields.PARTNO).toBe("90000001");
    expect(fields.DESCR).toBe("TEST ASSEMBLY");
    expect(fields.DWG_SIZE).toBe("C");
    expect(fields.REV_NO).toBe("A");
    expect(fields.DATE_ST).toBe("2026-02-02T12:00:00Z");
    expect(fields.DATE_REV).toBeNull();
  });

  it("never writes PARTNO / DESCR / REV_NO to Sketches — those columns don't exist", () => {
    // Writing a column a list hasn't got is a 400, so this split matters.
    const fields = buildDrawingWriteFields("sketches", sketchInput);
    expect(fields).not.toHaveProperty("PARTNO");
    expect(fields).not.toHaveProperty("DESCR");
    expect(fields).not.toHaveProperty("REV_NO");
    expect(fields.SK_Num).toBe(9999);
    expect(fields.V_CODE).toBe(7);
    expect(fields.VENTURA).toBe("TST");
  });

  it("never writes the sketch columns to a drawing log", () => {
    const fields = buildDrawingWriteFields("ccc", sketchInput);
    expect(fields).not.toHaveProperty("SK_Num");
    expect(fields).not.toHaveProperty("VENTURA");
  });

  it("never writes the legacy id column", () => {
    for (const kind of ["ccc", "cec", "sketches"] as const) {
      const keys = Object.keys(buildDrawingWriteFields(kind, drawingInput));
      expect(keys.some((k) => /_ID$/.test(k))).toBe(false);
    }
  });
});

describe("listDrawingLog (mock)", () => {
  it("returns only the requested log's rows", async () => {
    const ccc = await listDrawingLog("ccc");
    expect(ccc.length).toBeGreaterThan(0);
    expect(ccc.every((e) => e.kind === "ccc")).toBe(true);

    const sketches = await listDrawingLog("sketches");
    expect(sketches.every((e) => e.kind === "sketches")).toBe(true);
  });

  it("sorts most recently revised first", async () => {
    const rows = await listDrawingLog("cec");
    const dated = rows.filter((e) => e.dateRevised ?? e.dateStarted);
    const times = dated.map((e) => (e.dateRevised ?? e.dateStarted)!.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("carries the parsed change log through", async () => {
    const rows = await listDrawingLog("ccc");
    const withChanges = rows.find((e) => e.changes.length > 0);
    expect(withChanges).toBeDefined();
    expect(withChanges!.changes[0]).toHaveProperty("ecn");
  });
});

describe("create / update / delete (mock)", () => {
  it("creates a drawing", async () => {
    const created = await createDrawingLogEntry("ccc", drawingInput);
    expect(created.title).toBe("90000001");
    expect(created.description).toBe("TEST ASSEMBLY");
    expect(created.changes).toEqual([]);
    expect(created.legacyId).toBeNull();
  });

  it("creates a sketch without the drawing-only fields", async () => {
    const created = await createDrawingLogEntry("sketches", sketchInput);
    expect(created.sketchNumber).toBe(9999);
    expect(created.partNo).toBe("");
    expect(created.revNo).toBe("");
  });

  it("updates a drawing's core fields", async () => {
    const created = await createDrawingLogEntry("ccc", drawingInput);
    const updated = await updateDrawingLogEntry("ccc", created.id, {
      ...drawingInput,
      description: "RENAMED",
    });
    expect(updated.description).toBe("RENAMED");
  });

  it("throws for an unknown id, and for an id in the wrong log", async () => {
    await expect(updateDrawingLogEntry("ccc", 99999999, drawingInput)).rejects.toThrow(/not found/);
    const sketch = await createDrawingLogEntry("sketches", sketchInput);
    // Same id, wrong register — must not cross the streams.
    await expect(updateDrawingLogEntry("ccc", sketch.id, drawingInput)).rejects.toThrow(
      /not found/,
    );
  });

  it("deletes a drawing", async () => {
    const created = await createDrawingLogEntry("ccc", drawingInput);
    await deleteDrawingLogEntry("ccc", created.id);
    const rows = await listDrawingLog("ccc");
    expect(rows.some((e) => e.id === created.id)).toBe(false);
  });
});

describe("appendDrawingChange (mock)", () => {
  it("appends into the first free slot and updates the drawing's revision", async () => {
    const created = await createDrawingLogEntry("ccc", drawingInput);
    const updated = await appendDrawingChange("ccc", created.id, {
      date: new Date("2026-07-01T12:00:00Z"),
      ecn: "ECN-5000",
      rev: "B",
    });
    expect(updated.changes).toHaveLength(1);
    expect(updated.changes[0]).toMatchObject({ slot: 1, ecn: "ECN-5000", rev: "B" });
    // Recording a revision is what makes it the current revision.
    expect(updated.revNo).toBe("B");
    expect(updated.dateRevised?.getUTCFullYear()).toBe(2026);
  });

  it("fills a gap in a sparse log rather than appending past it", async () => {
    // The CEC fixture has slots 1 and 3 used, so the next change belongs in 2.
    const rows = await listDrawingLog("cec");
    const sparse = rows.find((e) => e.changes.map((c) => c.slot).join() === "1,3");
    expect(sparse).toBeDefined();

    const updated = await appendDrawingChange("cec", sparse!.id, {
      date: null,
      ecn: "ECN-GAP",
      rev: "",
    });
    expect(updated.changes.map((c) => c.slot)).toEqual([1, 2, 3]);
    expect(updated.changes.find((c) => c.slot === 2)?.ecn).toBe("ECN-GAP");
  });

  it("refuses when all sixteen slots are used instead of overwriting one", async () => {
    const rows = await listDrawingLog("cec");
    const full = rows.find((e) => e.changes.length === 16);
    expect(full).toBeDefined();

    await expect(
      appendDrawingChange("cec", full!.id, { date: null, ecn: "ECN-17", rev: "Z" }),
    ).rejects.toThrow(/change log is full/i);

    // And nothing was lost.
    const after = await listDrawingLog("cec");
    expect(after.find((e) => e.id === full!.id)?.changes).toHaveLength(16);
  });

  it("refuses on a log that has no change columns", async () => {
    const sketches = await listDrawingLog("sketches");
    await expect(
      appendDrawingChange("sketches", sketches[0].id, { date: null, ecn: "X", rev: "1" }),
    ).rejects.toThrow(/doesn't have a change log/i);
  });
});
