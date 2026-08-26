import { describe, it, expect } from "vitest";
import {
  buildSupplierCreateFields,
  compareSuppliers,
  parseSupplierLogo,
  supplierDetailsPatch,
  supplierLabel,
  toSupplier,
} from "./supplierMapper";
import type { GraphListItem, Supplier } from "@/types/task";

function item(fields: Record<string, unknown>): GraphListItem {
  return { id: "25", fields } as unknown as GraphListItem;
}

describe("toSupplier", () => {
  it("reads the QualityPeformance/QualityPerformance naming trap correctly", () => {
    const supplier = toSupplier(item({ QualityPeformance: 93, QualityPerformance: 100 }));
    // Internal QualityPeformance (typo, missing r) → "Logistical Performance".
    expect(supplier.logisticalPerformance).toBe(93);
    // Internal QualityPerformance (correct spelling) → "Quality Performance".
    expect(supplier.qualityPerformance).toBe(100);
  });

  it("reads CoreCompetency as a multi choice and Status as a single choice", () => {
    const supplier = toSupplier(item({ CoreCompetency: ["Capacitors", "Assembly"], Status: "Active" }));
    expect(supplier.coreCompetencies).toEqual(["Capacitors", "Assembly"]);
    expect(supplier.status).toBe("Active");
  });

  it("drops a Status value outside the known choices", () => {
    expect(toSupplier(item({ Status: "Not A Status" })).status).toBeNull();
  });

  it("reads AssignedBuyer as single-person and Watchers as multi-person", () => {
    const supplier = toSupplier(
      item({
        AssignedBuyer: { LookupId: 21, LookupValue: "Glenn Terry", Email: "glenn.terry@x.com" },
        Watchers: [{ LookupId: 21, LookupValue: "Glenn Terry", Email: "glenn.terry@x.com" }],
      }),
    );
    expect(supplier.assignedBuyer?.displayName).toBe("Glenn Terry");
    expect(supplier.watchers).toHaveLength(1);
  });

  it("reads PointofContact as a bare lookupId", () => {
    expect(toSupplier(item({ PointofContactLookupId: "1" })).pointOfContactId).toBe(1);
    expect(toSupplier(item({})).pointOfContactId).toBeNull();
  });

  it("parses the Communication thread", () => {
    const supplier = toSupplier(
      item({
        Communication: "07/18/2024 07:28:33 PM|||Ray White|||ray.white@altronic-llc.com|||<p>Hi</p>",
      }),
    );
    expect(supplier.comments).toHaveLength(1);
  });
});

describe("parseSupplierLogo", () => {
  it("parses the JSON-encoded fileName/originalImageName", () => {
    const raw = JSON.stringify({ fileName: "Reserved_ImageAttachment_x.jpg", originalImageName: "arrow.jpg" });
    expect(parseSupplierLogo(raw)).toEqual({
      fileName: "Reserved_ImageAttachment_x.jpg",
      originalImageName: "arrow.jpg",
    });
  });

  it("accepts an already-parsed object (mock fixtures)", () => {
    expect(parseSupplierLogo({ fileName: "x.png", originalImageName: "y.png" })).toEqual({
      fileName: "x.png",
      originalImageName: "y.png",
    });
  });

  it("returns null for blank, malformed, or shapeless values — never throws", () => {
    expect(parseSupplierLogo(undefined)).toBeNull();
    expect(parseSupplierLogo("")).toBeNull();
    expect(parseSupplierLogo("not json")).toBeNull();
    expect(parseSupplierLogo("{}")).toBeNull();
    expect(parseSupplierLogo({})).toBeNull();
  });

  it("wires into toSupplier via the Logo field", () => {
    const supplier = toSupplier(
      item({ Logo: JSON.stringify({ fileName: "Reserved_ImageAttachment_x.jpg", originalImageName: "a" }) }),
    );
    expect(supplier.logo?.fileName).toBe("Reserved_ImageAttachment_x.jpg");
    expect(toSupplier(item({})).logo).toBeNull();
  });
});

describe("buildSupplierCreateFields", () => {
  it("computes Title from BP number + company name", () => {
    const fields = buildSupplierCreateFields(
      {
        companyName: "Arrow Electronics",
        businessPartnerNumber: "103832",
        address: "",
        website: "",
        status: null,
        assignedBuyer: null,
        watchers: [],
      },
      { assignedBuyer: null, watchers: [] },
    );
    expect(fields.Title).toBe("103832-Arrow Electronics");
  });

  it("writes Watchers as a multi-person field", () => {
    const fields = buildSupplierCreateFields(
      {
        companyName: "X",
        businessPartnerNumber: "",
        address: "",
        website: "",
        status: null,
        assignedBuyer: null,
        watchers: [],
      },
      { assignedBuyer: null, watchers: [{ displayName: "Glenn Terry", lookupId: 21 }] },
    );
    expect(fields["WatchersLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
    expect(fields.WatchersLookupId).toEqual([21]);
  });
});

describe("supplierDetailsPatch", () => {
  const current: Supplier = {
    id: 1,
    title: "103832-Arrow Electronics",
    companyName: "Arrow Electronics",
    businessPartnerNumber: "103832",
    address: "",
    website: "",
    supplierScore: "",
    coreCompetencies: [],
    status: null,
    notes: "",
    assignedBuyer: null,
    supplierIdentifier: "",
    watchers: [],
    pointOfContactId: null,
    allDeliveries: null,
    supplierPerformanceRate: null,
    logisticalPerformance: null,
    qualityPerformance: null,
    logo: null,
    comments: [],
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
  };

  it("recomputes Title using the CURRENT other half when only one side changes", () => {
    // Patching just the BP number must not blank the company name out of Title.
    expect(supplierDetailsPatch(current, { businessPartnerNumber: "999999" })).toMatchObject({
      BusinessPartnerNumber: "999999",
      Title: "999999-Arrow Electronics",
    });
    expect(supplierDetailsPatch(current, { companyName: "New Name" })).toMatchObject({
      CompanyName: "New Name",
      Title: "103832-New Name",
    });
  });

  it("only includes the keys that changed", () => {
    expect(supplierDetailsPatch(current, { address: "123 Main St" })).toEqual({
      Address: "123 Main St",
    });
  });
});

describe("supplierLabel / compareSuppliers", () => {
  it("falls back to a numbered label when Title and CompanyName are blank", () => {
    const blank: Supplier = { ...currentFixture(), title: "", companyName: "" };
    expect(supplierLabel(blank)).toBe("Supplier #1");
  });

  it("sorts alphabetically by label", () => {
    const a = { ...currentFixture(), id: 1, title: "Zeta" };
    const b = { ...currentFixture(), id: 2, title: "Arrow" };
    expect([a, b].sort(compareSuppliers)).toEqual([b, a]);
  });
});

function currentFixture(): Supplier {
  return {
    id: 1,
    title: "",
    companyName: "",
    businessPartnerNumber: "",
    address: "",
    website: "",
    supplierScore: "",
    coreCompetencies: [],
    status: null,
    notes: "",
    assignedBuyer: null,
    supplierIdentifier: "",
    watchers: [],
    pointOfContactId: null,
    allDeliveries: null,
    supplierPerformanceRate: null,
    logisticalPerformance: null,
    qualityPerformance: null,
    logo: null,
    comments: [],
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
  };
}
