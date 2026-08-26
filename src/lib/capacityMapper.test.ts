import { describe, it, expect } from "vitest";
import { buildCapacityFields, compareCapacityEntries, toCapacityEntry } from "./capacityMapper";
import type { CapacityEntry, GraphListItem } from "@/types/task";

function item(fields: Record<string, unknown>): GraphListItem {
  return { id: "1", fields } as unknown as GraphListItem;
}

describe("toCapacityEntry", () => {
  it("reads WeeklyMax as a number and the truncated CustomerP/N column", () => {
    const entry = toCapacityEntry(
      item({ Title: "1004-0770-00", WeeklyMax: 300, CustomerP_x002f_N: "1244136" }),
    );
    expect(entry.weeklyMax).toBe(300);
    expect(entry.customerPartNumber).toBe("1244136");
  });

  it("reads a blank WeeklyMax as null, not zero", () => {
    expect(toCapacityEntry(item({})).weeklyMax).toBeNull();
  });
});

describe("buildCapacityFields", () => {
  it("writes the truncated CustomerP/N column name", () => {
    expect(buildCapacityFields({ customerPartNumber: "123" })).toEqual({
      CustomerP_x002f_N: "123",
    });
  });

  it("writes WeeklyMax even when null (clearing it)", () => {
    expect(buildCapacityFields({ weeklyMax: null })).toEqual({ WeeklyMax: null });
  });
});

describe("compareCapacityEntries", () => {
  it("sorts alphabetically by part number", () => {
    const a: CapacityEntry = {
      id: 1,
      partNumber: "Zeta",
      customerId: 1,
      description: "",
      weeklyMax: null,
      notes: "",
      customerPartNumber: "",
    };
    const b: CapacityEntry = { ...a, id: 2, partNumber: "Andy" };
    expect([a, b].sort(compareCapacityEntries)).toEqual([b, a]);
  });
});
