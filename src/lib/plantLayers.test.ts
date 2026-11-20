import { describe, expect, it } from "vitest";
import {
  defaultHiddenLayers,
  itemVisible,
  layerCounts,
  layerLabel,
  layoutLayers,
  placementLayerFor,
  revealItem,
  setGroupShown,
  setLayerShown,
} from "./plantLayers";
import type { PlantLayer, PlantLayoutItem } from "@/types/plant";

function item(uid: string, extra: Partial<PlantLayoutItem> = {}): PlantLayoutItem {
  return { uid, componentId: 1, componentVersion: 1, x: 0, y: 0, w: 10, d: 10, rot: 0, label: uid, equipmentId: null, locked: false, ...extra };
}

const SAFETY: PlantLayer = {
  key: "safety",
  title: "Safety",
  hiddenByDefault: true,
  groups: [
    { key: "extinguishers", title: "Extinguishers" },
    { key: "fire-exits", title: "Fire exits" },
  ],
};

describe("layoutLayers", () => {
  it("lists the declared layers, then any an item names that isn't declared", () => {
    const layers = layoutLayers({
      layers: [SAFETY],
      items: [
        item("a"),
        item("b", { layer: "safety", group: "medical" }),
        item("c", { layer: "air-lines" }),
      ],
    });
    expect(layers.map((l) => l.key)).toEqual(["safety", "air-lines"]);
    // An undeclared group joins its layer, titled from its key.
    expect(layers[0].groups.map((g) => g.title)).toEqual(["Extinguishers", "Fire exits", "Medical"]);
    // An undeclared layer starts SHOWN — an item must never be unreachable.
    expect(layers[1]).toEqual({ key: "air-lines", title: "Air lines", hiddenByDefault: false, groups: [] });
  });

  it("doesn't change the layers it was given", () => {
    const declared = [SAFETY];
    layoutLayers({ layers: declared, items: [item("b", { layer: "safety", group: "medical" })] });
    expect(SAFETY.groups).toHaveLength(2);
  });

  it("is empty for a layout with only the base plan", () => {
    expect(layoutLayers({ items: [item("a")] })).toEqual([]);
  });
});

describe("visibility", () => {
  const ext = item("e", { layer: "safety", group: "extinguishers" });
  const exit = item("x", { layer: "safety", group: "fire-exits" });
  const base = item("b");

  it("starts with the layers that say so hidden", () => {
    const hidden = defaultHiddenLayers([SAFETY, { ...SAFETY, key: "air", hiddenByDefault: false }]);
    expect([...hidden]).toEqual(["safety"]);
    expect(itemVisible(ext, hidden)).toBe(false);
    expect(itemVisible(base, hidden)).toBe(true);
  });

  it("hides a group on its own, and showing a group shows its layer", () => {
    let hidden = setLayerShown(new Set(), "safety", true);
    hidden = setGroupShown(hidden, "safety", "extinguishers", false);
    expect(itemVisible(ext, hidden)).toBe(false);
    expect(itemVisible(exit, hidden)).toBe(true);

    hidden = setLayerShown(hidden, "safety", false);
    hidden = setGroupShown(hidden, "safety", "fire-exits", true);
    expect(itemVisible(exit, hidden)).toBe(true);
    // The extinguishers group keeps its own setting.
    expect(itemVisible(ext, hidden)).toBe(false);
  });

  it("reveals exactly what hides an item", () => {
    const hidden = new Set(["safety", "safety/extinguishers", "other"]);
    const next = revealItem(hidden, ext);
    expect(itemVisible(ext, next)).toBe(true);
    expect(next.has("other")).toBe(true);
    // Unchanged for an item already shown.
    expect(revealItem(new Set(["other"]), base)).toEqual(new Set(["other"]));
  });

  it("never hides the base plan, whatever is hidden", () => {
    expect(itemVisible(base, new Set(["safety", ""]))).toBe(true);
  });
});

describe("layerCounts / layerLabel", () => {
  it("counts each layer and each group", () => {
    const counts = layerCounts([
      item("a"),
      item("b", { layer: "safety", group: "extinguishers" }),
      item("c", { layer: "safety", group: "extinguishers" }),
      item("d", { layer: "safety" }),
    ]);
    expect(counts.get("safety")).toBe(3);
    expect(counts.get("safety/extinguishers")).toBe(2);
  });

  it("names the layer and group by their titles", () => {
    expect(layerLabel(item("a", { layer: "safety", group: "fire-exits" }), [SAFETY])).toBe("Safety · Fire exits");
    expect(layerLabel(item("a", { layer: "safety" }), [SAFETY])).toBe("Safety");
    expect(layerLabel(item("a", { layer: "air-lines" }), [])).toBe("Air lines");
    expect(layerLabel(item("a"), [SAFETY])).toBe("");
  });
});

describe("placementLayerFor", () => {
  it("puts a new copy where every other copy is", () => {
    const items = [item("a", { componentId: 7, layer: "safety", group: "extinguishers" }), item("b", { componentId: 7, layer: "safety", group: "extinguishers" })];
    expect(placementLayerFor(7, items)).toEqual({ layer: "safety", group: "extinguishers" });
  });

  it("never guesses between two, and leaves a new symbol on the base plan", () => {
    const split = [item("a", { componentId: 7, layer: "safety", group: "extinguishers" }), item("b", { componentId: 7, layer: "safety", group: "medical" })];
    expect(placementLayerFor(7, split)).toBeNull();
    expect(placementLayerFor(7, [item("a", { componentId: 7, layer: "safety" }), item("b", { componentId: 7 })])).toBeNull();
    expect(placementLayerFor(9, split)).toBeNull();
  });
});
