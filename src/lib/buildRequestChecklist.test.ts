import { describe, it, expect } from "vitest";
import {
  ALL_CHECKLIST_FIELDS,
  HARNESS_CHECKLIST,
  PCB_CHECKLIST,
  checklistForPartType,
  checklistProgress,
} from "./buildRequestChecklist";

describe("checklistForPartType", () => {
  it("PCB parts get the 14-field PCB data-package checklist", () => {
    expect(checklistForPartType("PCB")).toBe(PCB_CHECKLIST);
    expect(PCB_CHECKLIST).toHaveLength(14);
  });

  it("Harness parts get the 3-field harness checklist", () => {
    expect(checklistForPartType("Harness")).toBe(HARNESS_CHECKLIST);
    expect(HARNESS_CHECKLIST).toHaveLength(3);
  });

  it("other part types (and null) get no checklist", () => {
    expect(checklistForPartType("Product")).toEqual([]);
    expect(checklistForPartType("Machining")).toEqual([]);
    expect(checklistForPartType("Panel")).toEqual([]);
    expect(checklistForPartType(null)).toEqual([]);
  });

  it("field names are unique across all checklists (safe as Record keys)", () => {
    const fields = ALL_CHECKLIST_FIELDS.map((d) => d.field);
    expect(new Set(fields).size).toBe(fields.length);
  });
});

describe("checklistProgress", () => {
  it("counts only the applicable checklist's ticked boxes", () => {
    const checklist = {
      Completed_x0020_BOM: true,
      Schematic: true,
      Terminals_x0020_Ordered: true, // harness field — must not count for PCB
    };
    expect(checklistProgress("PCB", checklist)).toEqual({ done: 2, total: 14 });
    expect(checklistProgress("Harness", checklist)).toEqual({ done: 1, total: 3 });
  });

  it("is 0/0 for part types without a checklist", () => {
    expect(checklistProgress("Product", { Schematic: true })).toEqual({ done: 0, total: 0 });
  });
});
