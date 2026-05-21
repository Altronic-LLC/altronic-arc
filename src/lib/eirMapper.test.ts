import { describe, it, expect } from "vitest";
import { attachEirReferences, toEir } from "./eirMapper";
import type { Eir, GraphListItem, ProjectReference } from "@/types/task";

function item(over: Partial<GraphListItem> = {}): GraphListItem {
  return {
    id: "1",
    createdDateTime: "2026-05-10T00:00:00Z",
    lastModifiedDateTime: "2026-05-11T00:00:00Z",
    fields: {},
    ...over,
  };
}

describe("toEir — basic mapping", () => {
  it("parses id and falls back to '(untitled EIR)'", () => {
    const e = toEir(item({ id: "42" }));
    expect(e.id).toBe(42);
    expect(e.title).toBe("(untitled EIR)");
  });

  it("maps text fields", () => {
    const e = toEir(
      item({
        fields: {
          Title: "Replace coil",
          EIRNo: "EIR-2026-0042",
          Description: "Need a replacement",
          WhereUsed: "Driver board",
          MFG: "Murata",
          MFGP_x002f_N: "LQH3NPN221MGRL",
          Current_x0020_Price: "$1.84",
          Altronic_x0020_Part_x0020_Number: "C-450-220",
          EAU: "350",
          CurrentStock: "42",
          BuyerCode: "002 - Adele Riffle",
          TaskReference: "T115",
          EngineeringResponse: "Approved",
        },
      }),
    );
    expect(e.title).toBe("Replace coil");
    expect(e.eirNo).toBe("EIR-2026-0042");
    expect(e.description).toBe("Need a replacement");
    expect(e.whereUsed).toBe("Driver board");
    expect(e.mfg).toBe("Murata");
    expect(e.mfgPartNumber).toBe("LQH3NPN221MGRL");
    expect(e.currentPrice).toBe("$1.84");
    expect(e.altronicPartNumber).toBe("C-450-220");
    expect(e.eau).toBe("350");
    expect(e.currentStock).toBe("42");
    expect(e.buyerCode).toBe("002 - Adele Riffle");
    expect(e.taskReference).toBe("T115");
    expect(e.engineeringResponse).toBe("Approved");
  });
});

describe("toEir — choice fields clamp to allowed values", () => {
  it("Status falls back to 'Under Review' when unknown", () => {
    expect(toEir(item({ fields: { Status: "Frogs" } })).status).toBe("Under Review");
    expect(toEir(item({ fields: { Status: "Closed" } })).status).toBe("Closed");
  });

  it("Resolution falls back to 'Pending' when unknown", () => {
    expect(toEir(item({ fields: { Resolution: "???" } })).resolution).toBe("Pending");
    expect(toEir(item({ fields: { Resolution: "Resolved" } })).resolution).toBe("Resolved");
  });

  it("RequestType returns null for unknown values", () => {
    expect(toEir(item({ fields: { RequestType: "weird" } })).requestType).toBeNull();
    expect(toEir(item({ fields: { RequestType: "ECR" } })).requestType).toBe("ECR");
  });

  it("Requested priority (Priority choice column) returns null for unknown", () => {
    expect(toEir(item({ fields: { Priority: "URGENT!" } })).requestedPriority).toBeNull();
    expect(toEir(item({ fields: { Priority: "High" } })).requestedPriority).toBe("High");
  });
});

describe("toEir — dates", () => {
  it("parses Requested Completion Date from the truncated internal name", () => {
    const e = toEir(item({ fields: { Requested_x0020_Completion_x0020: "2026-06-15" } }));
    expect(e.requestedCompletionDate).toBeInstanceOf(Date);
    expect(e.requestedCompletionDate?.toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  it("returns null when dates are absent", () => {
    const e = toEir(item());
    expect(e.requestedCompletionDate).toBeNull();
    expect(e.ltbDate).toBeNull();
    expect(e.priorityDate).toBeNull();
  });
});

describe("toEir — people", () => {
  it("Reporter (single person) — expanded object shape", () => {
    const e = toEir(
      item({
        fields: {
          Reporter: { LookupId: 46, LookupValue: "Sarah Shaffer", Email: "sarah@x.com" },
        },
      }),
    );
    expect(e.reporter).toEqual({
      displayName: "Sarah Shaffer",
      email: "sarah@x.com",
      lookupId: 46,
    });
  });

  it("Reporter (single person) — bare ReporterLookupId fallback", () => {
    // When Graph doesn't expand the Reporter column we only see the
    // suffixed integer; the mapper should still emit a Person with a
    // placeholder displayName so attachEirReferences can swap it later.
    const e = toEir(item({ fields: { ReporterLookupId: 88 } }));
    expect(e.reporter).toEqual({
      displayName: "User #88",
      lookupId: 88,
    });
  });

  it("Reporter — attachEirReferences resolves placeholder name from siblings", () => {
    const expanded = toEir(
      item({
        fields: {
          Reporter: { LookupId: 88, LookupValue: "Sarah Shaffer", Email: "sarah@x.com" },
        },
      }),
    );
    const placeholder = toEir(item({ fields: { ReporterLookupId: 88 } }));
    attachEirReferences([expanded, placeholder], []);
    expect(placeholder.reporter?.displayName).toBe("Sarah Shaffer");
    expect(placeholder.reporter?.email).toBe("sarah@x.com");
  });

  it("Assigned Engineers (multi person)", () => {
    const e = toEir(
      item({
        fields: {
          AssignedEngineer: [
            { LookupId: 1, LookupValue: "Ray", Email: "ray@x.com" },
            { LookupId: 2, LookupValue: "Thomas", Email: "thomas@x.com" },
          ],
        },
      }),
    );
    expect(e.assignedEngineers).toHaveLength(2);
    expect(e.assignedEngineers[0].displayName).toBe("Ray");
    expect(e.assignedEngineers[1].displayName).toBe("Thomas");
  });

  it("Watchers handle empty / null gracefully", () => {
    expect(toEir(item()).watchers).toEqual([]);
    expect(toEir(item({ fields: { Watchers: null } })).watchers).toEqual([]);
  });
});

describe("toEir — project reference (multi-choice column) + bool fields", () => {
  it("reads a single-string choice as the project title", () => {
    const e = toEir(
      item({
        fields: {
          ProjectReference: "2026-Cat Pyrometer, 133-6333",
          TaskPromotedFlag: true,
          Attachments: true,
        },
      }),
    );
    expect(e.parentProject).toEqual({
      lookupId: 0,
      title: "2026-Cat Pyrometer, 133-6333",
    });
    expect(e.taskPromotedFlag).toBe(true);
    expect(e.hasAttachments).toBe(true);
  });

  it("reads a string-array of choices and joins them", () => {
    const e = toEir(
      item({
        fields: {
          ProjectReference: ["2026-Cat Pyrometer, 133-6333", "0017-AMP-5000"],
        },
      }),
    );
    expect(e.parentProject?.title).toBe(
      "2026-Cat Pyrometer, 133-6333, 0017-AMP-5000",
    );
  });

  it("decodes the legacy ';#'-delimited multi-choice encoding", () => {
    const e = toEir(
      item({
        fields: {
          ProjectReference: ";#2026-Cat Pyrometer, 133-6333;#0017-AMP-5000;#",
        },
      }),
    );
    expect(e.parentProject?.title).toBe(
      "2026-Cat Pyrometer, 133-6333, 0017-AMP-5000",
    );
  });

  it("still handles legacy provisioning where the column is a real Lookup id", () => {
    const e = toEir(item({ fields: { ProjectReferenceLookupId: 501 } }));
    expect(e.parentProject?.lookupId).toBe(501);
  });

  it("reads an array of {LookupId, LookupValue} objects (lookup-multi shape)", () => {
    const e = toEir(
      item({
        fields: {
          ProjectReference: [
            { LookupId: 412, LookupValue: "2026-Cat Pyrometer, 133-6333" },
            { LookupId: 501, LookupValue: "0017-AMP-5000" },
          ],
        },
      }),
    );
    expect(e.parentProject?.title).toBe(
      "2026-Cat Pyrometer, 133-6333, 0017-AMP-5000",
    );
  });

  it("reads an array of {Label, TermGuid} objects (managed-metadata shape)", () => {
    const e = toEir(
      item({
        fields: {
          ProjectReference: [
            { Label: "2026-Cat Pyrometer, 133-6333", TermGuid: "x", WssId: 7 },
          ],
        },
      }),
    );
    expect(e.parentProject?.title).toBe("2026-Cat Pyrometer, 133-6333");
  });

  it("reads a single {LookupValue} object (single-value lookup shape)", () => {
    const e = toEir(
      item({
        fields: {
          ProjectReference: { LookupId: 522, LookupValue: "0021-CleanBurn Telemetry" },
        },
      }),
    );
    expect(e.parentProject?.title).toBe("0021-CleanBurn Telemetry");
  });

  it("returns null when ProjectReference is empty / missing", () => {
    expect(toEir(item({ fields: { Title: "no project" } })).parentProject).toBeNull();
    expect(toEir(item({ fields: { ProjectReference: "" } })).parentProject).toBeNull();
    expect(toEir(item({ fields: { ProjectReference: [] } })).parentProject).toBeNull();
  });
});

describe("toEir — task reference (Power Apps URL handling)", () => {
  it("captures a Power Apps URL with ItemID in TaskReference verbatim", () => {
    // The mapper itself doesn't unwrap the URL — extractItemIdFromUrl
    // does that in the detail view at display time. Verify the field is
    // preserved so the consumer can parse it.
    const url =
      "https://apps.powerapps.com/play/e/x/a/y?tenantId=z&hint=w&sourcetime=123&ItemID=2755";
    const e = toEir(item({ fields: { TaskReference: url } }));
    expect(e.taskReference).toBe(url);
  });

  it("preserves a plain-text Task Reference like 'T115'", () => {
    const e = toEir(item({ fields: { TaskReference: "T115" } }));
    expect(e.taskReference).toBe("T115");
  });
});

describe("attachEirReferences", () => {
  it("fills project titles from the supplied projects catalogue", () => {
    const eirs: Eir[] = [
      {
        ...toEir(item({ fields: { ProjectReferenceLookupId: 274 } })),
      },
    ];
    const projects: ProjectReference[] = [{ lookupId: 274, title: "0000-Engineering Apps" }];
    attachEirReferences(eirs, projects);
    expect(eirs[0].parentProject?.title).toBe("0000-Engineering Apps");
  });

  it("leaves the placeholder title when the project isn't in the catalogue", () => {
    const eirs: Eir[] = [
      { ...toEir(item({ fields: { ProjectReferenceLookupId: 999 } })) },
    ];
    attachEirReferences(eirs, []);
    expect(eirs[0].parentProject?.title).toBe("");
  });
});
