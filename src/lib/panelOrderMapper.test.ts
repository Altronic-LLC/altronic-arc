import { describe, it, expect } from "vitest";
import { attachPanelReferences, panelProjectRef, toPanelOrder } from "./panelOrderMapper";
import type { GraphListItem, PanelProject, Person } from "@/types/task";

// Modeled on the real sample item pulled from the Panel Order Headers list.
function graphItem(fields: Record<string, unknown>): GraphListItem {
  return {
    id: (fields.id as string) ?? "1",
    createdDateTime: "2026-07-17T18:01:12Z",
    lastModifiedDateTime: "2026-07-17T18:01:12Z",
    createdBy: { user: { displayName: "Ray White", email: "ray.white@altronic-llc.com" } },
    fields: fields as GraphListItem["fields"],
  };
}

describe("toPanelOrder", () => {
  it("maps the real sample item shape, falling back to bare LookupIds", () => {
    const order = toPanelOrder(
      graphItem({
        id: "1",
        Title: "Archrock skid panel build",
        Status: "In Production",
        ProjectReferenceLookupId: "3",
        SalesOrder: "12345678910",
        PurchaseOrder: "987654321A",
        CustomerReference: "Odessa Field Unit b100",
        Customer: "Archrock",
        CustomerContactEmail: "bob@testemail.com",
        OrderNotes: "Test order notes they want these ASAP",
        EngineerAssignedLookupId: "36",
        Attachments: false,
      }),
    );
    expect(order.id).toBe(1);
    expect(order.title).toBe("Archrock skid panel build");
    expect(order.status).toBe("In Production");
    // Single lookup + single person come back as bare ids — empty titles/names survive.
    expect(order.projectRef).toEqual({ lookupId: 3, title: "" });
    expect(order.engineerAssigned).toEqual({ lookupId: 36, displayName: "" });
    expect(order.salesOrder).toBe("12345678910");
    expect(order.customer).toBe("Archrock");
    expect(order.author?.displayName).toBe("Ray White");
    expect(order.comments).toEqual([]);
    expect(order.hasAttachments).toBe(false);
  });

  it("clamps unknown statuses (incl. the placeholder choices) to Submitted", () => {
    expect(toPanelOrder(graphItem({ Status: "Choice 2" })).status).toBe("Submitted");
    expect(toPanelOrder(graphItem({})).status).toBe("Submitted");
  });

  it("parses a resolved single-person EngineerAssigned when Graph provides one", () => {
    const order = toPanelOrder(
      graphItem({
        EngineerAssigned: { LookupId: 46, LookupValue: "Sarah Shaffer", Email: "s@x.com" },
      }),
    );
    expect(order.engineerAssigned).toEqual({
      lookupId: 46,
      displayName: "Sarah Shaffer",
      email: "s@x.com",
    });
  });

  it("parses watchers and the Communication thread", () => {
    const order = toPanelOrder(
      graphItem({
        Watchers: [{ LookupId: 36, LookupValue: "Ray White", Email: "r@x.com" }],
        Communication:
          "7/10/2026 9:00:00 AM|||Ray White|||ray.white@altronic-llc.com|||<p>hello</p>",
      }),
    );
    expect(order.watchers).toHaveLength(1);
    expect(order.comments).toHaveLength(1);
    expect(order.comments[0].bodyHtml).toContain("hello");
  });
});

describe("attachPanelReferences", () => {
  const PROJECTS: PanelProject[] = [
    {
      id: 3,
      title: "P-0003",
      projectType: null,
      description: "Odessa retrofit",
      dwgNo: "",
      customer: "Kodiak Gas",
      department: null,
    },
  ];
  const USERS = new Map<number, Person>([
    [36, { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 36 }],
  ]);

  it("fills empty project titles and engineer names from the directories", () => {
    const order = toPanelOrder(
      graphItem({ ProjectReferenceLookupId: "3", EngineerAssignedLookupId: "36" }),
    );
    attachPanelReferences([order], PROJECTS, USERS);
    expect(order.projectRef?.title).toBe("P-0003");
    expect(order.engineerAssigned?.displayName).toBe("Ray White");
  });

  it("leaves unresolvable ids alone (no crash, name stays blank)", () => {
    const order = toPanelOrder(
      graphItem({ ProjectReferenceLookupId: "99", EngineerAssignedLookupId: "77" }),
    );
    attachPanelReferences([order], PROJECTS, USERS);
    expect(order.projectRef).toEqual({ lookupId: 99, title: "" });
    expect(order.engineerAssigned).toEqual({ lookupId: 77, displayName: "" });
  });
});

describe("panelProjectRef", () => {
  it("converts a PanelProject to the picker ProjectReference shape", () => {
    expect(
      panelProjectRef({
        id: 2,
        title: "P-0002",
        projectType: null,
        description: "Proto",
        dwgNo: "",
        customer: "",
        department: null,
      }),
    ).toEqual({ lookupId: 2, title: "P-0002", description: "Proto" });
  });
});
