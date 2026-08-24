import { describe, it, expect } from "vitest";
import type { GraphListItem } from "@/types/task";
import {
  buildGrayMarketCreateFields,
  compareGrayMarketRequests,
  grayMarketFieldPatch,
  grayMarketLabel,
  parsePeople,
  parseSinglePerson,
  toGrayMarketRequest,
} from "./grayMarketMapper";
import { GRAY_MARKET_FIELDS, GRAY_MARKET_SELECT } from "./grayMarketFields";
import { nextGrayMarketLogNo } from "./grayMarketNumber";
import type { GrayMarketRequest } from "@/types/task";

// Column names and shapes come from the live list —
// scripts/gray-market-request-schema.json, captured 2026-08-19.

function item(fields: Record<string, unknown>, id = "4"): GraphListItem {
  return { id, fields } as unknown as GraphListItem;
}

/** A row shaped exactly like the real ones. */
const REAL_ROW = item({
  Title: "1000-5018-00",
  LogNo_x002e_Raw: "GMR_2023-004",
  RequestStatus: "Complete",
  // Stored at 23:00Z — local midnight in the site's regional timezone.
  TodaysDate: "2023-02-01T23:00:00Z",
  DateCompleted: "2023-02-09T23:00:00Z",
  ProductionTest: "Yes",
  Requestor: { LookupId: 18, LookupValue: "Priya Nair", Email: "priya@altronic-llc.com" },
  Parts_x0020_Location: { LookupId: 22, LookupValue: "Ray White" },
  Watchers: [{ LookupId: 18, LookupValue: "Priya Nair", Email: "priya@altronic-llc.com" }],
  AIPartNo_x002e_: "711232",
  PartDescription: "TRANSISTOR, FET, N-CHAN",
  MFG_x002e_PartNo_x002e_: "IPZ40N04S5L2R8ATMA1",
  Vendor: "Tektronics",
  Qty_x002e_Purchased: "2500",
  PONo_x002e_: "4500186523",
  QANotes: "Pending",
  QtyofPartsforW_x002e_O_x002e_: "5",
  InCircuitPCBW_x002e_O_x002e__x00: "123",
  InCircuitResults: "Pass",
  FinalAssemblyW_x002e_O_x002e__x0: "456",
  WhereUsed: '<div class="ExternalClassB60"><div>1000-7205-00 PCB ASSY</div></div>',
  Attachments: false,
  Created: "2023-02-02T19:38:32Z",
  Modified: "2023-02-10T17:53:56Z",
});

describe("toGrayMarketRequest", () => {
  it("maps the named fields", () => {
    const r = toGrayMarketRequest(REAL_ROW);
    expect(r).toMatchObject({
      id: 4,
      title: "1000-5018-00",
      logNo: "GMR_2023-004",
      status: "Complete",
      testingRequired: "Yes",
      hasAttachments: false,
    });
  });

  // Reading the UTC date of a 23:00Z value shows the day before the one the
  // SharePoint list view shows — the bug already fixed for Visit Reports.
  it("puts the request on the day the list view shows", () => {
    const r = toGrayMarketRequest(REAL_ROW);
    expect(r.requestDate?.getUTCDate()).toBe(2); // stored 2023-02-01T23:00Z
    expect(r.dateCompleted?.getUTCDate()).toBe(10); // stored 2023-02-09T23:00Z
  });

  it("reads the people columns, including the one named like a place", () => {
    // Parts Location is a PERSON column despite its name.
    const r = toGrayMarketRequest(REAL_ROW);
    expect(r.requestor?.displayName).toBe("Priya Nair");
    expect(r.partsLocation?.displayName).toBe("Ray White");
    expect(r.watchers.map((w) => w.displayName)).toEqual(["Priya Nair"]);
  });

  it("reads the columns whose internal names don't match their labels", () => {
    const r = toGrayMarketRequest(REAL_ROW);
    // QANotes is labelled "Inspection Flag"…
    expect(r.values.inspectionFlag).toBe("Pending");
    // …QtyofPartsforW.O. is labelled "Qty of Parts for BR"…
    expect(r.values.qtyForBuildRequest).toBe("5");
    // …and both W.O. columns have TRUNCATED internal names.
    expect(r.values.inCircuitWo).toBe("123");
    expect(r.values.finalAssemblyWo).toBe("456");
  });

  it("keeps Where Used as the HTML SharePoint stores", () => {
    expect(toGrayMarketRequest(REAL_ROW).values.whereUsed).toContain("1000-7205-00");
  });

  it("gives every descriptor field a value, even on a sparse row", () => {
    const r = toGrayMarketRequest(item({ Title: "x" }));
    for (const field of GRAY_MARKET_FIELDS) {
      expect(r.values[field.key]).toBe("");
    }
  });

  it("selects every descriptor column", () => {
    for (const field of GRAY_MARKET_FIELDS) {
      expect(GRAY_MARKET_SELECT).toContain(field.column);
    }
  });

  it("never selects the calculated Log No. column", () => {
    // Log_x0020_No_x002e_ is derived from the raw one and is read-only.
    expect(GRAY_MARKET_SELECT).not.toContain("Log_x0020_No_x002e_");
  });
});

describe("person parsing", () => {
  it("handles the single-object shape", () => {
    expect(parseSinglePerson({ LookupId: 3, LookupValue: "A B" })?.lookupId).toBe(3);
  });

  it("handles a single value wrapped in an array", () => {
    expect(parseSinglePerson([{ LookupId: 3, LookupValue: "A B" }])?.displayName).toBe("A B");
  });

  it("is null for an empty column", () => {
    expect(parseSinglePerson(null)).toBeNull();
    expect(parseSinglePerson({})).toBeNull();
  });

  it("reads a multi-person column", () => {
    expect(parsePeople([{ LookupValue: "A" }, { LookupValue: "B" }])).toHaveLength(2);
  });
});

describe("buildGrayMarketCreateFields", () => {
  const input = {
    title: " 1000-1234-00 ",
    status: "Open",
    requestDate: new Date("2026-08-19T12:00:00Z"),
    testingRequired: "Yes",
    requestor: null,
    values: { vendor: " AERI ", partDescription: "", whereUsed: "Line one\n\nLine two" },
  };

  it("writes the named columns", () => {
    const fields = buildGrayMarketCreateFields(input, "GMR_2026-004");
    expect(fields).toMatchObject({
      Title: "1000-1234-00",
      LogNo_x002e_Raw: "GMR_2026-004",
      RequestStatus: "Open",
      ProductionTest: "Yes",
      TodaysDate: "2026-08-19T12:00:00Z",
    });
  });

  it("writes descriptor values under their real column names", () => {
    expect(buildGrayMarketCreateFields(input, "x").Vendor).toBe("AERI");
  });

  it("leaves blank fields out of a create rather than sending empty strings", () => {
    expect(buildGrayMarketCreateFields(input, "x")).not.toHaveProperty("PartDescription");
  });

  it("omits Testing Required when it hasn't been decided yet", () => {
    // Whether testing is needed is settled later in the workflow, so a
    // request is raised without it — and a blank column is not sent as "".
    const fields = buildGrayMarketCreateFields({ ...input, testingRequired: "" }, "x");
    expect(fields).not.toHaveProperty("ProductionTest");
  });

  it("converts a rich-text column to paragraphs", () => {
    // WhereUsed is rendered as HTML by SharePoint, so plain newlines would
    // collapse — the same rule as the EIR long fields.
    expect(buildGrayMarketCreateFields(input, "x").WhereUsed).toBe(
      "<p>Line one</p><p>Line two</p>",
    );
  });

  it("never writes the calculated Log No. column", () => {
    expect(buildGrayMarketCreateFields(input, "x")).not.toHaveProperty("Log_x0020_No_x002e_");
  });
});

describe("grayMarketFieldPatch", () => {
  it("patches one column by its domain key", () => {
    expect(grayMarketFieldPatch("vendor", " AERI ")).toEqual({ Vendor: "AERI" });
  });

  it("routes a rich-text field through the HTML conversion", () => {
    expect(grayMarketFieldPatch("whereUsed", "One\n\nTwo")).toEqual({
      WhereUsed: "<p>One</p><p>Two</p>",
    });
  });

  it("throws on an unknown key rather than writing nothing", () => {
    expect(() => grayMarketFieldPatch("nope", "x")).toThrow(/unknown/i);
  });
});

describe("ordering and labels", () => {
  const rows = [
    { id: 1, requestDate: new Date("2026-01-05T12:00:00Z"), logNo: "GMR_2026-001", title: "A" },
    { id: 2, requestDate: new Date("2026-08-11T12:00:00Z"), logNo: "GMR_2026-002", title: "B" },
    { id: 3, requestDate: null, logNo: "", title: "" },
  ] as GrayMarketRequest[];

  it("sorts newest first, undated last", () => {
    expect([...rows].sort(compareGrayMarketRequests).map((r) => r.id)).toEqual([2, 1, 3]);
  });

  it("labels a request by its log number, falling back sensibly", () => {
    expect(grayMarketLabel(rows[0])).toBe("GMR_2026-001");
    expect(grayMarketLabel(rows[2])).toBe("Request #3");
  });
});

describe("nextGrayMarketLogNo", () => {
  const at = (iso: string) => new Date(iso);

  it("continues the year's sequence", () => {
    const existing = [
      { logNo: "GMR_2026-003" },
      { logNo: "GMR_2026-001" },
    ] as GrayMarketRequest[];
    expect(nextGrayMarketLogNo(existing, at("2026-08-19T12:00:00Z"))).toBe("GMR_2026-004");
  });

  it("starts at 001 in a new year", () => {
    const existing = [{ logNo: "GMR_2025-042" }] as GrayMarketRequest[];
    expect(nextGrayMarketLogNo(existing, at("2026-01-02T12:00:00Z"))).toBe("GMR_2026-001");
  });

  it("ignores a hand-typed hyphen variant without restarting the count", () => {
    const existing = [{ logNo: "GMR-2026-007" }] as GrayMarketRequest[];
    expect(nextGrayMarketLogNo(existing, at("2026-08-19T12:00:00Z"))).toBe("GMR_2026-008");
  });

  it("lets the number grow past three digits rather than wrapping", () => {
    const existing = [{ logNo: "GMR_2026-999" }] as GrayMarketRequest[];
    expect(nextGrayMarketLogNo(existing, at("2026-08-19T12:00:00Z"))).toBe("GMR_2026-1000");
  });
});
