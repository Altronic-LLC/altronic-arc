import { describe, it, expect } from "vitest";
import { parentNoun } from "./AttachmentsSection";
import type { AttachmentParent } from "@/api/attachments";

// The delete confirmation used to name the parent through a six-deep nested
// ternary, whose fallback was "task" — so every parent kind added after the
// chain was written (equipment, supplier, ecn, fait, …) silently asked
// "remove this from this task?". This is the same behaviour, as a map, so
// adding a kind means adding a line rather than re-reading the chain.

describe("parentNoun", () => {
  it("names a PM schedule a schedule, not a task", () => {
    expect(parentNoun("scheduledMaintenance")).toBe("schedule");
  });

  it("keeps the nouns the nested ternary already had", () => {
    expect(parentNoun("eir")).toBe("EIR");
    expect(parentNoun("buildRequest")).toBe("build request");
    expect(parentNoun("buildRequestItem")).toBe("part");
    expect(parentNoun("visitReport")).toBe("visit report");
    expect(parentNoun("grayMarketRequest")).toBe("request");
  });

  it("names every parent, with no silent fallback to task", () => {
    // The `?? "task"` fallback used to catch eight kinds, so deleting a file
    // off a supplier, an ECN, a FAIT or a machine asked "Delete this task's
    // attachment?" on screens with no tasks anywhere near them.
    expect(parentNoun("task")).toBe("task");
    expect(parentNoun("operationsTask")).toBe("task");
    expect(parentNoun("equipment")).toBe("asset");
    expect(parentNoun("maintenanceTask")).toBe("work order");
    expect(parentNoun("ecn")).toBe("ECN");
    expect(parentNoun("fait")).toBe("FAIT");
    expect(parentNoun("supplier")).toBe("supplier");
    expect(parentNoun("supplierContact")).toBe("contact");
    expect(parentNoun("supplierIssue")).toBe("issue");
    expect(parentNoun("csaListing")).toBe("CSA listing");
    expect(parentNoun("costImpactNotice")).toBe("notice");
    expect(parentNoun("panelOrder")).toBe("panel order");
    expect(parentNoun("panelTask")).toBe("panel task");
  });

  it("has an entry for EVERY AttachmentParent", () => {
    // PARENT_NOUN is a total Record, so a new parent kind added without a noun
    // is a compile error rather than a silent "task" on a new screen. This
    // asserts the runtime half: nothing resolves to empty or undefined.
    const parents = [
      "task", "eir", "ecn", "fait", "operationsTask", "maintenanceTask",
      "equipment", "scheduledMaintenance", "buildRequest", "buildRequestItem",
      "panelOrder", "panelTask", "csaListing", "visitReport",
      "grayMarketRequest", "supplier", "supplierContact", "supplierIssue",
      "costImpactNotice",
    ] as const;
    for (const p of parents) {
      expect(parentNoun(p)).toBeTruthy();
    }
  });

  it("answers for every AttachmentParent", () => {
    const parents: AttachmentParent[] = [
      "task",
      "eir",
      "ecn",
      "fait",
      "operationsTask",
      "maintenanceTask",
      "scheduledMaintenance",
      "buildRequest",
      "buildRequestItem",
      "panelOrder",
      "panelTask",
      "csaListing",
      "visitReport",
      "grayMarketRequest",
      "supplier",
      "supplierContact",
      "supplierIssue",
      "costImpactNotice",
      "equipment",
    ];
    for (const p of parents) {
      expect(parentNoun(p)).toBeTruthy();
    }
  });
});
