import { describe, expect, it } from "vitest";
import { MOCK_LAYOUT_COMPONENTS, SAMPLE_CLEAN_ITEMS } from "@/data/plantMockData";
import type { PlantLayoutArea, PlantLayoutItem } from "@/types/plant";
import {
  DUPLICATE_OFFSET,
  areaFromCorners,
  clampAreaSize,
  sameDoc,
  HISTORY_LIMIT,
  clampSize,
  clientToPlan,
  editorReducer,
  initialEditorState,
  newItemUid,
  nextItemLabel,
  normaliseRotation,
  placeComponent,
  sameItems,
  snap,
} from "./plantEditor";

const mill = MOCK_LAYOUT_COMPONENTS.find((c) => c.key === "cnc-vmc-120x96")!;
const rack = MOCK_LAYOUT_COMPONENTS.find((c) => c.key === "pallet-rack-96x42")!;
const item = (uid: string, extra: Partial<PlantLayoutItem> = {}): PlantLayoutItem => ({
  uid,
  componentId: mill.id,
  componentVersion: 1,
  x: 100,
  y: 100,
  w: 120,
  d: 96,
  rot: 0,
  label: uid,
  equipmentId: null,
  locked: false,
  ...extra,
});

describe("editorReducer", () => {
  it("adds, moves and deletes, and undoes and redoes each step", () => {
    let s = initialEditorState([]);
    s = editorReducer(s, { type: "add", item: item("a") });
    s = editorReducer(s, { type: "update", uid: "a", patch: { x: 200 } });
    s = editorReducer(s, { type: "delete", uid: "a" });
    expect(s.items).toEqual([]);
    s = editorReducer(s, { type: "undo" });
    expect(s.items[0].x).toBe(200);
    s = editorReducer(s, { type: "undo" });
    expect(s.items[0].x).toBe(100);
    s = editorReducer(s, { type: "redo" });
    expect(s.items[0].x).toBe(200);
    // A new edit throws the redo stack away.
    s = editorReducer(s, { type: "update", uid: "a", patch: { rot: 90 } });
    expect(s.future).toEqual([]);
  });

  it("adds nothing to the history for an edit that changes nothing", () => {
    const s0 = initialEditorState([item("a")]);
    expect(editorReducer(s0, { type: "update", uid: "a", patch: { x: 100 } })).toBe(s0);
    expect(editorReducer(s0, { type: "update", uid: "nope", patch: { x: 5 } })).toBe(s0);
    expect(editorReducer(s0, { type: "delete", uid: "nope" })).toBe(s0);
    expect(editorReducer(s0, { type: "undo" })).toBe(s0);
    expect(editorReducer(s0, { type: "redo" })).toBe(s0);
  });

  it("won't move, turn or resize a locked item — only relabel or unlock it", () => {
    const s0 = initialEditorState([item("a", { locked: true })]);
    expect(editorReducer(s0, { type: "update", uid: "a", patch: { x: 500, rot: 90 } })).toBe(s0);
    const relabelled = editorReducer(s0, { type: "update", uid: "a", patch: { label: "Mill 1", x: 500 } });
    expect(relabelled.items[0]).toMatchObject({ label: "Mill 1", x: 100 });
    const unlocked = editorReducer(s0, { type: "update", uid: "a", patch: { locked: false } });
    expect(unlocked.items[0].locked).toBe(false);
  });

  it("duplicates beside the original, as a new unpinned thing", () => {
    const s = editorReducer(initialEditorState([item("a", { equipmentId: 214, locked: true })]), {
      type: "duplicate",
      uid: "a",
      newUid: "b",
    });
    expect(s.items[1]).toMatchObject({
      uid: "b",
      x: 100 + DUPLICATE_OFFSET,
      y: 100 + DUPLICATE_OFFSET,
      equipmentId: null,
      locked: false,
    });
  });

  it("keeps at most HISTORY_LIMIT steps", () => {
    let s = initialEditorState([item("a")]);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) s = editorReducer(s, { type: "update", uid: "a", patch: { x: i } });
    expect(s.past).toHaveLength(HISTORY_LIMIT);
  });

  it("takes the saved items without losing the history", () => {
    let s = editorReducer(initialEditorState([]), { type: "add", item: item("a") });
    s = editorReducer(s, { type: "saved", doc: { items: [item("a")], areas: [] } });
    expect(s.past).toHaveLength(1);
  });
});

describe("areas in the editor", () => {
  const area = (uid: string, extra: Partial<PlantLayoutArea> = {}): PlantLayoutArea => ({
    uid,
    kind: "aisle",
    x: 100,
    y: 100,
    w: 200,
    d: 60,
    rot: 0,
    label: "Aisle",
    locked: false,
    ...extra,
  });

  it("adds, moves, re-kinds, duplicates and deletes an area, with undo across items and areas alike", () => {
    let s = initialEditorState({ items: [item("i")], areas: [] });
    s = editorReducer(s, { type: "addArea", area: area("a") });
    s = editorReducer(s, { type: "update", uid: "a", patch: { x: 300, kind: "no-go", equipmentId: 5 } });
    expect(s.areas[0]).toMatchObject({ x: 300, kind: "no-go" });
    expect(s.areas[0]).not.toHaveProperty("equipmentId");
    s = editorReducer(s, { type: "duplicate", uid: "a", newUid: "a2" });
    expect(s.areas[1]).toMatchObject({ uid: "a2", x: 300 + DUPLICATE_OFFSET, kind: "no-go" });
    s = editorReducer(s, { type: "update", uid: "i", patch: { x: 5 } });
    s = editorReducer(s, { type: "delete", uid: "a" });
    expect(s.areas.map((a) => a.uid)).toEqual(["a2"]);
    s = editorReducer(s, { type: "undo" });
    s = editorReducer(s, { type: "undo" });
    expect(s.items[0].x).toBe(100);
    expect(s.areas.map((a) => a.uid)).toEqual(["a", "a2"]);
  });

  it("won't move a locked area, but will relabel it", () => {
    const s0 = initialEditorState({ items: [], areas: [area("a", { locked: true })] });
    expect(editorReducer(s0, { type: "update", uid: "a", patch: { x: 999 } })).toBe(s0);
    expect(editorReducer(s0, { type: "update", uid: "a", patch: { label: "Main aisle" } }).areas[0].label).toBe("Main aisle");
  });

  it("turns two dragged corners into a snapped area, numbered past those of its kind", () => {
    const made = areaFromCorners({ x: 305, y: 101 }, { x: 100, y: 199 }, "aisle", [area("a")], 6, () => 0.5);
    expect(made).toMatchObject({ kind: "aisle", x: 102 + 204 / 2, y: 102 + 96 / 2, w: 204, d: 96, label: "Aisle 2" });
    expect(made!.uid.startsWith("a_")).toBe(true);
    expect(areaFromCorners({ x: 0, y: 0 }, { x: 8, y: 300 }, "no-go", [], 1)).toBeNull();
    expect(areaFromCorners({ x: 0, y: 0 }, { x: 60, y: 60 }, "no-go", [], 1)).toMatchObject({ label: "No-go area" });
  });

  it("keeps an area at least a foot either way", () => {
    expect(clampAreaSize(3, 40.4)).toEqual({ w: 12, d: 40 });
  });

  it("counts a moved area as an unsaved change", () => {
    expect(sameDoc({ items: [], areas: [area("a")] }, { items: [], areas: [area("a")] })).toBe(true);
    expect(sameDoc({ items: [], areas: [area("a")] }, { items: [], areas: [area("a", { x: 1 })] })).toBe(false);
  });
});

describe("helpers", () => {
  it("snaps to the grid, or to the inch with snap off", () => {
    expect(snap(103, 6)).toBe(102);
    expect(snap(104, 6)).toBe(102);
    expect(snap(105, 6)).toBe(108);
    expect(snap(10.4, 0)).toBe(10);
  });

  it("keeps rotation in 0–359", () => {
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(360)).toBe(0);
  });

  it("holds a size inside the component's limits, and fixes one that can't resize", () => {
    expect(clampSize(rack, 96 * 10, 42)).toEqual({ w: 96 * 4, d: 42 });
    expect(clampSize(rack, 10, 42)).toEqual({ w: 96, d: 42 });
    expect(clampSize(mill, 300, 300)).toEqual({ w: 120, d: 96 });
  });

  it("names a placed item after its component, numbered past the ones already there", () => {
    expect(nextItemLabel(mill, [])).toBe("CNC Vertical Mill (generic)");
    expect(nextItemLabel(mill, SAMPLE_CLEAN_ITEMS)).toBe("CNC Vertical Mill (generic) 5");
  });

  it("never hands out a uid already on the layout", () => {
    const rolls = [0.5, 0.5, 0.25];
    const random = () => rolls.shift()!;
    const taken = [item(`i_${Math.floor(0.5 * 0xffffff).toString(16).padStart(6, "0")}`)];
    expect(newItemUid(taken, random)).toBe(`i_${Math.floor(0.25 * 0xffffff).toString(16).padStart(6, "0")}`);
  });

  it("places a component at its own footprint, snapped", () => {
    const placed = placeComponent(mill, { x: 1001, y: 499 }, [], 6, () => 0.1);
    expect(placed).toMatchObject({ componentId: mill.id, x: 1002, y: 498, w: 120, d: 96, rot: 0, locked: false });
  });

  it("turns a screen point into inches on the plan", () => {
    const rect = { left: 100, top: 50, width: 1440, height: 840 };
    expect(clientToPlan({ x: 100 + 720, y: 50 + 420 }, rect, { w: 2880, h: 1680 })).toEqual({ x: 1440, y: 840 });
    expect(clientToPlan({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 0 }, { w: 1, h: 1 })).toEqual({ x: 0, y: 0 });
  });

  it("compares item lists by value", () => {
    expect(sameItems([item("a")], [item("a")])).toBe(true);
    expect(sameItems([item("a")], [item("a", { x: 1 })])).toBe(false);
  });
});
