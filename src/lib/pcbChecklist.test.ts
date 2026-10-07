import { describe, expect, it, vi } from "vitest";
import type { TaskColumn } from "@/api/taskColumns";
import { listTaskColumns } from "@/api/taskColumns";
import { PCB_CHECKLIST_ITEMS, resolvePcbChecklist } from "./pcbChecklist";

// Forced on, not inherited: a local .env.local sets VITE_USE_MOCK=false and
// CI has no env file at all, so the mock-columns case must not depend on
// either.
vi.mock("@/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/config")>();
  return { ...actual, USE_MOCK: true };
});

function column(displayName: string, kind: TaskColumn["kind"] = "boolean"): TaskColumn {
  return {
    name: displayName.replace(/ /g, "_x0020_").slice(0, 32),
    displayName,
    kind,
    choices: kind === "choice" ? ["Yes", "No"] : [],
    allowTextEntry: false,
  };
}

const FIDUCIALS = "Fiducials on top and bottom of actual PCB";
const DRC = "Design Rule Checks Completed and Resolved";

describe("PCB_CHECKLIST_ITEMS", () => {
  it("has 19 items — 15 Yes/No and 4 choice — as the User Manual says", () => {
    expect(PCB_CHECKLIST_ITEMS).toHaveLength(19);
    expect(PCB_CHECKLIST_ITEMS.filter((i) => i.kind === "boolean")).toHaveLength(15);
    expect(PCB_CHECKLIST_ITEMS.filter((i) => i.kind === "choice")).toHaveLength(4);
  });

  it("puts Fiducials and DRC directly after the schematic part number", () => {
    const left = PCB_CHECKLIST_ITEMS.filter((i) => i.column === "left").map((i) => i.displayName);
    expect(left.slice(0, 3)).toEqual(["Schematic Part Number Pulled If new", FIDUCIALS, DRC]);
  });

  it("adds both as Yes/No checkboxes", () => {
    for (const name of [FIDUCIALS, DRC]) {
      expect(PCB_CHECKLIST_ITEMS.find((i) => i.displayName === name)?.kind).toBe("boolean");
    }
  });

  // The card renders in ARRAY order; `order` is the documented position.
  // The two must agree, or the registry says one thing and the screen another.
  it("numbers each column 1..n in the same order the array declares", () => {
    for (const side of ["left", "right"] as const) {
      const orders = PCB_CHECKLIST_ITEMS.filter((i) => i.column === side).map((i) => i.order);
      expect(orders).toEqual(orders.map((_, idx) => idx + 1));
    }
  });

  // Matching is by display name, case-insensitively — two entries differing
  // only in case would both resolve to the same SharePoint column.
  it("has no two items with the same display name, ignoring case", () => {
    const names = PCB_CHECKLIST_ITEMS.map((i) => i.displayName.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("resolvePcbChecklist", () => {
  it("attaches the matching SharePoint column, ignoring case", () => {
    const spColumns = [column(FIDUCIALS.toUpperCase()), column(DRC.toLowerCase())];
    const resolved = resolvePcbChecklist(spColumns);
    expect(resolved.find((i) => i.displayName === FIDUCIALS)?.spColumn).toBe(spColumns[0]);
    expect(resolved.find((i) => i.displayName === DRC)?.spColumn).toBe(spColumns[1]);
  });

  it("leaves an item with no SharePoint column as null, so the card can say so", () => {
    const resolved = resolvePcbChecklist([column(FIDUCIALS)]);
    expect(resolved.find((i) => i.displayName === DRC)?.spColumn).toBeNull();
  });

  it("returns every item, in declared order, whatever order the columns arrive in", () => {
    const spColumns = [...PCB_CHECKLIST_ITEMS].reverse().map((i) => column(i.displayName, i.kind));
    expect(resolvePcbChecklist(spColumns).map((i) => i.displayName)).toEqual(
      PCB_CHECKLIST_ITEMS.map((i) => i.displayName),
    );
  });

  // Demo mode must not show a red "column missing" box for any item.
  it("resolves every item against the mock Task list columns", async () => {
    const missing = resolvePcbChecklist(await listTaskColumns())
      .filter((i) => i.spColumn === null)
      .map((i) => i.displayName);
    expect(missing).toEqual([]);
  });

  it("matches each item's kind to its mock column's kind", async () => {
    for (const item of resolvePcbChecklist(await listTaskColumns())) {
      expect(item.spColumn?.kind, item.displayName).toBe(item.kind);
    }
  });
});
