import { describe, it, expect } from "vitest";
import type { Fait, GraphListItem } from "@/types/task";
import {
  attachFaitPeople,
  buildFaitCreateFields,
  compareFaits,
  faitFieldPatch,
  faitLabel,
  faitProjectPatch,
  personOrLookup,
  readLookupId,
  toFait,
} from "./faitMapper";
import { FAIT_FIELDS, FAIT_SELECT, isFaitOpen } from "./faitFields";

// Column names and stored shapes come from the live list —
// scripts/fait-schema.json, captured 2026-08-20.

function item(fields: Record<string, unknown>, id = "1"): GraphListItem {
  return { id, fields } as unknown as GraphListItem;
}

function fait(over: Partial<Fait> = {}): Fait {
  return {
    id: 1,
    title: "",
    status: "Open",
    parentProject: null,
    eirLookupId: null,
    testDocumentLookupId: null,
    initiator: null,
    assignedEngineer: null,
    kam: null,
    watchers: [],
    comments: [],
    hasAttachments: false,
    values: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    modifiedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

describe("toFait", () => {
  it("reads the part fields", () => {
    const f = toFait(
      item({
        SAPPartNumber: " 1000-9542-00 ",
        Description: "FLANGE, ALUM 6013",
        DrawingNumber: "720-0010",
        SupplierName: "PR MACHINE",
        Status: "Open",
      }),
    );
    expect(f.values.sapPartNumber).toBe("1000-9542-00");
    expect(f.values.description).toBe("FLANGE, ALUM 6013");
    expect(f.status).toBe("Open");
  });

  // Nineteen real boolean columns, carried as "Yes" / "" so the record stays
  // one string-keyed shape.
  it("carries booleans as Yes / empty", () => {
    const f = toFait(item({ NewPart: true, OEMImpact: false }));
    expect(f.values.newPart).toBe("Yes");
    expect(f.values.oemImpact).toBe("");
  });

  it("treats a missing boolean as not set", () => {
    expect(toFait(item({})).values.newPart).toBe("");
  });

  it("reads the three lookups as ids", () => {
    const f = toFait(
      item({
        ProjectReferenceLookupId: "501",
        EIR_x0020_ReferenceLookupId: 12,
        TestDocumentReferenceLookupId: "7",
      }),
    );
    expect(f.parentProject).toEqual({ lookupId: 501, title: "" });
    expect(f.eirLookupId).toBe(12);
    expect(f.testDocumentLookupId).toBe(7);
  });

  it("leaves the lookups null when unset", () => {
    const f = toFait(item({}));
    expect(f.parentProject).toBeNull();
    expect(f.eirLookupId).toBeNull();
    expect(f.testDocumentLookupId).toBeNull();
  });

  // The list's date-only columns need the midday pivot, same as every other
  // date-only column in ARC.
  it("reads a date-only column as the day the list shows", () => {
    const f = toFait(item({ FailedFirstPassDate: "2026-03-05T23:00:00Z" }));
    expect(new Date(f.values.failedFirstPassDate).getUTCDate()).toBe(6);
  });

  it("selects every descriptor column plus the named ones", () => {
    for (const c of ["Title", "Status", "Communication", "Watchers", "Attachments"]) {
      expect(FAIT_SELECT).toContain(c);
    }
    for (const f of FAIT_FIELDS) expect(FAIT_SELECT).toContain(f.column);
  });
});

describe("readLookupId", () => {
  it("takes a number or a string", () => {
    expect(readLookupId(7)).toBe(7);
    expect(readLookupId("7")).toBe(7);
  });

  it("is null for anything that isn't a positive id", () => {
    for (const v of [null, undefined, "", 0, -1, "abc"]) {
      expect(readLookupId(v)).toBeNull();
    }
  });
});

describe("buildFaitCreateFields", () => {
  it("omits blank text but always sends the booleans", () => {
    const fields = buildFaitCreateFields({
      title: "",
      status: "Open",
      projectLookupId: null,
      values: { sapPartNumber: "1000", description: "" },
    });
    expect(fields.SAPPartNumber).toBe("1000");
    expect(fields).not.toHaveProperty("Description");
    // "No" is a real answer to "New Part"; a null reads as blank in the
    // SharePoint views rather than No.
    expect(fields.NewPart).toBe(false);
  });

  it("writes the project as a bare lookupId", () => {
    const fields = buildFaitCreateFields({
      title: "",
      status: "Open",
      projectLookupId: 501,
      values: {},
    });
    expect(fields.ProjectReferenceLookupId).toBe(501);
  });

  it("leaves the project out when there isn't one", () => {
    const fields = buildFaitCreateFields({
      title: "",
      status: "Open",
      projectLookupId: null,
      values: {},
    });
    expect(fields).not.toHaveProperty("ProjectReferenceLookupId");
  });
});

describe("faitFieldPatch", () => {
  it("patches a text column", () => {
    expect(faitFieldPatch("supplierName", " PR MACHINE ")).toEqual({
      SupplierName: "PR MACHINE",
    });
  });

  it("turns a boolean field back into a boolean", () => {
    expect(faitFieldPatch("newPart", "Yes")).toEqual({ NewPart: true });
    expect(faitFieldPatch("newPart", "")).toEqual({ NewPart: false });
  });

  it("writes a date at midday UTC, and null when cleared", () => {
    const patch = faitFieldPatch("waivedDate", "2026-03-05");
    expect(String(patch.WaivedDate)).toContain("T12:00:00");
    expect(faitFieldPatch("waivedDate", "")).toEqual({ WaivedDate: null });
  });

  it("refuses a key that isn't a field", () => {
    expect(() => faitFieldPatch("nope", "x")).toThrow(/Unknown FAIT field/);
  });
});

describe("faitProjectPatch", () => {
  it("writes a bare integer, null to clear", () => {
    expect(faitProjectPatch(501)).toEqual({ ProjectReferenceLookupId: 501 });
    expect(faitProjectPatch(null)).toEqual({ ProjectReferenceLookupId: null });
  });
});

describe("faitLabel", () => {
  // Title is empty on every row the live list holds, so the part number is
  // what people identify a FAIT by.
  it("leads with the part number and description", () => {
    expect(
      faitLabel(fait({ values: { sapPartNumber: "1000", description: "FLANGE" } })),
    ).toBe("1000 — FLANGE");
  });

  it("falls back through description to the id", () => {
    expect(faitLabel(fait({ values: { description: "FLANGE" } }))).toBe("FLANGE");
    expect(faitLabel(fait({ id: 9, values: {} }))).toBe("FAIT #9");
  });

  it("uses Title if someone ever fills it in", () => {
    expect(faitLabel(fait({ title: "Named one", values: {} }))).toBe("Named one");
  });
});

describe("isFaitOpen", () => {
  it("is true for anything that isn't Closed", () => {
    expect(isFaitOpen("Open")).toBe(true);
    expect(isFaitOpen("This is with SQE")).toBe(true);
    expect(isFaitOpen("")).toBe(true);
    expect(isFaitOpen("Closed")).toBe(false);
    expect(isFaitOpen("closed")).toBe(false);
  });
});

describe("compareFaits", () => {
  it("sorts newest first", () => {
    const older = fait({ id: 1, createdAt: new Date("2026-01-01T00:00:00Z") });
    const newer = fait({ id: 2, createdAt: new Date("2026-06-01T00:00:00Z") });
    expect([older, newer].sort(compareFaits).map((f) => f.id)).toEqual([2, 1]);
  });
});

// =============================================================================
// The single-person columns — Initiator, Assigned Engineer, KAM.
//
// Graph hands these back as a bare `<Name>LookupId`, not the expanded
// `{ LookupId, LookupValue, Email }` object the friendly-name $select is meant
// to produce. Reading only the expanded shape is what made all three read as
// nobody on every FAIT, whatever SharePoint actually held (2026-08-27).
// =============================================================================

describe("personOrLookup", () => {
  it("prefers the expanded object when Graph sends one", () => {
    expect(
      personOrLookup({ LookupId: 46, LookupValue: "Sarah Shaffer", Email: "s@x.com" }, 46),
    ).toEqual({ displayName: "Sarah Shaffer", email: "s@x.com", lookupId: 46 });
  });

  it("falls back to the bare lookupId, nameless for now", () => {
    expect(personOrLookup(undefined, 46)).toEqual({ displayName: "", lookupId: 46 });
  });

  it("is nobody when neither shape carries anything", () => {
    expect(personOrLookup(undefined, undefined)).toBeNull();
    expect(personOrLookup(null, 0)).toBeNull();
    expect(personOrLookup(null, "")).toBeNull();
  });
});

describe("attachFaitPeople", () => {
  const directory = new Map([
    [22, { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 }],
    [46, { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com", lookupId: 46 }],
  ]);

  function bare() {
    return toFait(
      item({
        InitiatorLookupId: 22,
        AssignedEngineerLookupId: 46,
        KAMLookupId: 99,
        Watchers: [{ LookupId: 22, LookupValue: "Ray White" }],
      }),
    );
  }

  it("names the people it can", () => {
    const f = bare();
    attachFaitPeople([f], directory);
    expect(f.initiator?.displayName).toBe("Ray White");
    expect(f.assignedEngineer?.displayName).toBe("Sarah Shaffer");
  });

  it("marks an id nobody answers for, rather than blanking it", () => {
    // A person column that IS set must never render as "Not set": the next
    // person to touch the FAIT would overwrite an assignment without knowing
    // it was there.
    const f = bare();
    attachFaitPeople([f], directory);
    expect(f.kam).toEqual({ displayName: "User #99", lookupId: 99 });
  });

  it("leaves a name Graph already sent alone", () => {
    const f = bare();
    attachFaitPeople([f], new Map());
    expect(f.watchers[0].displayName).toBe("Ray White");
  });

  it("does nothing to a FAIT with nobody on it", () => {
    const f = toFait(item({ Status: "Open" }));
    attachFaitPeople([f], directory);
    expect([f.initiator, f.assignedEngineer, f.kam]).toEqual([null, null, null]);
    expect(f.watchers).toEqual([]);
  });
});
