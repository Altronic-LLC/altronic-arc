import { describe, it, expect } from "vitest";
import {
  attachBuildRequestReferences,
  parseMultiChoice,
  toBuildRequest,
  toBuildRequestItem,
} from "./buildRequestMapper";
import type { GraphListItem, Person, ProjectReference } from "@/types/task";

function makeItem(
  fields: Record<string, unknown> = {},
  overrides: Partial<GraphListItem> = {},
): GraphListItem {
  return {
    id: "7",
    createdDateTime: "2026-07-06T13:02:00Z",
    lastModifiedDateTime: "2026-07-14T15:10:00Z",
    fields: fields as GraphListItem["fields"],
    ...overrides,
  };
}

describe("toBuildRequest — header mapping", () => {
  it("maps the core identity fields", () => {
    const br = toBuildRequest(
      makeItem({
        Title: "HUB V4",
        Product: "Detechtion Hub V4",
        BRNo_x002e_: "BR_2026-1009",
        BRStatus: "In-process",
        BrType0: "Prototype",
        RequiredLeadTime: "Rush",
        CustomerName: "Detechtion",
        CustomerPurchaseOrder: "PO-1234",
        RoHS: true,
      }),
    );
    expect(br.title).toBe("HUB V4");
    expect(br.product).toBe("Detechtion Hub V4");
    expect(br.brNo).toBe("BR_2026-1009");
    expect(br.status).toBe("In-process");
    expect(br.brType).toBe("Prototype");
    expect(br.requiredLeadTime).toBe("Rush");
    expect(br.customerName).toBe("Detechtion");
    expect(br.customerPO).toBe("PO-1234");
    expect(br.leadFree).toBe(true);
  });

  it("clamps an unknown status to Submitted", () => {
    expect(toBuildRequest(makeItem({ BRStatus: "Bogus" })).status).toBe("Submitted");
    expect(toBuildRequest(makeItem({})).status).toBe("Submitted");
  });

  it("falls back to a name-less Person from bare LookupIds for Requestor/EngineerAssigned", () => {
    const br = toBuildRequest(
      makeItem({ RequestorLookupId: "37", EngineerAssignedLookupId: 246 }),
    );
    expect(br.requestor).toEqual({ lookupId: 37, displayName: "" });
    expect(br.engineerAssigned).toEqual({ lookupId: 246, displayName: "" });
  });

  it("is null when the person fields are entirely absent", () => {
    const br = toBuildRequest(makeItem({}));
    expect(br.requestor).toBeNull();
    expect(br.engineerAssigned).toBeNull();
  });

  it("parses the multi-lookup ProjectReference (resolved objects)", () => {
    const br = toBuildRequest(
      makeItem({
        ProjectReference: [{ LookupId: 304, LookupValue: "343-MT-Detechtion Hub V4" }],
      }),
    );
    expect(br.parentProjects).toEqual([
      { lookupId: 304, title: "343-MT-Detechtion Hub V4" },
    ]);
  });

  it("parses the Communication field into comments", () => {
    const br = toBuildRequest(
      makeItem({
        Communication:
          "03/10/2026 03:28:04 PM|||Amanda Hoagland|||amanda.hoagland@altronic-llc.com|||<p>hello</p>",
      }),
    );
    expect(br.comments).toHaveLength(1);
    expect(br.comments[0].authorName).toBe("Amanda Hoagland");
  });

  it("maps TaskReferenceLookupId to a number (or null)", () => {
    expect(toBuildRequest(makeItem({ TaskReferenceLookupId: "2482" })).taskReferenceLookupId).toBe(2482);
    expect(toBuildRequest(makeItem({})).taskReferenceLookupId).toBeNull();
  });
});

describe("toBuildRequestItem — item mapping", () => {
  it("maps the part identity + parent join id", () => {
    const it2 = toBuildRequestItem(
      makeItem({
        Title: "291503",
        BuildRequestNoLookupId: "7",
        PartDesc: "Final Assembly NGI-5000 Coil",
        DrawingNo: "291503",
        DrawingRev: "3",
        Qty: 10,
        WONo_x002e_: "WO-1",
        PartType: "Product",
        Part_x0020_Status: "Information Needed",
        Disposition: "For Stock",
      }),
    );
    expect(it2.partNumber).toBe("291503");
    expect(it2.buildRequestLookupId).toBe(7);
    expect(it2.partDesc).toBe("Final Assembly NGI-5000 Coil");
    expect(it2.qty).toBe(10);
    expect(it2.woNo).toBe("WO-1");
    expect(it2.partType).toBe("Product");
    expect(it2.partStatus).toBe("Information Needed");
    expect(it2.disposition).toBe("For Stock");
  });

  it("parses multi-choice Assembly/Operations/Testing arrays", () => {
    const it2 = toBuildRequestItem(
      makeItem({ Assembly: ["Coil Assy"], Testing: ["Final", "Visual"] }),
    );
    expect(it2.assembly).toEqual(["Coil Assy"]);
    expect(it2.testing).toEqual(["Final", "Visual"]);
    expect(it2.operations).toEqual([]);
  });

  it("reads every checklist boolean into the checklist record", () => {
    const it2 = toBuildRequestItem(
      makeItem({ Completed_x0020_BOM: true, Fiducials: false, Terminals_x0020_Ordered: true }),
    );
    expect(it2.checklist.Completed_x0020_BOM).toBe(true);
    expect(it2.checklist.Fiducials).toBe(false);
    expect(it2.checklist.Terminals_x0020_Ordered).toBe(true);
    // Unmentioned fields default false
    expect(it2.checklist.Schematic).toBe(false);
  });

  it("parses the item's own Communication thread", () => {
    const it2 = toBuildRequestItem(
      makeItem({
        Communication:
          "07/01/2026 10:15:00 AM|||Matt Traina|||matthew.traina@altronic-llc.com|||<p>done</p>",
      }),
    );
    expect(it2.comments).toHaveLength(1);
  });

  it("parses single-lookup ProjectReference on items", () => {
    const it2 = toBuildRequestItem(makeItem({ ProjectReferenceLookupId: "24" }));
    expect(it2.projectRef).toEqual({ lookupId: 24, title: "" });
  });
});

describe("parseMultiChoice", () => {
  it("passes through string arrays", () => {
    expect(parseMultiChoice(["A", "B"])).toEqual(["A", "B"]);
  });

  it("splits legacy ;#-delimited strings", () => {
    expect(parseMultiChoice(";#AOI;#X-RAY;#")).toEqual(["AOI", "X-RAY"]);
  });

  it("returns [] for null/empty/non-string shapes", () => {
    expect(parseMultiChoice(null)).toEqual([]);
    expect(parseMultiChoice("")).toEqual([]);
    expect(parseMultiChoice(42)).toEqual([]);
  });
});

describe("attachBuildRequestReferences", () => {
  it("fills blank project titles and resolves name-less people", () => {
    const brs = [
      toBuildRequest(
        makeItem({
          ProjectReference: [243],
          RequestorLookupId: 37,
        }),
      ),
    ];
    const projects: ProjectReference[] = [{ lookupId: 243, title: "2001-Altronic III" }];
    const usersById = new Map<number, Person>([
      [37, { lookupId: 37, displayName: "Amanda Hoagland", email: "amanda.hoagland@altronic-llc.com" }],
    ]);

    attachBuildRequestReferences(brs, projects, usersById);

    expect(brs[0].parentProjects[0]).toEqual({ lookupId: 243, title: "2001-Altronic III" });
    expect(brs[0].requestor?.displayName).toBe("Amanda Hoagland");
  });

  it("leaves already-resolved values untouched", () => {
    const brs = [
      toBuildRequest(
        makeItem({
          ProjectReference: [{ LookupId: 304, LookupValue: "343-MT-Detechtion Hub V4" }],
        }),
      ),
    ];
    attachBuildRequestReferences(brs, [], new Map());
    expect(brs[0].parentProjects[0].title).toBe("343-MT-Detechtion Hub V4");
  });
});
