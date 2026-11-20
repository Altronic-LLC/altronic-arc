import { describe, expect, it } from "vitest";
import type { GraphListItem } from "@/types/task";
import type { McnInput } from "@/types/mcn";
import { applyMcnPatch, buildMcnCreateFields, buildMcnUpdateFields, mcnLabel, scopeDepartmentLabel, toMcn } from "./mcnMapper";
import { MOCK_MCNS } from "@/data/mcnMockData";

function item(fields: Record<string, unknown>): GraphListItem {
  return { id: "7", createdDateTime: "2026-10-01T10:00:00Z", lastModifiedDateTime: "2026-10-02T10:00:00Z", fields };
}

describe("toMcn", () => {
  it("reads a single-person column from a bare LookupId — never as nobody", () => {
    const m = toMcn(item({ Title: "MCN26002", AssignedEngineerLookupId: "46", McnStatus: "Submitted" }));
    expect(m.assignedEngineer).toEqual({ displayName: "", lookupId: 46 });
    expect(m.status).toBe("Submitted");
  });

  it("reads the Operations task lookup from its bare id", () => {
    expect(toMcn(item({ OperationsTaskRefLookupId: 12 })).operationsTask).toEqual({ lookupId: 12, title: "" });
  });

  it("reads the multi-choice Distribution as an array, and the item answers loosely", () => {
    const m = toMcn(item({ Distribution: ["Sales", "Engineering"], ReqRouter: "yes", ReqRouterRef: " 100-1 " }));
    expect(m.distribution).toEqual(["Sales", "Engineering"]);
    expect(m.items.router).toEqual({ answer: "Yes", reference: "100-1" });
    expect(m.items.she).toEqual({ answer: "", reference: "" });
  });

  it("reads an unknown status as Draft", () => {
    expect(toMcn(item({ McnStatus: "Banana" })).status).toBe("Draft");
  });

  it("keeps a scope it can't read flagged, not emptied", () => {
    expect(toMcn(item({ ScopeLines: "not json" })).scopeCorrupt).toBe(true);
  });
});

describe("buildMcnCreateFields", () => {
  const input: McnInput = {
    date: new Date(Date.UTC(2026, 9, 26, 12)),
    process: " Coolant change ",
    priority: "Level 2",
    originatedBy: null,
    assignedEngineer: null,
    description: "First line\n\nSecond",
    scope: [],
    distribution: ["Sales"],
    watchers: [],
  };

  it("starts every MCN as a Draft, and writes the description as rich text", () => {
    const f = buildMcnCreateFields(input);
    expect(f.McnStatus).toBe("Draft");
    expect(f.Process).toBe("Coolant change");
    expect(String(f.Description)).toContain("<p>");
    expect(f.Distribution).toEqual(["Sales"]);
  });

  it("leaves blank columns out entirely", () => {
    const f = buildMcnCreateFields({ ...input, priority: "", description: "", distribution: [] });
    expect(f).not.toHaveProperty("Priority");
    expect(f).not.toHaveProperty("Description");
    expect(f).not.toHaveProperty("ScopeLines");
    expect(f).not.toHaveProperty("Distribution");
  });
});

describe("buildMcnUpdateFields — only what changed", () => {
  const before = MOCK_MCNS[1];

  it("sends nothing for an unchanged card", () => {
    expect(buildMcnUpdateFields({ process: before.process, priority: before.priority }, before)).toEqual({});
  });

  it("sends only the item columns that moved, and clears an answer with null", () => {
    const items = { ...before.items, router: { answer: "" as const, reference: before.items.router.reference } };
    expect(buildMcnUpdateFields({ items }, before)).toEqual({ ReqRouter: null });
  });

  it("refuses to write over a scope it couldn't read", () => {
    expect(() => buildMcnUpdateFields({ scope: [] }, { ...before, scopeCorrupt: true })).toThrow(/won't write over it/);
  });

  it("applies the same patch to the optimistic row", () => {
    const next = applyMcnPatch(before, { process: "  New title " });
    expect(next.process).toBe("New title");
    expect(next).not.toBe(before);
  });
});

describe("labels", () => {
  it("names an MCN by number and process", () => {
    expect(mcnLabel({ id: 3, mcnNumber: "MCN26003", process: "Coolant" })).toBe("MCN26003 — Coolant");
    expect(mcnLabel({ id: 3, mcnNumber: "", process: "" })).toBe("MCN #3");
  });

  it("shows a department by its CURRENT name, falling back to the stored one", () => {
    const names = new Map([[6, "PRODUCTION"]]);
    expect(scopeDepartmentLabel({ departmentId: 6, department: "PROD", process: "", equipment: "" }, names)).toBe("PRODUCTION");
    expect(scopeDepartmentLabel({ departmentId: 99, department: "OLD", process: "", equipment: "" }, names)).toBe("OLD");
  });
});
