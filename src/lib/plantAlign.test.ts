import { describe, expect, it } from "vitest";
import { alignToNeighbours } from "./plantAlign";

const box = (x: number, y: number, w = 60, d = 30, rot = 0) => ({ x, y, w, d, rot });

describe("alignToNeighbours", () => {
  it("snaps a desk's centre onto its neighbour's, across and down, and draws a guide for each", () => {
    // Neighbour centred at (100, 100); the dragged desk is 3 in off on both.
    const a = alignToNeighbours(box(203, 103), [box(100, 100)], 8, 6);
    expect(a.y).toBe(100); // lined up across: same row
    expect(a.x).toBe(204); // nothing to line up with down: the 6 in grid
    expect(a.guides).toContainEqual({ axis: "y", at: 100, from: 70, to: 234 });
    // Top and bottom edges line up too (same depth), so those show as well.
    expect(a.guides.filter((g) => g.axis === "y").map((g) => g.at).sort((p, q) => p - q)).toEqual([85, 100, 115]);
    expect(a.guides.some((g) => g.axis === "x")).toBe(false);
  });

  it("lines up EDGES as well as centres — a wide machine's left edge on a desk's", () => {
    // Desk spans x 70…130. A 120-wide machine whose left edge is at 72 should move to 70.
    const a = alignToNeighbours(box(132, 400, 120, 96), [box(100, 100)], 8, 0);
    expect(a.x).toBe(130);
    expect(a.guides).toContainEqual({ axis: "x", at: 70, from: 85, to: 448 });
  });

  it("picks the CLOSEST line when several are in reach", () => {
    // Neighbours' centres at 100 and 105 across; the drag sits at 104 → 105.
    const a = alignToNeighbours(box(500, 104, 10, 10), [box(100, 100, 10, 10), box(200, 105, 10, 10)], 8, 0);
    expect(a.y).toBe(105);
  });

  it("leaves the grid in charge when nothing is within reach", () => {
    const a = alignToNeighbours(box(523, 517), [box(100, 100)], 8, 12);
    expect(a).toEqual({ x: 528, y: 516, guides: [] });
  });

  it("compares a turned item by the box it takes up on the plan", () => {
    // 60 × 30 turned 90° takes up 30 wide × 60 deep: x 85…115, y 70…130.
    const a = alignToNeighbours(box(300, 72, 20, 20), [box(100, 100, 60, 30, 90)], 8, 0);
    // Its centre (72) onto the turned desk's top edge (70): 2 in, closer than its own top edge's 8.
    expect(a.y).toBe(70);
  });

  it("a zero tolerance only grid-snaps", () => {
    expect(alignToNeighbours(box(101, 99), [box(100, 100)], 0, 0)).toMatchObject({ x: 101, y: 99 });
  });
});
