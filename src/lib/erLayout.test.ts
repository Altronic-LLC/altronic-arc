import { describe, expect, it } from "vitest";
import {
  MAX_CANVAS_WIDTH,
  layoutEr,
  routeConnection,
  type ErTable,
  type PlacedTable,
} from "./erLayout";
import { CONNECTIONS, ER_GROUPS, SCHEMA_TABLES } from "@/views/AboutView";

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function table(name: string, group: string, columns = 3, width = 200): ErTable {
  return {
    name,
    source: "test",
    palette: "entity",
    group,
    width,
    columns: Array.from({ length: columns }, (_, i) => ({
      name: i === 0 ? "id" : `c${i}`,
      type: "int",
      kind: i === 0 ? ("pk" as const) : ("field" as const),
    })),
  };
}

describe("layoutEr — the real About-page data", () => {
  const layout = layoutEr(SCHEMA_TABLES, ER_GROUPS);

  it("places every table exactly once", () => {
    expect(layout.tables.map((t) => t.name).sort()).toEqual(SCHEMA_TABLES.map((t) => t.name).sort());
  });

  it("gives every table a group that exists", () => {
    const ids = new Set(ER_GROUPS.map((g) => g.id));
    for (const t of SCHEMA_TABLES) expect(ids, `${t.name} → ${t.group}`).toContain(t.group);
  });

  it("never overlaps two cards", () => {
    const { tables } = layout;
    for (let i = 0; i < tables.length; i++) {
      for (let j = i + 1; j < tables.length; j++) {
        expect(overlaps(tables[i], tables[j]), `${tables[i].name} overlaps ${tables[j].name}`).toBe(false);
      }
    }
  });

  it("never overlaps two group frames, and keeps each card inside its own frame", () => {
    const { groups, tables } = layout;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        expect(overlaps(groups[i], groups[j]), `${groups[i].id} / ${groups[j].id}`).toBe(false);
      }
    }
    for (const t of tables) {
      const g = groups.find((x) => x.id === t.group)!;
      expect(t.x >= g.x && t.y >= g.y && t.x + t.width <= g.x + g.width && t.y + t.height <= g.y + g.height).toBe(true);
    }
  });

  it("stays within the canvas width", () => {
    expect(layout.width).toBeLessThanOrEqual(MAX_CANVAS_WIDTH);
  });

  // A connection naming a column that doesn't exist silently draws from the
  // table's first row, pointing at the wrong field.
  it("only connects tables and columns that exist", () => {
    const byName = new Map(SCHEMA_TABLES.map((t) => [t.name, t]));
    for (const c of CONNECTIONS) {
      const from = byName.get(c.fromTable);
      const to = byName.get(c.toTable);
      expect(from, `unknown table ${c.fromTable}`).toBeDefined();
      expect(to, `unknown table ${c.toTable}`).toBeDefined();
      expect(from!.columns.map((x) => x.name), `${c.fromTable}.${c.fromColumn}`).toContain(c.fromColumn);
      expect(to!.columns.map((x) => x.name), `${c.toTable}.${c.toColumn}`).toContain(c.toColumn);
    }
  });
});

describe("layoutEr — packing", () => {
  it("draws groups in the order declared, skipping empty ones", () => {
    const layout = layoutEr(
      [table("B1", "b"), table("A1", "a")],
      [
        { id: "a", label: "A" },
        { id: "empty", label: "Empty" },
        { id: "b", label: "B" },
      ],
    );
    expect(layout.groups.map((g) => g.id)).toEqual(["a", "b"]);
    expect(layout.groups[0].x).toBeLessThan(layout.groups[1].x);
  });

  it("wraps to a new row rather than running past the canvas width", () => {
    const wide = Array.from({ length: 6 }, (_, i) => table(`W${i}`, `g${i}`, 30, 600));
    const layout = layoutEr(wide, wide.map((t) => ({ id: t.group, label: t.group })));
    expect(new Set(layout.groups.map((g) => g.y)).size).toBeGreaterThan(1);
    for (const g of layout.groups) expect(g.x + g.width).toBeLessThanOrEqual(MAX_CANVAS_WIDTH);
  });
});

describe("routeConnection", () => {
  const at = (name: string, x: number, y: number, width = 200, height = 120): PlacedTable => ({
    ...table(name, "g"),
    x,
    y,
    width,
    height,
  });

  /** Does an "M x y H … V … H …" path pass through a card? */
  function crosses(d: string, r: PlacedTable): boolean {
    const [sx, sy, bx, ty, tx] = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const inY = (y: number) => y > r.y && y < r.y + r.height;
    const inX = (x: number) => x > r.x && x < r.x + r.width;
    const spans = (a: number, b: number, lo: number, hi: number) => Math.min(a, b) < hi && Math.max(a, b) > lo;
    return (
      (inY(sy) && spans(sx, bx, r.x, r.x + r.width)) ||
      (inX(bx) && spans(sy, ty, r.y, r.y + r.height)) ||
      (inY(ty) && spans(bx, tx, r.x, r.x + r.width))
    );
  }

  it("leaves the facing edges of two side-by-side cards", () => {
    const a = at("A", 0, 0);
    const b = at("B", 400, 0);
    expect(routeConnection(a, 50, b, 50, 0, [a, b])).toMatch(/^M 200 50 H \d+(\.\d+)? V 50 H 400$/);
  });

  it("goes round the outside of two cards stacked in one column", () => {
    const a = at("A", 0, 0);
    const b = at("B", 0, 300);
    const d = routeConnection(a, 50, b, 350, 0, [a, b]);
    expect(crosses(d, a)).toBe(false);
    expect(crosses(d, b)).toBe(false);
  });

  // The bug this replaced: a bend at the plain midpoint (x=400 here) ran
  // straight through whatever card happened to sit there. The gutter at
  // x≈250 is clear, so a clear route exists and must be found.
  it("bends in a gutter rather than through a card in between", () => {
    const a = at("A", 0, 0);
    const blocker = at("Blocker", 300, 0, 200, 400);
    const b = at("B", 600, 500);
    const d = routeConnection(a, 50, b, 550, 0, [a, blocker, b]);
    expect(crosses(d, blocker)).toBe(false);
  });
});
