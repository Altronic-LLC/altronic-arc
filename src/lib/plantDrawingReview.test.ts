import { describe, expect, it } from "vitest";
import mainPlantWalls from "@/data/plantMock/walls-main-plant.svg?raw";
import { keepoutsToAreas, reviewWallsDrawing } from "./plantDrawingReview";
import { readWallsSvg, type WallsDrawing } from "./plantSvg";

function drawing(svg: string): WallsDrawing {
  const read = readWallsSvg(svg);
  if (!read.ok) throw new Error(read.problem);
  return read.drawing;
}

const SHOP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600">
  <g id="walls"><rect x="0" y="0" width="1200" height="8"/><rect x="0" y="592" width="1200" height="8"/></g>
  <g id="columns"><rect x="300" y="300" width="12" height="12"/></g>
  <g id="keepout">
    <rect id="a" data-kind="egress" x="0" y="100" width="400" height="60"/>
    <rect id="b" data-kind="dock" x="1000" y="100" width="144" height="144"/>
    <rect id="c" data-kind="dock" x="1000" y="300" width="144" height="144"/>
    <rect id="d" data-kind="door-swing" x="500" y="8" width="36" height="36"/>
    <rect id="e" x="20" y="400" width="50" height="50"/>
  </g>
</svg>`;

describe("reviewWallsDrawing", () => {
  it("counts what it found and offers each keep-out as an area — door swings unticked", () => {
    const r = reviewWallsDrawing(drawing(SHOP));
    expect(r).toMatchObject({ sizeLabel: "100 ft × 50 ft", walls: 2, columns: 1, warnings: [] });
    expect(r.keepouts.map((k) => [k.id, k.kind, k.label, k.convert])).toEqual([
      ["a", "aisle", "Exit route", true],
      ["b", "no-go", "Dock 1", true],
      ["c", "no-go", "Dock 2", true],
      ["d", "no-go", "Door swing", false],
      ["e", "no-go", "Keep-out", true],
    ]);
    // An area is stored by its centre.
    expect(r.keepouts[0]).toMatchObject({ x: 200, y: 130, w: 400, d: 60 });
  });

  it("warns about a size that suggests the wrong units, no walls, and shapes it can't check", () => {
    const tiny = reviewWallsDrawing(drawing('<svg viewBox="0 0 100 60"><g id="walls"><path d="M0 0"/></g></svg>'));
    expect(tiny.warnings).toHaveLength(3);
    expect(tiny.warnings[0]).toMatch(/very small building \(8 ft 4 in × 5 ft\).*inches/);
    expect(tiny.warnings[1]).toMatch(/found no walls/);
    expect(tiny.warnings[2]).toMatch(/^1 shape .*isn't a plain rectangle/);
    const huge = reviewWallsDrawing(drawing('<svg viewBox="0 0 30000 900"><g id="walls"><rect width="10" height="10"/></g></svg>'));
    expect(huge.warnings).toEqual([expect.stringMatching(/very large building.*millimetres/)]);
  });

  it("finds nothing to warn about in the demo Main Plant, whose keep-outs are its door swings", () => {
    const r = reviewWallsDrawing(drawing(mainPlantWalls));
    expect(r.warnings).toEqual([]);
    expect(r.keepouts.every((k) => k.detail === "door-swing" && !k.convert)).toBe(true);
  });
});

describe("keepoutsToAreas", () => {
  it("turns only the ticked ones into areas, trimmed, with their own ids", () => {
    const r = reviewWallsDrawing(drawing(SHOP));
    const choices = r.keepouts.map((k) => (k.id === "b" ? { ...k, label: "  Main dock ", kind: "aisle" as const } : k));
    const areas = keepoutsToAreas(choices);
    expect(areas.map((a) => [a.uid, a.kind, a.label])).toEqual([
      ["a_d001", "aisle", "Exit route"],
      ["a_d002", "aisle", "Main dock"],
      ["a_d003", "no-go", "Dock 2"],
      ["a_d004", "no-go", "Keep-out"],
    ]);
    expect(areas[0]).toMatchObject({ x: 200, y: 130, w: 400, d: 60, rot: 0, locked: false });
  });
});
