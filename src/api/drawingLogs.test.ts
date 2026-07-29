import { describe, it, expect } from "vitest";
import {
  DRAWING_LOGS,
  appendDrawingChange,
  availableDrawingLogs,
  createDrawingLogEntry,
  deleteDrawingLogEntry,
  isDrawingLogAvailable,
  listDrawingLog,
  updateDrawingLogEntry,
} from "./drawingLogs";

// USE_MOCK is true under Vitest — these exercise the in-memory drawing store.

describe("DRAWING_LOGS registry", () => {
  it("marks which registers carry the change log", () => {
    expect(DRAWING_LOGS.cad.hasChangeLog).toBe(true);
    expect(DRAWING_LOGS.ccc.hasChangeLog).toBe(true);
    expect(DRAWING_LOGS.cec.hasChangeLog).toBe(true);
    // Sketches genuinely has no CH_ columns.
    expect(DRAWING_LOGS.sketches.hasChangeLog).toBe(false);
  });

  it("carries a list id for all four registers", () => {
    for (const kind of ["cad", "ccc", "cec", "sketches"] as const) {
      expect(DRAWING_LOGS[kind].listId).toBeTruthy();
      expect(isDrawingLogAvailable(kind)).toBe(true);
    }
    expect(availableDrawingLogs().map((s) => s.kind)).toEqual(["cad", "ccc", "cec", "sketches"]);
  });
});

describe("listDrawingLog (mock)", () => {
  it("returns only the requested register's rows", async () => {
    for (const kind of ["cad", "ccc", "cec", "sketches"] as const) {
      const rows = await listDrawingLog(kind);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((e) => e.kind === kind)).toBe(true);
    }
  });

  it("gives CAD rows their own fields populated", async () => {
    // The bug this guards: CAD was mapped with CCC's column names, so every
    // field came back blank.
    const rows = await listDrawingLog("cad");
    const row = rows.find((e) => e.values.drawingNo === "501 505");
    expect(row).toBeDefined();
    expect(row!.values.cadNumber).toBe("501505");
    expect(row!.values.drawingTitle).toBe("CAPACITOR 66µF, 250VDC");
    expect(row!.values.size).toBe("B");
    expect(row!.values.dateCompleted).toBeInstanceOf(Date);
  });

  it("sorts each register by its own date columns, most recent first", async () => {
    const cad = await listDrawingLog("cad");
    const times = cad
      .map((e) => (e.values.dateCompleted instanceof Date ? e.values.dateCompleted.getTime() : null))
      .filter((t): t is number => t !== null);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("carries the parsed change log through", async () => {
    const rows = await listDrawingLog("cad");
    const withChanges = rows.find((e) => e.changes.length > 0);
    expect(withChanges).toBeDefined();
    expect(withChanges!.changes[0]).toHaveProperty("ecn");
  });
});

describe("create / update / delete (mock)", () => {
  it("creates a CAD drawing with CAD's fields", async () => {
    const created = await createDrawingLogEntry("cad", {
      drawingNo: "  999 001  ",
      cadNumber: "999001",
      drawingTitle: "TEST WIDGET",
      size: "B",
      newRevision: "0",
      dateCompleted: new Date("2026-02-02T12:00:00Z"),
    });
    expect(created.values.drawingNo).toBe("999 001");
    expect(created.values.drawingTitle).toBe("TEST WIDGET");
    expect(created.changes).toEqual([]);
    // New rows have no legacy key.
    expect(created.values.legacyId).toBeNull();
  });

  it("creates a sketch with the sketch fields", async () => {
    const created = await createDrawingLogEntry("sketches", {
      title: "A TEST SKETCH",
      sketchNumber: 9999,
      ventura: "TST",
    });
    expect(created.values.sketchNumber).toBe(9999);
    expect(created.values.ventura).toBe("TST");
  });

  it("updates a drawing's fields", async () => {
    const created = await createDrawingLogEntry("ccc", { drawingNo: "999 002", partNo: "999002" });
    const updated = await updateDrawingLogEntry("ccc", created.id, {
      drawingNo: "999 002",
      partNo: "999002",
      description: "RENAMED",
    });
    expect(updated.values.description).toBe("RENAMED");
  });

  it("never leaks the legacy key into a write", async () => {
    const rows = await listDrawingLog("cad");
    const row = rows.find((e) => e.values.legacyId !== null)!;
    const updated = await updateDrawingLogEntry("cad", row.id, {
      drawingNo: String(row.values.drawingNo),
    });
    // The legacy key survives untouched, because writes skip read-only fields.
    expect(updated.values.legacyId).toBe(row.values.legacyId);
  });

  it("throws for an unknown id, and for an id in the wrong register", async () => {
    await expect(updateDrawingLogEntry("ccc", 99999999, {})).rejects.toThrow(/not found/);
    const sketch = await createDrawingLogEntry("sketches", { title: "X" });
    // Same id, wrong register — must not cross the streams.
    await expect(updateDrawingLogEntry("ccc", sketch.id, {})).rejects.toThrow(/not found/);
  });

  it("deletes a drawing", async () => {
    const created = await createDrawingLogEntry("ccc", { drawingNo: "999 003" });
    await deleteDrawingLogEntry("ccc", created.id);
    const rows = await listDrawingLog("ccc");
    expect(rows.some((e) => e.id === created.id)).toBe(false);
  });
});

describe("appendDrawingChange (mock)", () => {
  it("appends into the first free slot and updates CCC's revision", async () => {
    const created = await createDrawingLogEntry("ccc", { drawingNo: "999 010" });
    const updated = await appendDrawingChange("ccc", created.id, {
      date: new Date("2026-07-01T12:00:00Z"),
      ecn: "ECN-5000",
      rev: "B",
    });
    expect(updated.changes).toHaveLength(1);
    expect(updated.changes[0]).toMatchObject({ slot: 1, ecn: "ECN-5000", rev: "B" });
    // Recording a revision is what makes it the current revision.
    expect(updated.values.revNo).toBe("B");
    expect((updated.values.dateRevised as Date).getUTCFullYear()).toBe(2026);
  });

  it("updates CAD's differently-named revision fields", async () => {
    const created = await createDrawingLogEntry("cad", { drawingNo: "999 011" });
    const updated = await appendDrawingChange("cad", created.id, {
      date: new Date("2026-07-01T12:00:00Z"),
      ecn: "250999",
      rev: "3",
    });
    expect(updated.values.newRevision).toBe("3");
    expect((updated.values.dateCompleted as Date).getUTCFullYear()).toBe(2026);
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

  it("refuses on a register that has no change columns", async () => {
    const sketches = await listDrawingLog("sketches");
    await expect(
      appendDrawingChange("sketches", sketches[0].id, { date: null, ecn: "X", rev: "1" }),
    ).rejects.toThrow(/doesn't have a change log/i);
  });
});
