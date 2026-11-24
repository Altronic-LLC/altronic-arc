import { describe, expect, it } from "vitest";
import {
  MAX_OPEN_ITEMS,
  addOpenItem,
  moveOpenItem,
  parseOpenItems,
  removeOpenItem,
  renameOpenItem,
  shiftOpenItem,
  tabLabel,
  type OpenItem,
} from "./openItems";

const item = (n: number, label = `Item ${n}`): OpenItem => ({ path: `/task/${n}`, label, category: "Tasks" });
const paths = (items: OpenItem[]) => items.map((i) => i.path);

describe("parseOpenItems", () => {
  it("reads a stored list", () => {
    expect(parseOpenItems([item(1), item(2)])).toEqual([item(1), item(2)]);
  });

  it("is empty for anything that isn't a list", () => {
    expect(parseOpenItems(null)).toEqual([]);
    expect(parseOpenItems({ path: "/task/1" })).toEqual([]);
    expect(parseOpenItems("nope")).toEqual([]);
  });

  it("drops malformed entries and keeps the good ones", () => {
    const raw = [
      item(1),
      { path: "task/2", label: "no leading slash", category: "" },
      { path: "/task/3", label: "   ", category: "" },
      { path: "/task/4" },
      42,
      null,
      item(5),
    ];
    expect(paths(parseOpenItems(raw))).toEqual(["/task/1", "/task/5"]);
  });

  it("keeps the first copy of a repeated path", () => {
    expect(parseOpenItems([item(1, "first"), item(1, "second")])).toEqual([item(1, "first")]);
  });

  it("reads a missing category as blank", () => {
    expect(parseOpenItems([{ path: "/eir/7", label: "EIR" }])).toEqual([{ path: "/eir/7", label: "EIR", category: "" }]);
  });

  it("cuts the list to the limit", () => {
    const raw = Array.from({ length: MAX_OPEN_ITEMS + 3 }, (_, n) => item(n));
    expect(parseOpenItems(raw)).toHaveLength(MAX_OPEN_ITEMS);
  });
});

describe("addOpenItem", () => {
  it("adds to the END", () => {
    const result = addOpenItem([item(1)], item(2));
    expect(result.ok).toBe(true);
    expect(paths(result.items)).toEqual(["/task/1", "/task/2"]);
  });

  it("refreshes the label of one already open, leaving it in place", () => {
    const result = addOpenItem([item(1), item(2)], item(1, "Renamed"));
    expect(result.items).toEqual([item(1, "Renamed"), item(2)]);
  });

  it("REFUSES when full rather than dropping the oldest", () => {
    const full = Array.from({ length: MAX_OPEN_ITEMS }, (_, n) => item(n));
    const result = addOpenItem(full, item(99));
    expect(result).toEqual({ ok: false, reason: "full", items: full });
  });

  it("still refreshes a label when full", () => {
    const full = Array.from({ length: MAX_OPEN_ITEMS }, (_, n) => item(n));
    const result = addOpenItem(full, item(3, "New name"));
    expect(result.ok).toBe(true);
    expect(result.items[3].label).toBe("New name");
  });

  it("refuses a blank label or a path that isn't a route", () => {
    expect(addOpenItem([], item(1, "  ")).ok).toBe(false);
    expect(addOpenItem([], { path: "task/1", label: "x", category: "" }).ok).toBe(false);
  });

  it("tidies whitespace in the label", () => {
    expect(addOpenItem([], item(1, "  T5  —\n Harness ")).items[0].label).toBe("T5 — Harness");
  });
});

describe("removeOpenItem", () => {
  it("removes by path", () => {
    expect(paths(removeOpenItem([item(1), item(2)], "/task/1"))).toEqual(["/task/2"]);
  });
});

describe("renameOpenItem", () => {
  it("changes the label", () => {
    expect(renameOpenItem([item(1)], "/task/1", "New")[0].label).toBe("New");
  });

  it("returns the SAME array when nothing changed", () => {
    const items = [item(1)];
    expect(renameOpenItem(items, "/task/1", "Item 1")).toBe(items);
    expect(renameOpenItem(items, "/task/9", "Other")).toBe(items);
    expect(renameOpenItem(items, "/task/1", "   ")).toBe(items);
  });
});

describe("moveOpenItem", () => {
  const four = [item(1), item(2), item(3), item(4)];

  it("moves an item to another's place, rightward", () => {
    expect(paths(moveOpenItem(four, "/task/1", "/task/3"))).toEqual(["/task/2", "/task/3", "/task/1", "/task/4"]);
  });

  it("moves an item to another's place, leftward", () => {
    expect(paths(moveOpenItem(four, "/task/4", "/task/2"))).toEqual(["/task/1", "/task/4", "/task/2", "/task/3"]);
  });

  it("changes nothing for an unknown path or a drop on itself", () => {
    expect(moveOpenItem(four, "/task/1", "/task/1")).toBe(four);
    expect(moveOpenItem(four, "/task/9", "/task/1")).toBe(four);
    expect(moveOpenItem(four, "/task/1", "/task/9")).toBe(four);
  });
});

describe("shiftOpenItem", () => {
  const three = [item(1), item(2), item(3)];

  it("moves one place either way", () => {
    expect(paths(shiftOpenItem(three, "/task/2", -1))).toEqual(["/task/2", "/task/1", "/task/3"]);
    expect(paths(shiftOpenItem(three, "/task/2", 1))).toEqual(["/task/1", "/task/3", "/task/2"]);
  });

  it("stops at either end", () => {
    expect(shiftOpenItem(three, "/task/1", -1)).toBe(three);
    expect(shiftOpenItem(three, "/task/3", 1)).toBe(three);
  });
});

describe("tabLabel", () => {
  it("joins the parts that exist", () => {
    expect(tabLabel("EIR_2026-0270", "CM4 BOM")).toBe("EIR_2026-0270 — CM4 BOM");
    expect(tabLabel("EIR_2026-0270", "")).toBe("EIR_2026-0270");
    expect(tabLabel(null, " CM4  BOM ")).toBe("CM4 BOM");
    expect(tabLabel(undefined, null)).toBe("");
  });
});
