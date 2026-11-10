import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Layout Components' CollisionPolygon in REAL mode. The column was added after
// the list, by a script run separately from any deploy, and selecting a column
// a list hasn't got 400s the WHOLE read — so a 400 retries without it and is
// remembered, and anything else is still reported.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {
    constructor(public status: number) {
      super(`Graph ${status}`);
    }
  },
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, SP_LAYOUT_COMPONENTS_LIST_ID: "components-list" };
});

import { GraphError } from "./graph";
import { __resetCollisionPolygonFallback, createLayoutComponent, listLayoutComponents } from "./layoutComponents";

const L_SHAPE = [
  [0, 0],
  [72, 0],
  [72, 30],
  [30, 30],
  [30, 72],
  [0, 72],
];

function row(id: string, fields: Record<string, unknown>) {
  return { id, fields };
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  __resetCollisionPolygonFallback();
});

describe("listLayoutComponents and CollisionPolygon", () => {
  it("selects the column and reads the outline as points", async () => {
    graphFetchAll.mockResolvedValue([
      row("4", { Title: "L-Desk", ComponentKey: "desk-l", FootprintW: 72, FootprintD: 72, CollisionPolygon: JSON.stringify(L_SHAPE) }),
      row("5", { Title: "Desk", ComponentKey: "desk", FootprintW: 60, FootprintD: 30 }),
    ]);
    const [shaped, plain] = await listLayoutComponents();
    expect(graphFetchAll.mock.calls[0][0]).toMatch(/\$select=[^)]*,CollisionPolygon\)/);
    expect(shaped.collisionPolygon).toEqual(L_SHAPE);
    expect(plain.collisionPolygon).toBeNull();
  });

  it("reads an outline it can't parse as no outline, so the symbol is checked as its rectangle", async () => {
    graphFetchAll.mockResolvedValue([row("4", { Title: "x", ComponentKey: "x", FootprintW: 10, FootprintD: 10, CollisionPolygon: "[[0,0],[1" })]);
    const [c] = await listLayoutComponents();
    expect(c.collisionPolygon).toBeNull();
  });

  it("retries without the column on a 400, and doesn't ask for it again", async () => {
    graphFetchAll
      .mockRejectedValueOnce(new GraphError(400, "Bad Request", "invalidRequest", "u"))
      .mockResolvedValue([row("5", { Title: "Desk", ComponentKey: "desk", FootprintW: 60, FootprintD: 30 })]);
    const [c] = await listLayoutComponents();
    expect(c.key).toBe("desk");
    expect(graphFetchAll.mock.calls[1][0]).not.toMatch(/CollisionPolygon/);
    await listLayoutComponents();
    expect(graphFetchAll).toHaveBeenCalledTimes(3);
    expect(graphFetchAll.mock.calls[2][0]).not.toMatch(/CollisionPolygon/);
  });

  it("reports the original fault when the read without the column fails too", async () => {
    graphFetchAll.mockRejectedValueOnce(new GraphError(400, "Bad Request", "invalidRequest", "u")).mockRejectedValueOnce(new Error("throttled"));
    await expect(listLayoutComponents()).rejects.toThrow("Graph 400");
    // Not remembered as missing: the next read asks for it again.
    graphFetchAll.mockResolvedValue([]);
    await listLayoutComponents();
    expect(graphFetchAll.mock.calls[2][0]).toMatch(/CollisionPolygon/);
  });

  it("doesn't retry anything but a 400", async () => {
    graphFetchAll.mockRejectedValueOnce(new GraphError(403, "Forbidden", "accessDenied", "u"));
    await expect(listLayoutComponents()).rejects.toThrow("Graph 403");
    expect(graphFetchAll).toHaveBeenCalledTimes(1);
  });
});

describe("createLayoutComponent and CollisionPolygon", () => {
  const input = {
    title: "Bench",
    key: "bench-60x30",
    category: "Bench" as const,
    svgMarkup: "<svg/>",
    footprintW: 60,
    footprintD: 30,
    allowResize: false,
    allowRotate: true,
    minScale: 1,
    maxScale: 1,
    collides: true,
    clearance: 0,
  };

  beforeEach(() => {
    graphFetchAll.mockResolvedValue([]);
    graphFetch.mockImplementation(async (_p: string, init?: RequestInit) => row("9", JSON.parse(String(init?.body)).fields));
  });

  it("leaves the column out of a plain symbol, so a list without it can still take one", async () => {
    await createLayoutComponent(input);
    expect(JSON.parse(String(graphFetch.mock.calls[0][1].body)).fields).not.toHaveProperty("CollisionPolygon");
  });

  it("writes an outline as JSON", async () => {
    const created = await createLayoutComponent({ ...input, collisionPolygon: L_SHAPE as [number, number][] });
    expect(JSON.parse(JSON.parse(String(graphFetch.mock.calls[0][1].body)).fields.CollisionPolygon)).toEqual(L_SHAPE);
    expect(created.collisionPolygon).toEqual(L_SHAPE);
  });
});
