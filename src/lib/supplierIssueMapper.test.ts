import { describe, it, expect } from "vitest";
import {
  buildSupplierIssueCreateFields,
  compareSupplierIssues,
  supplierIssueLabel,
  toSupplierIssue,
} from "./supplierIssueMapper";
import type { GraphListItem, SupplierIssue } from "@/types/task";

function item(fields: Record<string, unknown>): GraphListItem {
  return { id: "1", fields } as unknown as GraphListItem;
}

describe("toSupplierIssue", () => {
  it("reads the BPReference lookup, and the placeholder Status/Severity choices", () => {
    const issue = toSupplierIssue(
      item({ Title: "Test", BPReferenceLookupId: "29", Status: "Choice 1", Severity: "Choice 1" }),
    );
    expect(issue.supplierId).toBe(29);
    expect(issue.status).toBe("Choice 1");
    expect(issue.severity).toBe("Choice 1");
  });

  it("drops a Status/Severity value outside the known placeholder choices", () => {
    const issue = toSupplierIssue(item({ Status: "Resolved", Severity: "High" }));
    expect(issue.status).toBeNull();
    expect(issue.severity).toBeNull();
  });
});

describe("buildSupplierIssueCreateFields", () => {
  it("writes the BPReference lookup as a bare id and Watchers as multi-person", () => {
    const fields = buildSupplierIssueCreateFields(
      { title: "Late shipment", supplierId: 29, description: "", status: null, severity: null, watchers: [] },
      { watchers: [{ displayName: "Ray White", lookupId: 22 }] },
    );
    expect(fields.BPReferenceLookupId).toBe(29);
    expect(fields["WatchersLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
  });
});

describe("supplierIssueLabel / compareSupplierIssues", () => {
  const base: SupplierIssue = {
    id: 1,
    title: "",
    supplierId: 1,
    description: "",
    status: null,
    resolution: "",
    severity: null,
    comments: [],
    watchers: [],
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
  };

  it("falls back to a numbered label when the title is blank", () => {
    expect(supplierIssueLabel(base)).toBe("Issue #1");
    expect(supplierIssueLabel({ ...base, title: "Late shipment" })).toBe("Late shipment");
  });

  it("sorts newest first", () => {
    const older = { ...base, id: 1, createdAt: new Date(1000) };
    const newer = { ...base, id: 2, createdAt: new Date(2000) };
    expect([older, newer].sort(compareSupplierIssues)).toEqual([newer, older]);
  });
});
