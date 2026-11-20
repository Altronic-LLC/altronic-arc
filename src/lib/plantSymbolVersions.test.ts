import { describe, expect, it } from "vitest";
import type { LayoutComponent, PlantLayoutItem } from "@/types/plant";
import {
  latestByKey,
  latestSymbols,
  newerVersionFor,
  outdatedItems,
  symbolKey,
  symbolSwap,
  symbolVersionIds,
} from "./plantSymbolVersions";
import { editorReducer, initialEditorState, nextItemLabel, placeComponent } from "./plantEditor";
import { placementLayerFor } from "./plantLayers";

// A symbol replaced in ARC is a NEW row with the same key and Version + 1.
// Items point at a row id, so each keeps the version it was drawn with until
// it is updated in a draft.

function sym(id: number, key: string, version: number, extra: Partial<LayoutComponent> = {}): LayoutComponent {
  return {
    id,
    title: key,
    key,
    category: "Machine",
    svgMarkup: "<svg/>",
    footprintW: 100,
    footprintD: 50,
    allowResize: false,
    allowRotate: true,
    minScale: 1,
    maxScale: 1,
    collides: true,
    clearance: 0,
    collisionPolygon: null,
    version,
    active: true,
    ...extra,
  };
}

function item(uid: string, componentId: number, extra: Partial<PlantLayoutItem> = {}): PlantLayoutItem {
  return { uid, componentId, componentVersion: 1, x: 10, y: 10, w: 100, d: 50, rot: 90, label: uid, equipmentId: 7, locked: false, ...extra };
}

const MILL_1 = sym(1, "mill", 1);
const MILL_2 = sym(5, "mill", 2, { footprintW: 120, footprintD: 60 });
const DESK = sym(2, "desk", 1);

describe("symbol versions", () => {
  it("groups by key, case-insensitively; a row with no key is its own symbol", () => {
    expect(symbolKey(sym(1, " Mill ", 1))).toBe("mill");
    expect(symbolKey(sym(9, "", 1))).toBe("#9");
  });

  it("takes the highest version as a symbol's latest, a tie going to the later row", () => {
    const latest = latestByKey([MILL_2, MILL_1, DESK, sym(8, "desk", 1)]);
    expect(latest.get("mill")?.id).toBe(5);
    expect(latest.get("desk")?.id).toBe(8);
  });

  it("shows only each symbol's latest version, in the list's order", () => {
    expect(latestSymbols([MILL_1, DESK, MILL_2]).map((c) => c.id)).toEqual([2, 5]);
  });

  it("knows every version's id of a symbol", () => {
    expect([...symbolVersionIds(MILL_2, [MILL_1, DESK, MILL_2])].sort()).toEqual([1, 5]);
  });

  it("offers the newer version to an item on an older one, and nothing to one on the latest", () => {
    const all = [MILL_1, MILL_2, DESK];
    const byId = new Map(all.map((c) => [c.id, c]));
    const latest = latestByKey(all);
    expect(newerVersionFor(item("a", 1), byId, latest)?.id).toBe(5);
    expect(newerVersionFor(item("b", 5), byId, latest)).toBeNull();
    expect(newerVersionFor(item("c", 2), byId, latest)).toBeNull();
    // A row that isn't loaded can't be compared.
    expect(newerVersionFor(item("d", 99), byId, latest)).toBeNull();
  });

  it("offers nothing when the newest version is retired", () => {
    const retired = sym(5, "mill", 2, { active: false });
    const all = [MILL_1, retired];
    expect(newerVersionFor(item("a", 1), new Map(all.map((c) => [c.id, c])), latestByKey(all))).toBeNull();
  });

  it("an item at the old footprint takes the new one; everything else about it stays", () => {
    const swap = symbolSwap(item("a", 1), MILL_1, MILL_2);
    expect(swap).toEqual({ uid: "a", componentId: 5, componentVersion: 2, w: 120, d: 60 });
  });

  it("a resized item keeps its size, held inside the new version's limits", () => {
    const resizable = sym(5, "mill", 2, { footprintW: 120, footprintD: 60, allowResize: true, minScale: 0.5, maxScale: 2 });
    expect(symbolSwap(item("a", 1, { w: 150, d: 70 }), MILL_1, resizable)).toMatchObject({ w: 150, d: 70 });
    // The new version can't be resized: back to its footprint.
    expect(symbolSwap(item("a", 1, { w: 150, d: 70 }), MILL_1, MILL_2)).toMatchObject({ w: 120, d: 60 });
  });

  it("lists every outdated item on a layout with the swap that updates it", () => {
    const out = outdatedItems([item("a", 1), item("b", 5), item("c", 2)], [MILL_1, MILL_2, DESK]);
    expect(out.map((o) => [o.item.uid, o.to.id])).toEqual([["a", 5]]);
  });
});

describe("updating items in the editor", () => {
  it("moves items to the new version as ONE undo step, keeping where they stand, their lock and asset", () => {
    const start = initialEditorState({ items: [item("a", 1, { locked: true }), item("b", 1), item("c", 2)], areas: [] });
    const swaps = outdatedItems(start.items, [MILL_1, MILL_2, DESK]).map((o) => o.swap);
    const next = editorReducer(start, { type: "swapSymbols", swaps });
    expect(next.items.map((i) => [i.uid, i.componentId, i.componentVersion, i.w])).toEqual([
      ["a", 5, 2, 120],
      ["b", 5, 2, 120],
      ["c", 2, 1, 100],
    ]);
    expect(next.items[0]).toMatchObject({ x: 10, y: 10, rot: 90, locked: true, equipmentId: 7, label: "a" });
    expect(next.past).toHaveLength(1);
    expect(editorReducer(next, { type: "undo" }).items.map((i) => i.componentId)).toEqual([1, 1, 2]);
  });

  it("adds nothing to the history when nothing changes", () => {
    const start = initialEditorState({ items: [item("b", 5, { componentVersion: 2, w: 120, d: 60 })], areas: [] });
    const same = editorReducer(start, { type: "swapSymbols", swaps: [{ uid: "b", componentId: 5, componentVersion: 2, w: 120, d: 60 }] });
    expect(same).toBe(start);
    expect(editorReducer(start, { type: "swapSymbols", swaps: [] })).toBe(start);
  });

  it("numbers and layers a new copy counting the copies on an older version", () => {
    const items = [item("a", 1, { layer: "safety" }), item("b", 1, { layer: "safety" })];
    const ids = symbolVersionIds(MILL_2, [MILL_1, MILL_2]);
    expect(nextItemLabel(MILL_2, items, ids)).toBe("mill 3");
    expect(nextItemLabel(MILL_2, items)).toBe("mill");
    expect(placeComponent(MILL_2, { x: 0, y: 0 }, items, 6, () => 0.5, ids).label).toBe("mill 3");
    expect(placementLayerFor(ids, items)).toEqual({ layer: "safety" });
    expect(placementLayerFor(5, items)).toBeNull();
  });
});
