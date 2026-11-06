import { describe, expect, it } from "vitest";
import mainPlantWalls from "@/data/plantMock/walls-main-plant.svg?raw";
import { MAIN_PLANT_AREAS, MOCK_LAYOUT_COMPONENTS, SAMPLE_CLEAN_ITEMS, SAMPLE_COLLISION_ITEMS } from "@/data/plantMockData";
import type { PlantLayoutItem } from "@/types/plant";
import {
  areaObstacles,
  boxCorners,
  describeLayoutProblem,
  feetLabel,
  findLayoutProblems,
  itemsWithProblems,
  outsideExtent,
  quadBounds,
  quadsOverlap,
  rectQuad,
  type CheckableItem,
  type Obstacle,
} from "./plantGeometry";
import { readWallsSvg } from "./plantSvg";

function box(uid: string, x: number, y: number, w: number, d: number, rot = 0, collides = true): CheckableItem {
  return { uid, label: uid, x, y, w, d, rot, collides };
}

describe("boxCorners", () => {
  it("is the plain rectangle at 0°", () => {
    expect(boxCorners({ x: 10, y: 20, w: 4, d: 2, rot: 0 })).toEqual([
      [8, 19],
      [12, 19],
      [12, 21],
      [8, 21],
    ]);
  });

  it("swaps width and depth at 90°", () => {
    const b = quadBounds(boxCorners({ x: 0, y: 0, w: 10, d: 4, rot: 90 }));
    expect(b.maxX - b.minX).toBeCloseTo(4);
    expect(b.maxY - b.minY).toBeCloseTo(10);
  });

  it("turns clockwise in SVG's y-down space", () => {
    // The top-left corner of a 2×2 box at the origin, turned 90°, ends top-RIGHT.
    const [tl] = boxCorners({ x: 0, y: 0, w: 2, d: 2, rot: 90 });
    expect(tl[0]).toBeCloseTo(1);
    expect(tl[1]).toBeCloseTo(-1);
  });
});

describe("quadsOverlap", () => {
  it("finds a real overlap", () => {
    expect(quadsOverlap(rectQuad(0, 0, 10, 10), rectQuad(5, 5, 10, 10))).toBe(true);
  });

  it("does not count touching edges as an overlap", () => {
    expect(quadsOverlap(rectQuad(0, 0, 10, 10), rectQuad(10, 0, 10, 10))).toBe(false);
  });

  it("separates rotated boxes whose bounding boxes overlap", () => {
    // Two diamonds side by side: their bounds overlap, their shapes don't.
    const a = boxCorners({ x: 0, y: 0, w: 10, d: 10, rot: 45 });
    const b = boxCorners({ x: 14.5, y: 0, w: 10, d: 10, rot: 45 });
    expect(quadsOverlap(a, b)).toBe(false);
  });

  it("finds one box inside another", () => {
    expect(quadsOverlap(rectQuad(0, 0, 100, 100), rectQuad(40, 40, 5, 5))).toBe(true);
  });
});

describe("outsideExtent", () => {
  it("is false for a box inside the building and true when a corner leaves it", () => {
    expect(outsideExtent(rectQuad(0, 0, 100, 50), { w: 100, h: 50 })).toBe(false);
    expect(outsideExtent(boxCorners({ x: 95, y: 25, w: 20, d: 20, rot: 45 }), { w: 100, h: 50 })).toBe(true);
  });
});

describe("findLayoutProblems", () => {
  const wall: Obstacle = { id: "wall-1", kind: "wall", detail: "", quad: rectQuad(50, 0, 5, 100) };

  it("reports an overlap once, against the earlier item", () => {
    const problems = findLayoutProblems([box("a", 10, 10, 10, 10), box("b", 15, 10, 10, 10)], [], { w: 100, h: 100 });
    expect(problems).toEqual([{ kind: "overlap", uid: "a", other: "b" }]);
    expect([...itemsWithProblems(problems)].sort()).toEqual(["a", "b"]);
  });

  it("lets a non-colliding item (a floor zone) sit under others and over obstacles", () => {
    const zone = box("zone", 50, 50, 40, 40, 0, false);
    expect(findLayoutProblems([zone, box("bench", 38, 50, 10, 10)], [wall], { w: 100, h: 100 })).toEqual([]);
  });

  it("still refuses a non-colliding item outside the building", () => {
    const zone = box("zone", 99, 50, 10, 10, 0, false);
    expect(findLayoutProblems([zone], [], { w: 100, h: 100 })).toEqual([{ kind: "outside", uid: "zone" }]);
  });

  it("reports a colliding item through a wall", () => {
    expect(findLayoutProblems([box("a", 52, 50, 10, 10)], [wall], { w: 100, h: 100 })).toEqual([
      { kind: "obstacle", uid: "a", obstacle: wall },
    ]);
  });
});

// The two sample layouts were built with the generator's own checker; ARC must
// agree with it on the same drawing. The drawing's aisles, docks and panel
// clearances now live on the layouts as areas, at the same place and size, so
// they're added back here.
describe("the sample layouts on the made-up Main Plant", () => {
  const walls = readWallsSvg(mainPlantWalls);
  if (!walls.ok) throw new Error(walls.problem);
  const obstacles = [...walls.drawing.obstacles, ...areaObstacles(MAIN_PLANT_AREAS)];
  const byId = new Map(MOCK_LAYOUT_COMPONENTS.map((c) => [c.id, c]));
  const checkable = (items: PlantLayoutItem[]): CheckableItem[] =>
    items.map((it) => ({ ...it, collides: byId.get(it.componentId)?.collides ?? true }));

  it("finds nothing wrong with the clean layout", () => {
    expect(findLayoutProblems(checkable(SAMPLE_CLEAN_ITEMS), obstacles, walls.drawing.extent)).toEqual([]);
  });

  it("finds exactly the three bad items in the other", () => {
    const problems = findLayoutProblems(checkable(SAMPLE_COLLISION_ITEMS), obstacles, walls.drawing.extent);
    const bad = [...itemsWithProblems(problems)].filter((uid) => uid.startsWith("i_bad")).sort();
    expect(bad).toEqual(["i_bad1", "i_bad2", "i_bad3"]);
    // i_bad1 lands between VMC-1 and VMC-2 and overlaps both — the only good items dragged in.
    expect([...itemsWithProblems(problems)].sort()).toEqual(["i_0001", "i_0002", "i_bad1", "i_bad2", "i_bad3"]);
    const labels = new Map(SAMPLE_COLLISION_ITEMS.map((i) => [i.uid, i.label]));
    const sentences = problems.map((p) => describeLayoutProblem(p, (uid) => labels.get(uid) ?? uid));
    expect(sentences).toContain("VMC-1 overlaps Overlaps VMC-1.");
    expect(sentences).toContain("VMC-2 overlaps Overlaps VMC-1.");
    expect(sentences).toContain("Sits in N-S aisle sits in an aisle (N-S aisle north).");
    expect(sentences).toContain("Through east wall goes outside the building.");
    expect(sentences).toContain("Through east wall goes through a wall.");
  });
});

describe("areaObstacles", () => {
  it("makes a drawn area a keep-out that a colliding item may not sit in, named by its label", () => {
    const area = { uid: "a_1", kind: "aisle", x: 50, y: 50, w: 40, d: 10, rot: 0, label: "Main aisle" };
    const [obstacle] = areaObstacles([area]);
    const problems = findLayoutProblems([box("bench", 50, 50, 10, 10)], [obstacle], { w: 100, h: 100 });
    expect(problems).toHaveLength(1);
    expect(describeLayoutProblem(problems[0], (u) => u)).toBe("bench sits in an aisle (Main aisle).");
    expect(findLayoutProblems([box("zone", 50, 50, 10, 10, 0, false)], [obstacle], { w: 100, h: 100 })).toEqual([]);
  });

  it("follows the area's rotation, and leaves an unlabelled no-go area unnamed", () => {
    const area = { uid: "a_2", kind: "no-go", x: 50, y: 50, w: 80, d: 4, rot: 90, label: " " };
    const [obstacle] = areaObstacles([area]);
    // Turned 90°, the long thin area runs north–south: a box at (50, 15) is in it, (15, 50) isn't.
    expect(findLayoutProblems([box("n", 50, 15, 2, 2)], [obstacle], { w: 100, h: 100 })).toHaveLength(1);
    expect(findLayoutProblems([box("w", 15, 50, 2, 2)], [obstacle], { w: 100, h: 100 })).toHaveLength(0);
    const [p] = findLayoutProblems([box("n", 50, 15, 2, 2)], [obstacle], { w: 100, h: 100 });
    expect(describeLayoutProblem(p, (u) => u)).toBe("n sits in a no-go area.");
  });
});

describe("describeLayoutProblem", () => {
  const label = (uid: string) => uid.toUpperCase();
  it("names columns, known keep-outs and unknown keep-outs", () => {
    const quad = rectQuad(0, 0, 1, 1);
    expect(describeLayoutProblem({ kind: "obstacle", uid: "a", obstacle: { id: "c", kind: "column", detail: "", quad } }, label)).toBe(
      "A sits on a column.",
    );
    expect(
      describeLayoutProblem({ kind: "obstacle", uid: "a", obstacle: { id: "k", kind: "keepout", detail: "electrical", quad } }, label),
    ).toBe("A sits in electrical clearance.");
    expect(
      describeLayoutProblem({ kind: "obstacle", uid: "a", obstacle: { id: "k", kind: "keepout", detail: "", quad } }, label),
    ).toBe("A sits in a keep-out area.");
  });
});

describe("feetLabel", () => {
  it("writes inches as feet and inches", () => {
    expect(feetLabel(2880)).toBe("240 ft");
    expect(feetLabel(150)).toBe("12 ft 6 in");
    expect(feetLabel(8)).toBe("8 in");
  });
});
