import { describe, expect, it } from "vitest";
import type { GraphListItem, Scn, ScnInput } from "@/types/task";
import {
  applyScnPatch,
  buildScnCreateFields,
  buildScnUpdateFields,
  compareScns,
  parseScnLink,
  scnLabel,
  scnValue,
  toScn,
} from "./scnMapper";
// =============================================================================
// Graph item → Scn, and back — against a sample row TRANSCRIBED from the live
// schema snapshot (scripts/scn-dashboard-schema.json, 2026-10-07), so the
// field names being read are the ones SharePoint actually sends. Inlined
// rather than imported: that snapshot is gitignored, and an import would fail
// the deploy for everyone but the machine that ran discovery.
// =============================================================================

function item(fields: Record<string, unknown>, extra: Partial<GraphListItem> = {}): GraphListItem {
  return {
    id: "42",
    createdDateTime: "2026-09-30T14:02:00Z",
    lastModifiedDateTime: "2026-10-05T09:15:00Z",
    createdBy: { user: { displayName: "Ray White", email: "ray.white@altronic-llc.com" } },
    fields,
    ...extra,
  } as GraphListItem;
}

/** The live sample row for 2020-004 — Notes as a dated log, two checks ticked. */
const LIVE: Record<string, unknown> = {
  AuthorLookupId: "16",
  Progress: "DL500 product line",
  ProjectStatus: ["Immediate Phase Complete", "Analysis Phase Complete"],
  Title: "2020-004",
  AssignedTo: [
    { LookupValue: "Michael Colaneri", Email: "Michael.Colaneri@altronic-llc.com", LookupId: 162 },
  ],
  LinkTitleNoMenu: "2020-004",
  Priority: "OBS",
  YEAR: "2020",
  Notes:
    "2/11/22 Ready for single use review. \n3/30/22 Single Use Review done. Inventory Management plan in approval w DL and DH\n4/13/22 Scrap approval received, however we will be approaching CSI with a final liquidation offer.\n4/20/22 DB wants to extend this offer to the end of April\n05/25/22- LTB Denied Okay to Scrap\n7/20/22- Waiting on Material Movement",
  LinkTitle: "2020-004",
  ApprovalStatus: "Approved",
  Owner: [{ LookupValue: "Ray White", Email: "Ray.White@altronic-llc.com", LookupId: 16 }],
  ContentType: "Item",
  Description: "This product is being discontinued by the customer",
  Created: "2022-02-11T19:52:16Z",
  Modified: "2024-06-13T00:35:35Z",
  Attachments: false,
  SCNStatus: "CLOSED",
  EditorLookupId: "16",
  id: "4",
};

describe("toScn", () => {
  it("reads the columns whose names lie under their real meaning", () => {
    const scn = toScn(item(LIVE));
    expect(scn.scnNumber).toBe("2020-004");
    expect(scn.year).toBe("2020");
    expect(scn.product).toBe("DL500 product line"); // `Progress`
    expect(scn.category).toBe("OBS"); // `Priority`
    expect(scn.status).toBe("CLOSED");
    expect(scn.approvalStatus).toBe("Approved");
    expect(scn.values.description).toBe("This product is being discontinued by the customer");
    expect(scn.values.notes).toContain("LTB Denied Okay to Scrap");
  });

  it("does NOT clamp status or category — a blank Category stays blank", () => {
    const scn = toScn(item({ ...LIVE, Priority: undefined, SCNStatus: "Something New" }));
    expect(scn.category).toBe("");
    expect(scn.status).toBe("Something New");
  });

  it("expands the three multi-person columns", () => {
    const scn = toScn(item({ ...LIVE, Watchers: LIVE.Owner }));
    expect(scn.assignedTo.map((p) => p.displayName)).toEqual(["Michael Colaneri"]);
    expect(scn.assignedTo[0].lookupId).toBe(162);
    expect(scn.assignedTo[0].email).toBe("Michael.Colaneri@altronic-llc.com");
    expect(scn.owner.map((p) => p.displayName)).toEqual(["Ray White"]);
    expect(scn.watchers.map((p) => p.displayName)).toEqual(["Ray White"]);
  });

  it("reads the multi-choice checklists as arrays, and a missing one as empty", () => {
    const scn = toScn(item(LIVE));
    expect(scn.checks.projectStatus).toEqual(["Immediate Phase Complete", "Analysis Phase Complete"]);
    expect(scn.checks.preliminaryReviews).toEqual([]);
    expect(scn.checks.secondaryReview).toEqual([]);
  });

  it("reads the date-only columns through the midday pivot", () => {
    // Stored 22:00Z / 23:00Z = local midnight the NEXT day in the site's zone.
    const scn = toScn(
      item({ ...LIVE, EOLExpires: "2027-06-29T22:00:00Z", LTBExpires: "2026-12-30T23:00:00Z" }),
    );
    expect(scn.dates.ltsExpires?.toISOString()).toBe("2027-06-30T12:00:00.000Z");
    expect(scn.dates.ltbExpires?.toISOString()).toBe("2026-12-31T12:00:00.000Z");
    expect(scn.dates.fixtureReview).toBeNull();
  });

  it("reads the Task List hyperlink as { url, description }", () => {
    const scn = toScn(
      item({ ...LIVE, Task_x0020_List: { Url: "https://tasks.office.com/x", Description: "Plan" } }),
    );
    expect(scn.taskList).toEqual({ url: "https://tasks.office.com/x", description: "Plan" });
    expect(toScn(item(LIVE)).taskList).toBeNull();
  });

  it("takes Raised by and the timestamps from the ITEM, not a column", () => {
    const scn = toScn(item(LIVE));
    expect(scn.createdBy).toEqual({ displayName: "Ray White", email: "ray.white@altronic-llc.com" });
    expect(scn.createdAt.toISOString()).toBe("2026-09-30T14:02:00.000Z");
    expect(scn.modifiedAt.toISOString()).toBe("2026-10-05T09:15:00.000Z");
  });

  it("falls back to the Created / Modified columns when the item carries none", () => {
    const scn = toScn(
      item(LIVE, {
        createdDateTime: undefined as unknown as string,
        lastModifiedDateTime: undefined as unknown as string,
        createdBy: undefined,
      }),
    );
    expect(scn.createdBy).toBeNull();
    expect(scn.createdAt.toISOString()).toBe("2022-02-11T19:52:16.000Z");
  });

  it("reads Attachments as a boolean", () => {
    expect(toScn(item({ ...LIVE, Attachments: true })).hasAttachments).toBe(true);
    expect(toScn(item(LIVE)).hasAttachments).toBe(false);
  });

  it("parses the communication thread", () => {
    const scn = toScn(
      item({
        ...LIVE,
        Communication: "10/01/2026 09:00:00 AM|||Ray White|||ray.white@altronic-llc.com|||<p>Hi</p>",
      }),
    );
    expect(scn.comments).toHaveLength(1);
    expect(scn.comments[0].bodyHtml).toBe("<p>Hi</p>");
  });
});

describe("parseScnLink", () => {
  it("is null for an empty or url-less value", () => {
    expect(parseScnLink(null)).toBeNull();
    expect(parseScnLink({ Description: "x" })).toBeNull();
    expect(parseScnLink("https://x")).toBeNull();
  });

  it("uses the url as the description when none is given", () => {
    expect(parseScnLink({ Url: "https://x" })).toEqual({ url: "https://x", description: "https://x" });
  });
});

const input: ScnInput = {
  product: " DD-40NTS ",
  category: "OBS",
  approvalStatus: "Approved",
  assignedTo: [],
  owner: [],
  values: { description: "EOL at the supplier", customer: "", oldNumber: "791080-1\n791080-2" },
};

describe("buildScnCreateFields", () => {
  it("writes Title, YEAR, the status pair and the filled-in text columns under their REAL names", () => {
    const fields = buildScnCreateFields(input, "2026-0149");
    expect(fields).toEqual({
      Title: "2026-0149",
      YEAR: "2026",
      SCNStatus: "WIP",
      ApprovalStatus: "Approved",
      Progress: "DD-40NTS",
      Priority: "OBS",
      Description: "EOL at the supplier",
      PartsEffected: "791080-1\n791080-2",
    });
  });

  it("defaults Status to WIP only when blank", () => {
    expect(buildScnCreateFields({ ...input, status: "On Hold" }, "2026-0149").SCNStatus).toBe("On Hold");
    expect(buildScnCreateFields({ ...input, status: "  " }, "2026-0149").SCNStatus).toBe("WIP");
  });

  it("omits a blank Category rather than sending an empty string", () => {
    expect(buildScnCreateFields({ ...input, category: "" }, "2026-0149")).not.toHaveProperty("Priority");
  });

  it("never carries Task_x0020_List, Communication, a person column or a checklist", () => {
    const fields = buildScnCreateFields(
      { ...input, values: { ...input.values, taskList: "https://x", projectStatus: "x" } },
      "2026-0149",
    );
    for (const never of ["Task_x0020_List", "Communication", "AssignedTo", "Owner", "Watchers", "ProjectStatus"]) {
      expect(fields).not.toHaveProperty(never);
    }
  });
});

function scn(over: Partial<Scn> = {}): Scn {
  return {
    id: 7,
    scnNumber: "2026-0140",
    year: "2026",
    product: "CD200EVS",
    category: "OBS",
    status: "WIP",
    approvalStatus: "Approved",
    assignedTo: [],
    owner: [],
    watchers: [],
    comments: [],
    hasAttachments: false,
    values: { description: "Old text", notes: "", customer: "ACME" },
    checks: { projectStatus: ["Immediate Phase Complete"], preliminaryReviews: [], secondaryReview: [] },
    dates: { ltsExpires: new Date("2027-06-30T12:00:00Z"), ltbExpires: null, fixtureReview: null },
    taskList: null,
    createdBy: null,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
    ...over,
  };
}

describe("buildScnUpdateFields", () => {
  it("sends ONLY the columns that changed", () => {
    const fields = buildScnUpdateFields(
      { description: "New text", customer: "ACME", status: "WIP", notes: "" },
      scn(),
    );
    expect(fields).toEqual({ Description: "New text" });
  });

  it("writes a named string under its real column", () => {
    expect(buildScnUpdateFields({ product: "DD-40", status: "CLOSED" }, scn())).toEqual({
      Progress: "DD-40",
      SCNStatus: "CLOSED",
    });
  });

  it("writes a checklist as a PLAIN array (the annotation is the API's job) and a clear as []", () => {
    expect(buildScnUpdateFields({ projectStatus: ["Immediate Phase Complete", "Analysis Phase Complete"] }, scn())).toEqual({
      ProjectStatus: ["Immediate Phase Complete", "Analysis Phase Complete"],
    });
    expect(buildScnUpdateFields({ projectStatus: [] }, scn())).toEqual({ ProjectStatus: [] });
    // Same contents → nothing to send.
    expect(buildScnUpdateFields({ projectStatus: ["Immediate Phase Complete"] }, scn())).toEqual({});
  });

  it("writes a date at midday UTC and a clear as null", () => {
    expect(buildScnUpdateFields({ ltbExpires: new Date("2026-12-31T12:00:00Z") }, scn())).toEqual({
      LTBExpires: "2026-12-31T12:00:00Z",
    });
    expect(buildScnUpdateFields({ ltsExpires: null }, scn())).toEqual({ EOLExpires: null });
    // The same day again is not a change.
    expect(buildScnUpdateFields({ ltsExpires: new Date("2027-06-30T12:00:00Z") }, scn())).toEqual({});
  });

  it("never writes Title — the SCN# is not a field", () => {
    expect(() => buildScnUpdateFields({ scnNumber: "2026-9999" }, scn())).toThrow(/Unknown SCN field/);
  });

  it("refuses the read-only Task List and the person columns", () => {
    expect(() => buildScnUpdateFields({ taskList: "https://x" }, scn())).toThrow(/read-only/);
    expect(() => buildScnUpdateFields({ assignedTo: "x" }, scn())).toThrow(/person column/);
  });
});

describe("applyScnPatch", () => {
  it("returns the row as it will read after the patch, without touching the original", () => {
    const before = scn();
    const after = applyScnPatch(before, {
      status: "CLOSED",
      description: "New",
      projectStatus: [],
      ltbExpires: new Date("2026-12-31T12:00:00Z"),
    });
    expect(after.status).toBe("CLOSED");
    expect(after.values.description).toBe("New");
    expect(after.checks.projectStatus).toEqual([]);
    expect(after.dates.ltbExpires?.toISOString()).toBe("2026-12-31T12:00:00.000Z");
    expect(before.status).toBe("WIP");
    expect(before.checks.projectStatus).toEqual(["Immediate Phase Complete"]);
  });
});

describe("scnValue", () => {
  it("reads whichever slot a key lives in", () => {
    const s = scn();
    expect(scnValue(s, "product")).toBe("CD200EVS");
    expect(scnValue(s, "customer")).toBe("ACME");
    expect(scnValue(s, "projectStatus")).toEqual(["Immediate Phase Complete"]);
    expect(scnValue(s, "ltbExpires")).toBeNull();
    expect(scnValue(s, "taskList")).toBeNull();
  });

  it("refuses an unknown key and a person column", () => {
    expect(() => scnValue(scn(), "nope")).toThrow(/Unknown/);
    expect(() => scnValue(scn(), "owner")).toThrow(/person/);
  });
});

describe("compareScns / scnLabel", () => {
  it("sorts newest SCN# first, then by id", () => {
    const rows = [scn({ id: 1, scnNumber: "2025-0100" }), scn({ id: 2, scnNumber: "2026-0148" }), scn({ id: 3, scnNumber: "2026-0148" })];
    expect([...rows].sort(compareScns).map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it("labels an SCN by number and product", () => {
    expect(scnLabel(scn())).toBe("2026-0140 — CD200EVS");
    expect(scnLabel(scn({ product: "" }))).toBe("2026-0140");
    expect(scnLabel(scn({ scnNumber: "", product: "" }))).toBe("SCN #7");
  });
});
