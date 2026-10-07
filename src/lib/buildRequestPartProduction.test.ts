import { describe, it, expect } from "vitest";
import { MOCK_BUILD_REQUEST_ITEMS } from "@/data/buildRequestMockData";
import type { BuildRequestItem } from "@/types/task";
import { PCB_CHECKLIST } from "./buildRequestChecklist";
import {
  partProductionState,
  partReadiness,
  partStatusTransitionRefusal,
} from "./buildRequestPartProduction";

/** A part with no checklist and every required field filled in. */
const plain = (over: Partial<BuildRequestItem> = {}): BuildRequestItem => ({
  ...MOCK_BUILD_REQUEST_ITEMS[0],
  partNumber: "201-1234",
  qty: 5,
  partDesc: "Bracket",
  partType: "Machining",
  disposition: "For Stock",
  partStatus: null,
  checklist: {},
  ...over,
});

const allTicked = Object.fromEntries(PCB_CHECKLIST.map((d) => [d.field, true]));
const approver = { isApprover: true };
const engineer = { isApprover: false };
const labels = (s: ReturnType<typeof partProductionState>) => s.buttons.map((b) => b.label);

describe("partReadiness", () => {
  it("a part with no checklist is ready once the five fields are filled", () => {
    expect(partReadiness(plain())).toEqual({ ready: true, missing: [] });
  });

  it("names each missing field", () => {
    const r = partReadiness(plain({ partNumber: " ", qty: null, partDesc: "", disposition: null }));
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(["Part Number", "Qty", "Part Description", "Disposition"]);
  });

  it("a qty of 0 isn't a quantity to build", () => {
    expect(partReadiness(plain({ qty: 0 })).missing).toEqual(["Qty"]);
  });

  it("a PCB or Harness part is judged on its checklist", () => {
    const some = { [PCB_CHECKLIST[0].field]: true };
    const r = partReadiness(plain({ partType: "PCB", checklist: some }));
    expect(r.ready).toBe(false);
    expect(r.missing).toHaveLength(PCB_CHECKLIST.length - 1);
    expect(partReadiness(plain({ partType: "PCB", checklist: allTicked })).ready).toBe(true);
  });
});

describe("partProductionState — the buttons at each stage", () => {
  it("before production: one bright-red Mark as Ready for Production", () => {
    const s = partProductionState(plain({ partStatus: "Review Checklist" }), engineer);
    expect(labels(s)).toEqual(["Mark as Ready for Production"]);
    expect(s.buttons[0]).toMatchObject({ primary: true, allowed: true });
  });

  it("is greyed until the part is ready, saying what's left", () => {
    const s = partProductionState(plain({ partType: "PCB", checklist: {} }), engineer);
    expect(s.buttons[0].allowed).toBe(false);
    expect(s.buttons[0].hint).toMatch(new RegExp(`${PCB_CHECKLIST.length} checklist items left`));
  });

  it("Ready for Production offers In Production, to the approver only", () => {
    const item = plain({ partStatus: "Ready for Production" });
    expect(labels(partProductionState(item, approver))).toEqual(["Mark as In Production"]);
    expect(partProductionState(item, approver).buttons[0].allowed).toBe(true);
    const asEngineer = partProductionState(item, engineer).buttons[0];
    expect(asEngineer.allowed).toBe(false);
    expect(asEngineer.hint).toMatch(/Amanda Hoagland or an ARC admin/);
  });

  it("In Production offers On Hold and Production Complete", () => {
    expect(labels(partProductionState(plain({ partStatus: "In Production" }), approver))).toEqual([
      "Put On Hold",
      "Mark as Production Complete",
    ]);
  });

  it("On Hold offers back into production, or Production Complete", () => {
    expect(labels(partProductionState(plain({ partStatus: "On Hold" }), approver))).toEqual([
      "Mark as In Production",
      "Mark as Production Complete",
    ]);
  });

  it("Production Complete has no button", () => {
    const s = partProductionState(plain({ partStatus: "Production Complete" }), approver);
    expect(s.buttons).toEqual([]);
    expect(s.note).toMatch(/complete/i);
  });

  it("says so when SharePoint's Part Status column doesn't offer the next status", () => {
    const live = ["Review Checklist", "Ready for Production", "Production Complete", "On Hold"];
    const b = partProductionState(plain({ partStatus: "Ready for Production" }), approver, live).buttons[0];
    expect(b.allowed).toBe(false);
    expect(b.hint).toMatch(/"In Production" isn't a Part Status choice in SharePoint/);
  });

  it("says it's checking rather than refusing while access is still loading", () => {
    const b = partProductionState(plain({ partStatus: "Ready for Production" }), {
      isApprover: false,
      resolving: true,
    }).buttons[0];
    expect(b.hint).toBe("Checking your access…");
  });
});

describe("partStatusTransitionRefusal — the write guard", () => {
  it("refuses Ready for Production on a part that isn't ready", () => {
    expect(partStatusTransitionRefusal(plain({ qty: null }), "Ready for Production", engineer)).toMatch(/Qty/);
    expect(partStatusTransitionRefusal(plain(), "Ready for Production", engineer)).toBeNull();
  });

  it("refuses the production steps to anyone but the approver", () => {
    const item = plain({ partStatus: "Ready for Production" });
    expect(partStatusTransitionRefusal(item, "In Production", engineer)).toMatch(/Amanda Hoagland/);
    expect(partStatusTransitionRefusal(item, "In Production", approver)).toBeNull();
  });

  it("refuses skipping a step", () => {
    expect(partStatusTransitionRefusal(plain(), "Production Complete", approver)).toMatch(/straight to/);
  });

  it("lets a re-save and statuses outside the workflow through", () => {
    expect(partStatusTransitionRefusal(plain({ partStatus: "On Hold" }), "On Hold", engineer)).toBeNull();
    expect(partStatusTransitionRefusal(plain(), "Information Needed", engineer)).toBeNull();
  });
});
