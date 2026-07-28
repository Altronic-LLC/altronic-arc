import { describe, it, expect } from "vitest";
import { teradyneRefUsage } from "./useTeradyne";
import type { TeradyneLogEntry } from "@/types/task";

function entry(partial: Partial<TeradyneLogEntry>): TeradyneLogEntry {
  return {
    id: 1,
    title: "",
    enterDate: null,
    product: null,
    employee1: null,
    employee2: null,
    remark: null,
    employee1Clock: null,
    employee2Clock: null,
    defectiveParts: "",
    numberOfBoards: null,
    boardsTested: null,
    failuresPerBoard: null,
    sapNumber: "",
    oldSapNumber: "",
    operatorNotes: "",
    createdAt: new Date(),
    modifiedAt: new Date(),
    ...partial,
  };
}

const ref = (lookupId: number) => ({ lookupId, title: `#${lookupId}` });

describe("teradyneRefUsage", () => {
  it("counts how many entries reference each product", () => {
    const usage = teradyneRefUsage(
      [
        entry({ id: 1, product: ref(201) }),
        entry({ id: 2, product: ref(201) }),
        entry({ id: 3, product: ref(214) }),
        entry({ id: 4, product: null }),
      ],
      "products",
    );
    expect(usage.get(201)).toBe(2);
    expect(usage.get(214)).toBe(1);
    expect(usage.has(999)).toBe(false);
  });

  it("counts remarks", () => {
    const usage = teradyneRefUsage([entry({ remark: ref(4) }), entry({ remark: ref(4) })], "remarks");
    expect(usage.get(4)).toBe(2);
  });

  it("counts an employee across both slots", () => {
    const usage = teradyneRefUsage(
      [entry({ id: 1, employee1: ref(8) }), entry({ id: 2, employee2: ref(8) })],
      "employees",
    );
    expect(usage.get(8)).toBe(2);
  });

  it("counts an employee once when they hold both slots on the same entry", () => {
    const usage = teradyneRefUsage(
      [entry({ employee1: ref(8), employee2: ref(8) })],
      "employees",
    );
    expect(usage.get(8)).toBe(1);
  });

  it("returns an empty map for an empty log", () => {
    expect(teradyneRefUsage([], "products").size).toBe(0);
  });

  it("ignores the other lists' lookups when counting one kind", () => {
    const usage = teradyneRefUsage([entry({ product: ref(201), remark: ref(201) })], "products");
    expect(usage.get(201)).toBe(1);
  });
});
