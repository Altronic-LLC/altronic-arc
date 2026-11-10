import { describe, expect, it } from "vitest";
import mainPlantWalls from "@/data/plantMock/walls-main-plant.svg?raw";
import { MAIN_PLANT_AREAS, MOCK_LAYOUT_COMPONENTS, SAMPLE_CLEAN_ITEMS, SAMPLE_COLLISION_ITEMS } from "@/data/plantMockData";
import type { PlantLayoutItem } from "@/types/plant";
import {
  areaObstacles,
  boxCorners,
  checkLayout,
  convexPieces,
  itemPieces,
  labelAngle,
  parseCollisionPolygon,
  shapeOfComponent,
  type CollisionOutline,
  type Point,
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
    items.map((it) => ({ ...it, ...shapeOfComponent(byId.get(it.componentId)) }));

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

// -----------------------------------------------------------------------------
// Collision outlines — symbols that aren't rectangles
// -----------------------------------------------------------------------------

/** A 72 x 72 L: the top arm 30 deep, the left arm 30 wide, the notch bottom right. */
const L_POINTS: Point[] = [
  [0, 0],
  [72, 0],
  [72, 30],
  [30, 30],
  [30, 72],
  [0, 72],
];
const L_OUTLINE: CollisionOutline = { points: L_POINTS, w: 72, d: 72 };

function shaped(uid: string, x: number, y: number, rot = 0, size = 72, outline: CollisionOutline | null = L_OUTLINE): CheckableItem {
  return { uid, label: uid, x, y, w: size, d: size, rot, collides: true, outline };
}

const area = (pieces: readonly (readonly Point[])[]) =>
  pieces.reduce((sum, piece) => {
    let a = 0;
    piece.forEach(([x1, y1], i) => {
      const [x2, y2] = piece[(i + 1) % piece.length];
      a += x1 * y2 - x2 * y1;
    });
    return sum + Math.abs(a / 2);
  }, 0);

describe("parseCollisionPolygon", () => {
  it("reads JSON text or an array of [x, y] pairs", () => {
    expect(parseCollisionPolygon("[[0,0],[10,0],[10,5]]")).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
    ]);
    expect(parseCollisionPolygon(L_POINTS)).toEqual(L_POINTS);
  });

  it("reads anything unusable as no outline", () => {
    for (const bad of [null, undefined, "", "  ", "[[0,0],[1", "{}", "[[0,0],[1,1]]", "[[0,0],[1,'x'],[2,2]]", '[[0,0],[1,null],[2,2]]', "[1,2,3]", 42]) {
      expect(parseCollisionPolygon(bad)).toBeNull();
    }
  });
});

describe("convexPieces", () => {
  it("keeps a convex outline whole", () => {
    expect(convexPieces([[0, 0], [10, 0], [10, 5], [0, 5]])).toHaveLength(1);
  });

  it("cuts a concave outline into triangles that cover exactly its area, whichever way it winds", () => {
    const lArea = 72 * 72 - 42 * 42;
    for (const pts of [L_POINTS, [...L_POINTS].reverse()]) {
      const pieces = convexPieces(pts);
      expect(pieces).not.toBeNull();
      expect(area(pieces!)).toBeCloseTo(lArea, 6);
    }
  });

  it("ignores repeated points, a closing point and points on a straight run", () => {
    const messy: Point[] = [[0, 0], [36, 0], [72, 0], [72, 0], [72, 30], [30, 30], [30, 72], [0, 72], [0, 0]];
    expect(area(convexPieces(messy)!)).toBeCloseTo(72 * 72 - 42 * 42, 6);
  });

  it("can't cut a self-crossing outline", () => {
    expect(convexPieces([[0, 0], [10, 10], [10, 0], [0, 10]])).toBeNull();
    expect(convexPieces([[0, 0], [5, 0], [10, 0]])).toBeNull();
  });
});

describe("findLayoutProblems with collision outlines", () => {
  const EXTENT = { w: 1000, h: 1000 };
  // The L centred at (100, 100) covers 64..136; its notch is x 94..136, y 94..136.
  const IN_NOTCH = box("cart", 115, 115, 20, 20);

  it("lets an item sit in the notch of an L, which its rectangle would refuse", () => {
    expect(findLayoutProblems([shaped("desk", 100, 100), IN_NOTCH], [], EXTENT)).toEqual([]);
    expect(findLayoutProblems([shaped("desk", 100, 100, 0, 72, null), IN_NOTCH], [], EXTENT)).toHaveLength(1);
  });

  it("still flags an item on the L's arm", () => {
    expect(findLayoutProblems([shaped("desk", 100, 100), box("cart", 115, 75, 20, 20)], [], EXTENT)).toEqual([
      { kind: "overlap", uid: "desk", other: "cart" },
    ]);
  });

  it("treats touching the inside corner as touching, not overlapping", () => {
    // Its top-left corner sits exactly on the L's inside corner (94, 94).
    expect(findLayoutProblems([shaped("desk", 100, 100), box("cart", 104, 104, 20, 20)], [], EXTENT)).toEqual([]);
  });

  it("turns the outline with the item", () => {
    // Turned 90 degrees clockwise, the notch moves to the bottom LEFT.
    const turned = shaped("desk", 100, 100, 90);
    expect(findLayoutProblems([turned, box("cart", 85, 115, 20, 20)], [], EXTENT)).toEqual([]);
    expect(findLayoutProblems([turned, IN_NOTCH], [], EXTENT)).toHaveLength(1);
  });

  it("stretches the outline to the item's size", () => {
    // At 144 x 144 around (200, 200) the notch is x 188..272, y 188..272.
    const big = shaped("desk", 200, 200, 0, 144);
    expect(findLayoutProblems([big, box("cart", 220, 220, 30, 30)], [], EXTENT)).toEqual([]);
    expect(findLayoutProblems([big, box("cart", 150, 150, 10, 10)], [], EXTENT)).toHaveLength(1);
  });

  it("flags two identical shaped items stacked on top of each other", () => {
    expect(findLayoutProblems([shaped("a", 100, 100), shaped("b", 100, 100)], [], EXTENT)).toHaveLength(1);
  });

  it("lets two Ls turned towards each other share space their boxes would fight over", () => {
    expect(findLayoutProblems([shaped("a", 100, 100), shaped("b", 142, 142, 180)], [], EXTENT)).toEqual([]);
    expect(
      findLayoutProblems([shaped("a", 100, 100, 0, 72, null), shaped("b", 142, 142, 180, 72, null)], [], EXTENT),
    ).toHaveLength(1);
  });

  it("checks walls and keep-outs against the outline too", () => {
    const keepout: Obstacle = { id: "k", kind: "keepout", detail: "aisle", quad: rectQuad(110, 110, 20, 20) };
    expect(findLayoutProblems([shaped("desk", 100, 100)], [keepout], EXTENT)).toEqual([]);
    expect(findLayoutProblems([shaped("desk", 100, 100, 0, 72, null)], [keepout], EXTENT)).toHaveLength(1);
  });

  it("falls back to the rectangle when the outline can't be used", () => {
    const crossing: CollisionOutline = { points: [[0, 0], [72, 72], [72, 0], [0, 72]], w: 72, d: 72 };
    expect(itemPieces(shaped("desk", 100, 100, 0, 72, crossing))).toEqual([boxCorners({ x: 100, y: 100, w: 72, d: 72, rot: 0 })]);
    expect(findLayoutProblems([shaped("desk", 100, 100, 0, 72, crossing), IN_NOTCH], [], EXTENT)).toHaveLength(1);
  });

  it("flags a shaped item that goes outside the building", () => {
    const desk = shaped("desk", 64, 64);
    expect(findLayoutProblems([desk], [], { w: 100, h: 100 })).toEqual([]);
    expect(findLayoutProblems([desk], [], { w: 99, h: 99 })).toEqual([{ kind: "outside", uid: "desk" }]);
  });
});

describe("shapeOfComponent and checkLayout", () => {
  it("passes a component's outline into the check, and treats an unknown component as a solid rectangle", () => {
    expect(shapeOfComponent(undefined)).toEqual({ collides: true, outline: null });
    expect(shapeOfComponent({ collides: false, collisionPolygon: L_POINTS, footprintW: 72, footprintD: 72 })).toEqual({
      collides: false,
      outline: L_OUTLINE,
    });
    expect(shapeOfComponent({ collides: true, collisionPolygon: L_POINTS, footprintW: 0, footprintD: 72 }).outline).toBeNull();
    const doc = {
      extent: { w: 1000, h: 1000 },
      items: [
        { uid: "desk", label: "Desk", componentId: 1, x: 100, y: 100, w: 72, d: 72, rot: 0 },
        { uid: "cart", label: "Cart", componentId: 2, x: 115, y: 115, w: 20, d: 20, rot: 0 },
      ],
    };
    const lDesk = { collides: true, collisionPolygon: L_POINTS, footprintW: 72, footprintD: 72 };
    const cart = { collides: true, collisionPolygon: null, footprintW: 20, footprintD: 20 };
    const byId = new Map<number, Parameters<typeof shapeOfComponent>[0]>([
      [1, lDesk],
      [2, cart],
    ]);
    expect(checkLayout(doc, (cid) => shapeOfComponent(byId.get(cid)), null)).toEqual([]);
    expect(checkLayout(doc, () => ({ collides: true, outline: null }), null)).toHaveLength(1);
  });

  it("the demo's L-desk carries its real shape", () => {
    const desk = MOCK_LAYOUT_COMPONENTS.find((c) => c.key === "desk-l-72x72");
    expect(desk?.collisionPolygon).toEqual(L_POINTS);
  });
});

describe("labelAngle", () => {
  it("runs along a wide item and turns with it", () => {
    expect(labelAngle({ w: 96, d: 24, rot: 0 })).toBe(0);
    expect(labelAngle({ w: 96, d: 24, rot: 30 })).toBe(30);
    expect(labelAngle({ w: 96, d: 24, rot: 359.2 })).toBeCloseTo(-0.8, 6);
  });

  it("is never upside down, and vertical text reads bottom to top", () => {
    expect(labelAngle({ w: 96, d: 24, rot: 180 })).toBe(0);
    expect(labelAngle({ w: 96, d: 24, rot: 200 })).toBe(20);
    expect(labelAngle({ w: 96, d: 24, rot: 270 })).toBe(-90);
    expect(labelAngle({ w: 96, d: 24, rot: 90 })).toBe(-90);
    expect(labelAngle({ w: 96, d: 24, rot: -45 })).toBe(-45);
  });

  it("runs along the depth when an item is taller than it is wide", () => {
    expect(labelAngle({ w: 24, d: 96, rot: 0 })).toBe(-90);
    expect(labelAngle({ w: 24, d: 96, rot: 90 })).toBe(0);
  });
});
