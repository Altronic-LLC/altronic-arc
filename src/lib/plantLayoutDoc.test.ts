import { describe, expect, it } from "vitest";
import { MOCK_PLANT_LAYOUTS, SAMPLE_CLEAN_ITEMS } from "@/data/plantMockData";
import {
  LAYOUT_JSON_MAX_CHARS,
  buildingSource,
  emptyLayoutDoc,
  layoutKeyFor,
  parseLayoutDoc,
  serializeLayoutDoc,
} from "./plantLayoutDoc";

const EXTENT = { w: 2880, h: 1680 };

describe("parseLayoutDoc", () => {
  it("reads blank as an empty layout of the fallback size", () => {
    expect(parseLayoutDoc("", EXTENT)).toEqual({ ok: true, doc: emptyLayoutDoc(EXTENT), dropped: 0 });
    expect(parseLayoutDoc(null, EXTENT)).toMatchObject({ ok: true });
  });

  it("round-trips what it writes", () => {
    const doc = { schema: 1 as const, units: "in" as const, extent: EXTENT, items: SAMPLE_CLEAN_ITEMS, areas: [] };
    expect(parseLayoutDoc(serializeLayoutDoc(doc), { w: 1, h: 1 })).toEqual({ ok: true, doc, dropped: 0 });
  });

  it("calls anything it can't read CORRUPT rather than empty", () => {
    expect(parseLayoutDoc("{not json", EXTENT)).toMatchObject({ ok: false, reason: expect.stringMatching(/JSON/) });
    expect(parseLayoutDoc("[1,2]", EXTENT)).toMatchObject({ ok: false });
    expect(parseLayoutDoc('{"schema":2,"items":[]}', EXTENT)).toMatchObject({ ok: false, reason: expect.stringMatching(/schema 2/) });
    expect(parseLayoutDoc('{"schema":1}', EXTENT)).toMatchObject({ ok: false, reason: expect.stringMatching(/items/) });
  });

  it("drops a broken item and counts it, keeping the rest", () => {
    const raw = JSON.stringify({
      schema: 1,
      extent: EXTENT,
      items: [
        { uid: "a", componentId: 1, x: 1, y: 2, w: 3, d: 4 },
        { uid: "", componentId: 1, x: 1, y: 2, w: 3, d: 4 },
        { uid: "c", componentId: 1, x: "nope", y: 2, w: 3, d: 4 },
        { uid: "d", componentId: 1, x: 1, y: 2, w: 0, d: 4 },
      ],
    });
    const r = parseLayoutDoc(raw, EXTENT);
    if (!r.ok) throw new Error(r.reason);
    expect(r.dropped).toBe(3);
    expect(r.doc.items).toEqual([
      { uid: "a", componentId: 1, componentVersion: 1, x: 1, y: 2, w: 3, d: 4, rot: 0, label: "", equipmentId: null, locked: false },
    ]);
  });

  it("reads a layout saved before areas existed as having none", () => {
    expect(parseLayoutDoc('{"schema":1,"items":[]}', EXTENT)).toMatchObject({ ok: true, doc: { areas: [] } });
  });

  it("reads areas, dropping a broken one and treating an unknown kind as no-go", () => {
    const raw = JSON.stringify({
      schema: 1,
      items: [],
      areas: [
        { uid: "a_1", kind: "aisle", x: 10, y: 20, w: 30, d: 40, label: "Main aisle" },
        { uid: "a_2", kind: "lava", x: 1, y: 1, w: 2, d: 2 },
        { uid: "", kind: "aisle", x: 1, y: 1, w: 2, d: 2 },
      ],
    });
    const r = parseLayoutDoc(raw, EXTENT);
    if (!r.ok) throw new Error(r.reason);
    expect(r.dropped).toBe(1);
    expect(r.doc.areas).toEqual([
      { uid: "a_1", kind: "aisle", x: 10, y: 20, w: 30, d: 40, rot: 0, label: "Main aisle", locked: false },
      { uid: "a_2", kind: "no-go", x: 1, y: 1, w: 2, d: 2, rot: 0, label: "", locked: false },
    ]);
  });

  it("calls areas that aren't a list corrupt", () => {
    expect(parseLayoutDoc('{"schema":1,"items":[],"areas":"x"}', EXTENT)).toMatchObject({ ok: false });
  });

  it("uses the fallback size when the stored extent is missing or nonsense", () => {
    const r = parseLayoutDoc('{"schema":1,"extent":{"w":-1},"items":[]}', EXTENT);
    expect(r).toMatchObject({ ok: true, doc: { extent: EXTENT } });
  });
});

describe("serializeLayoutDoc", () => {
  it("refuses a layout that won't fit the column, rather than letting SharePoint cut it off", () => {
    const item = SAMPLE_CLEAN_ITEMS[0];
    const label = "x".repeat(2000);
    const items = Array.from({ length: 600 }, (_, i) => ({ ...item, uid: `i_${i}`, label }));
    expect(() => serializeLayoutDoc({ schema: 1, units: "in", extent: EXTENT, items, areas: [] })).toThrow(
      new RegExp(LAYOUT_JSON_MAX_CHARS.toLocaleString()),
    );
  });

  it("saves a layout the size of the Main Plant CAD extract (~1,000 items)", () => {
    const item = SAMPLE_CLEAN_ITEMS[0];
    const items = Array.from({ length: 1300 }, (_, i) => ({ ...item, uid: `i_${i}`, label: `Bench ${i}` }));
    const json = serializeLayoutDoc({ schema: 1, units: "in", extent: EXTENT, items, areas: [] });
    expect(json.length).toBeGreaterThan(63_000);
    expect(parseLayoutDoc(json, EXTENT)).toMatchObject({ ok: true, dropped: 0 });
  });
});

describe("layoutKeyFor", () => {
  it("slugs the title and keeps the suffix", () => {
    expect(layoutKeyFor("Main Plant — Building 2", "x7")).toBe("main-plant-building-2-x7");
    expect(layoutKeyFor("!!!", "x7")).toBe("layout-x7");
  });
});

describe("buildingSource", () => {
  it("takes an existing building's PUBLISHED layout's drawing and areas, whatever its case", () => {
    const src = buildingSource(MOCK_PLANT_LAYOUTS, "  main PLANT ");
    // Layout 2 (the draft) changed more recently, but layout 1 is the published one.
    expect(src?.layout.id).toBe(1);
    expect(src).toMatchObject({ fileId: "mock-walls-main", extent: { w: 2880, h: 1680 } });
    expect(src?.areas.map((a) => a.label)).toContain("Main aisle");
    expect(src?.areas.some((a) => a.label === "Forklift charging")).toBe(false); // that's the draft's
  });

  it("falls back to the newest layout when none is published, and is null for a new building", () => {
    expect(buildingSource(MOCK_PLANT_LAYOUTS, "Panel Plant")?.layout.id).toBe(3);
    expect(buildingSource(MOCK_PLANT_LAYOUTS, "Warehouse 2")).toBeNull();
    expect(buildingSource(MOCK_PLANT_LAYOUTS, " ")).toBeNull();
  });

  it("hands back copies, and no areas from a layout ARC can't read", () => {
    const src = buildingSource(MOCK_PLANT_LAYOUTS, "Panel Plant")!;
    src.areas[0].label = "changed";
    expect(MOCK_PLANT_LAYOUTS[2].doc.areas[0].label).not.toBe("changed");
    const corrupt = [{ ...MOCK_PLANT_LAYOUTS[2], docCorrupt: true }];
    expect(buildingSource(corrupt, "Panel Plant")).toMatchObject({ fileId: "mock-walls-panel", areas: [] });
  });
});
