import { describe, expect, it } from "vitest";
import { layerTitleProblem, newGroup, newLayer, slugForLayer, uniqueLayerKey } from "./plantLayers";
import type { PlantLayer } from "@/types/plant";

const SAFETY: PlantLayer = { key: "safety", title: "Safety", hiddenByDefault: true, groups: [{ key: "exits", title: "Exits" }] };

describe("making layers", () => {
  it("makes a key from the title", () => {
    expect(slugForLayer("Fire exits")).toBe("fire-exits");
    expect(slugForLayer("  Air / Gas lines! ")).toBe("air-gas-lines");
    expect(slugForLayer("!!!")).toBe("");
  });

  it("never reuses a key, whatever the case", () => {
    expect(uniqueLayerKey("Safety", ["SAFETY"])).toBe("safety-2");
    expect(uniqueLayerKey("Safety", ["safety", "safety-2"])).toBe("safety-3");
    expect(uniqueLayerKey("!!!", [])).toBe("layer");
  });

  it("refuses a blank, an over-long or a repeated name — but a layer may keep its own", () => {
    expect(layerTitleProblem("  ", [SAFETY])).toMatch(/name/);
    expect(layerTitleProblem("x".repeat(61), [SAFETY])).toMatch(/60/);
    expect(layerTitleProblem("safety", [SAFETY])).toBe("There's already one called Safety.");
    expect(layerTitleProblem("SAFETY", [SAFETY], "safety")).toBeNull();
    expect(layerTitleProblem("Utilities", [SAFETY])).toBeNull();
  });

  it("starts a layer shown and empty, and a group with its own key", () => {
    expect(newLayer(" Utilities ", [SAFETY])).toEqual({ key: "utilities", title: "Utilities", hiddenByDefault: false, groups: [] });
    expect(newGroup("Exits", SAFETY)).toEqual({ key: "exits-2", title: "Exits" });
  });
});
