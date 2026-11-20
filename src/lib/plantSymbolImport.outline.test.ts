import { describe, expect, it } from "vitest";
import { outlineProblem, snapOutlinePoint } from "./plantSymbolImport";
import { parsePointsText } from "@/components/PlantOutlineEditor";

describe("drawing a collision outline", () => {
  it("snaps a click to the inch and keeps it inside the footprint", () => {
    expect(snapOutlinePoint(10.4, 29.6, 72, 72)).toEqual([10, 30]);
    expect(snapOutlinePoint(-3, 80, 72, 72)).toEqual([0, 72]);
    expect(snapOutlinePoint(10.456, 3.333, 72, 72, 0.01)).toEqual([10.46, 3.33]);
  });

  it("accepts an L, and says what's wrong with anything it can't use", () => {
    expect(outlineProblem([[0, 0], [72, 0], [72, 30], [30, 30], [30, 72], [0, 72]])).toBeNull();
    expect(outlineProblem([[0, 0], [72, 0]])).toMatch(/three corners/);
    // The same corner clicked twice counts once.
    expect(outlineProblem([[0, 0], [72, 0], [72, 0]])).toMatch(/three corners/);
    // A bow-tie: the edges cross.
    expect(outlineProblem([[0, 0], [72, 72], [72, 0], [0, 72]])).toMatch(/crosses itself/);
    // Three corners in a line have no inside.
    expect(outlineProblem([[0, 0], [36, 0], [72, 0]])).toMatch(/no area/);
  });

  it("reads typed corners, and refuses an odd number or a word", () => {
    expect(parsePointsText("0,0 72,0; 72 30")).toEqual([[0, 0], [72, 0], [72, 30]]);
    expect(parsePointsText("0,0 72")).toBeNull();
    expect(parsePointsText("0,0 a,b")).toBeNull();
    expect(parsePointsText("")).toEqual([]);
  });
});
