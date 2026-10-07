import { describe, expect, it } from "vitest";
import {
  SCN_COLUMN_KEYS,
  SCN_DATE_COLUMNS,
  SCN_FIELDS,
  SCN_MULTI_CHOICE_COLUMNS,
  SCN_SECTIONS,
  SCN_SELECT,
  scnField,
  scnFieldLabel,
  scnFieldsInSection,
} from "./scnFields";
// =============================================================================
// The descriptor table against the LIVE schema — every column ARC names must
// exist on the list, and the labels the spec chose must win over the internal
// names that lie.
//
// The writable columns below are TRANSCRIBED from
// scripts/scn-dashboard-schema.json (captured 2026-10-07 with
// `discover-list.ps1 -ListName "SCN Dashboard" -Site scn`). Inlined rather
// than imported, because scripts/*-schema.json is deliberately gitignored —
// an import would pass on the machine that ran discovery and fail the deploy
// for everyone else (the buildRequestItems.multiChoice.test.ts lesson).
// Re-run the script and update this block if the SharePoint columns change.
// =============================================================================

const LIVE_COLUMNS: Record<string, { choices?: string[] }> = {
  Title: {},
  Description: {},
  AssignedTo: {},
  Notes: {},
  SCNStatus: { choices: ["WIP", "CLOSED", "Cancelled", "On Hold", "LTB in process", "Customer Phase Out"] },
  Progress: {},
  Priority: { choices: ["OBS", "PHASE OUT", "EECR", "Notification"] },
  Customer: {},
  Owner: {},
  EOLExpires: {},
  Task_x0020_List: {},
  ApprovalStatus: { choices: ["Approved", "Denied"] },
  CustomerRef_x0023_: {},
  FinalDisposition: {},
  PartsEffected: {},
  SalesHistory: {},
  ProjectStatus: {
    choices: [
      "Immediate Phase Complete",
      "Analysis Phase Complete",
      "Inventory Mgmt Phase Complete",
      "Final Obsolescence Complete",
    ],
  },
  CustomerProduct: {},
  PreliminaryReviews: {
    choices: [
      "Master List Reviewed",
      "Price List Reviewed",
      "Where Used Reviewed",
      "Service Team Review Completed",
    ],
  },
  LTBExpires: {},
  SecondaryReview: {
    choices: [
      "Service Review Completed",
      "Master List Review Completed",
      "Price List Review Completed",
      "Sales History Review Completed",
    ],
  },
  SAPNumber: {},
  DrawingNumber: {},
  PartDescription: {},
  YEAR: {},
  Sign_x002d_off_x0020_status: {},
  FixtureReview: {},
  ECN: {},
  Communication: {},
  Watchers: {},
  ProjectReference: {},
  Attachments: {},
};

const liveColumns = new Map(Object.entries(LIVE_COLUMNS));

describe("every descriptor column exists on the live list", () => {
  it("names only real internal columns", () => {
    for (const field of SCN_FIELDS) {
      expect(liveColumns.has(field.column), `${field.key} → ${field.column}`).toBe(true);
    }
  });

  it("declares each choice list verbatim from the column", () => {
    for (const field of SCN_FIELDS) {
      if (!field.options) continue;
      expect([...field.options], field.column).toEqual(liveColumns.get(field.column)!.choices);
    }
  });

  it("has no duplicate keys or columns", () => {
    const keys = SCN_FIELDS.map((f) => f.key);
    const columns = SCN_FIELDS.map((f) => f.column);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(columns).size).toBe(columns.length);
  });
});

describe("the labels that differ from the internal name", () => {
  it("call Progress the Product, Priority the Category, PartsEffected the Old Number, EOLExpires LTS Expires", () => {
    expect(scnField("product")?.column).toBe("Progress");
    expect(scnFieldLabel("product")).toBe("Product");
    expect(scnField("category")?.column).toBe("Priority");
    expect(scnFieldLabel("category")).toBe("Category");
    expect(scnField("oldNumber")?.column).toBe("PartsEffected");
    expect(scnFieldLabel("oldNumber")).toBe("Old Number");
    expect(scnField("ltsExpires")?.column).toBe("EOLExpires");
    expect(scnFieldLabel("ltsExpires")).toBe("LTS Expires");
  });

  it("falls back to the key for an unknown label", () => {
    expect(scnFieldLabel("nope")).toBe("nope");
  });
});

describe("kinds", () => {
  it("marks the three checkBoxes columns multi-choice, and only those", () => {
    expect([...SCN_MULTI_CHOICE_COLUMNS].sort()).toEqual(
      ["PreliminaryReviews", "ProjectStatus", "SecondaryReview"].sort(),
    );
    // Single dropDowns must never pick up the annotation.
    for (const single of ["SCNStatus", "Priority", "ApprovalStatus"]) {
      expect(SCN_MULTI_CHOICE_COLUMNS).not.toContain(single);
    }
  });

  it("marks the three date-only columns", () => {
    expect([...SCN_DATE_COLUMNS].sort()).toEqual(["EOLExpires", "FixtureReview", "LTBExpires"].sort());
  });

  it("makes Task List a read-only link", () => {
    const link = scnField("taskList")!;
    expect(link.column).toBe("Task_x0020_List");
    expect(link.kind).toBe("link");
    expect(link.readOnly).toBe(true);
  });

  it("marks Approval Status required and the sidebar strings as named", () => {
    expect(scnField("approvalStatus")?.required).toBe(true);
    for (const key of ["product", "category", "status", "approvalStatus"]) {
      expect(scnField(key)?.named, key).toBe(true);
    }
    expect(scnField("description")?.named).toBeUndefined();
  });

  it("caps ECN at 10 characters, as the column does", () => {
    expect(scnField("ecn")?.maxLength).toBe(10);
  });
});

describe("sections", () => {
  it("has the four cards in order, and the sidebar apart", () => {
    expect(SCN_SECTIONS).toEqual(["Notice", "Parts", "Review", "Outcome"]);
    expect(scnFieldsInSection("Sidebar").map((f) => f.key)).toEqual([
      "status",
      "approvalStatus",
      "assignedTo",
      "owner",
      // Ray, 2026-10-07: the two cross-site references live in the right panel.
      "projectReference",
      "taskList",
    ]);
  });

  it("puts the spec's fields on the spec's cards", () => {
    expect(scnFieldsInSection("Notice").map((f) => f.key)).toEqual([
      "product",
      "category",
      "description",
      "customer",
      "customerRef",
      "customerProduct",
    ]);
    expect(scnFieldsInSection("Parts").map((f) => f.key)).toEqual([
      "oldNumber",
      "sapNumber",
      "drawingNumber",
      "partDescription",
      "ecn",
    ]);
    expect(scnFieldsInSection("Review").map((f) => f.key)).toEqual([
      "preliminaryReviews",
      "secondaryReview",
      "projectStatus",
      "signOffStatus",
      "fixtureReview",
    ]);
    expect(scnFieldsInSection("Outcome").map((f) => f.key)).toEqual([
      "finalDisposition",
      "salesHistory",
      "ltsExpires",
      "ltbExpires",
      "notes",
    ]);
  });
});

describe("SCN_SELECT", () => {
  it("asks for every descriptor column plus the named ones", () => {
    const selected = SCN_SELECT.split(",");
    for (const field of SCN_FIELDS) expect(selected).toContain(field.column);
    for (const named of ["Title", "YEAR", "Watchers", "Communication", "Attachments"]) {
      expect(selected).toContain(named);
    }
  });

  it("never asks for the read-only LinkTitle column", () => {
    // Writing it is the 403 that broke every Panel QC create; selecting it
    // buys nothing Title doesn't already give.
    expect(SCN_SELECT.split(",")).not.toContain("LinkTitle");
  });

  it("maps every column back to its key", () => {
    expect(SCN_COLUMN_KEYS.Progress).toBe("product");
    expect(SCN_COLUMN_KEYS.PartsEffected).toBe("oldNumber");
  });
});
