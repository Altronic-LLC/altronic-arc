import { describe, expect, it } from "vitest";
import type { GraphListItem, Person } from "@/types/task";
import type { PricingRequest } from "@/types/pricing";
import {
  attachPricingPeople,
  buildCustomerQuoteFields,
  buildPricingRequestCreateFields,
  buildPricingRequestUpdateFields,
  buildSubAssemblyFields,
  toCustomerQuote,
  toPricingRequest,
  toSubAssembly,
  type PricingRequestCreateFields,
} from "./pricingMapper";

function item(fields: Record<string, unknown>, id = "12"): GraphListItem {
  return {
    id,
    createdDateTime: "2026-10-13T12:00:00Z",
    lastModifiedDateTime: "2026-10-13T13:00:00Z",
    createdBy: { user: { displayName: "Ray White", email: "ray.white@altronic-llc.com" } },
    fields,
  } as GraphListItem;
}

describe("toPricingRequest", () => {
  it("reads a single-person column from a bare <Name>LookupId STRING into a nameless Person", () => {
    const r = toPricingRequest(
      item({ Title: "PR-2026-0001", RequestedByLookupId: "46", PricedByLookupId: "7", AddedToSapByLookupId: "" }),
    );
    expect(r.requestedBy).toEqual({ displayName: "", lookupId: 46 });
    expect(r.pricedBy).toEqual({ displayName: "", lookupId: 7 });
    expect(r.addedToSapBy).toBeNull();
  });

  it("prefers the expanded person when Graph sends one", () => {
    const r = toPricingRequest(
      item({
        RequestedBy: { LookupId: 46, LookupValue: "Rita Requester", Email: "rita@altronic-llc.com" },
        RequestedByLookupId: "46",
      }),
    );
    expect(r.requestedBy?.displayName).toBe("Rita Requester");
    expect(r.requestedBy?.email).toBe("rita@altronic-llc.com");
  });

  it("reads an unknown or blank status as Submitted", () => {
    expect(toPricingRequest(item({ Status: "Waiting on Bob" })).status).toBe("Submitted");
    expect(toPricingRequest(item({})).status).toBe("Submitted");
    expect(toPricingRequest(item({ Status: "Priced" })).status).toBe("Priced");
  });

  it("reads numbers tolerantly and item-level fields", () => {
    const r = toPricingRequest(item({ ListPrice: "253", CustomerPrice: "junk", CustomerDiscountPct: 10, Attachments: true }));
    expect(r.id).toBe(12);
    expect(r.listPrice).toBe(253);
    expect(r.customerPrice).toBeNull();
    expect(r.customerDiscountPct).toBe(10);
    expect(r.hasAttachments).toBe(true);
    expect(r.createdBy).toEqual({ displayName: "Ray White", email: "ray.white@altronic-llc.com" });
    expect(r.pricedAt).toBeNull();
  });

  it("reads Leave as Contact Factory only on a priced request — an unpriced row's No is 'not answered'", () => {
    expect(toPricingRequest(item({ LeaveAsContactFactory: true, PricedAt: "2026-10-14T12:00:00Z" })).leaveAsContactFactory).toBe(true);
    expect(toPricingRequest(item({ LeaveAsContactFactory: false, PricedAt: "2026-10-14T12:00:00Z" })).leaveAsContactFactory).toBe(false);
    expect(toPricingRequest(item({ LeaveAsContactFactory: false })).leaveAsContactFactory).toBeNull();
    expect(toPricingRequest(item({})).leaveAsContactFactory).toBeNull();
  });
});

describe("attachPricingPeople", () => {
  it("fills names from the site directory, and leaves 'User #n' for an id nobody answers for", () => {
    const requests = [
      toPricingRequest(item({ RequestedByLookupId: "46", PricedByLookupId: "99" })),
    ];
    const users = new Map<number, Person>([[46, { displayName: "Rita", email: "rita@altronic-llc.com", lookupId: 46 }]]);
    attachPricingPeople(requests, users);
    expect(requests[0].requestedBy).toEqual({ displayName: "Rita", email: "rita@altronic-llc.com", lookupId: 46 });
    expect(requests[0].pricedBy).toEqual({ displayName: "User #99", lookupId: 99 });
    expect(requests[0].addedToSapBy).toBeNull();
  });

  it("leaves a person who already has a name alone", () => {
    const r = toPricingRequest(item({ RequestedBy: { LookupId: 46, LookupValue: "Rita" } }));
    attachPricingPeople([r], new Map([[46, { displayName: "Someone else" }]]));
    expect(r.requestedBy?.displayName).toBe("Rita");
  });
});

describe("buildPricingRequestUpdateFields", () => {
  const previous: PricingRequest = toPricingRequest(
    item({ Title: "PR-2026-0001", Status: "Submitted", Description: "Old", ListPrice: 100, RequestNotes: "" }),
  );

  it("sends only the columns that CHANGED", () => {
    expect(
      buildPricingRequestUpdateFields({ status: "Submitted", description: "New", listPrice: 100, notes: "" }, previous),
    ).toEqual({ Description: "New" });
  });

  it("writes Leave as Contact Factory as a real boolean — No included", () => {
    expect(buildPricingRequestUpdateFields({ leaveAsContactFactory: false }, previous)).toEqual({ LeaveAsContactFactory: false });
    expect(buildPricingRequestUpdateFields({ leaveAsContactFactory: true }, previous)).toEqual({ LeaveAsContactFactory: true });
  });

  it("is {} when nothing changed (or only undefined was passed)", () => {
    expect(buildPricingRequestUpdateFields({ status: "Submitted", listPrice: 100 }, previous)).toEqual({});
    expect(buildPricingRequestUpdateFields({ description: undefined }, previous)).toEqual({});
  });

  it("maps to the internal column names, null clears included", () => {
    expect(buildPricingRequestUpdateFields({ notes: "n", listPrice: null, status: "Priced" }, previous)).toEqual({
      RequestNotes: "n",
      ListPrice: null,
      Status: "Priced",
    });
  });
});

describe("buildPricingRequestCreateFields", () => {
  const input: PricingRequestCreateFields = {
    requestNumber: "PR-2026-0001",
    status: "Submitted",
    altronicPartNumber: " 791950-08 ",
    sapPartNumber: "  ",
    requestedDescription: "Thing",
    description: "Thing",
    mpg: "",
    notes: "",
    customerSoldTo: " 100 ",
    customerName: "",
    customerGroup: "",
    requestedByLookupId: 46,
  };

  it("writes RequestedByLookupId as a BARE integer, and omits blank optional columns", () => {
    const out = buildPricingRequestCreateFields(input);
    expect(out.RequestedByLookupId).toBe(46);
    expect(out).not.toHaveProperty("RequestedByLookupId@odata.type");
    expect(out).toEqual({
      Title: "PR-2026-0001",
      Status: "Submitted",
      AltronicPartNumber: "791950-08",
      RequestedDescription: "Thing",
      Description: "Thing",
      RequestNotes: "",
      CustomerSoldTo: "100",
      RequestedByLookupId: 46,
    });
  });

  it("omits the requester when unresolved", () => {
    expect(buildPricingRequestCreateFields({ ...input, requestedByLookupId: null })).not.toHaveProperty(
      "RequestedByLookupId",
    );
  });
});

describe("sub-assemblies", () => {
  it("toSubAssembly reads the lookup, lines and uploader", () => {
    const s = toSubAssembly(
      item({
        Title: " Board ",
        WorksheetRefLookupId: "5",
        Rev: 2,
        QuantityPerProduct: "3",
        Lines: JSON.stringify([{ partNumber: "A", description: "", quantity: 1, uploadedCost: 2, adjustedCost: null }]),
        UploadedByName: "",
        UploadedByEmail: "ray@x.com",
      }),
    );
    expect(s.worksheetId).toBe(5);
    expect(s.name).toBe("Board");
    expect(s.quantityPerProduct).toBe(3);
    expect(s.lines).toHaveLength(1);
    expect(s.linesCorrupt).toBe(false);
    expect(s.uploadedBy).toEqual({ displayName: "ray@x.com", email: "ray@x.com" });
  });

  it("toSubAssembly flags corrupt lines and defaults rev / quantity", () => {
    const s = toSubAssembly(item({ Lines: "{bad" }));
    expect(s.linesCorrupt).toBe(true);
    expect(s.rev).toBe(1);
    expect(s.quantityPerProduct).toBe(1);
    expect(s.worksheetId).toBe(0);
    expect(s.uploadedBy).toBeNull();
  });

  it("buildSubAssemblyFields serialises Lines once and writes only what was given", () => {
    const lines = [{ partNumber: "A", description: "", quantity: 1, uploadedCost: 2, adjustedCost: null }];
    expect(buildSubAssemblyFields({ name: " Board ", lines, uploadedBy: null })).toEqual({
      Title: "Board",
      Lines: JSON.stringify(lines),
      UploadedByName: "",
      UploadedByEmail: "",
    });
    expect(buildSubAssemblyFields({})).toEqual({});
  });
});

describe("customer quotes", () => {
  it("toCustomerQuote falls back to the plain columns when the JSON lacks the customer", () => {
    const q = toCustomerQuote(
      item({ Title: "SQ-2026-0001-R2", Rev: 2, CustomerName: " Acme ", CustomerSoldTo: "100", Customer: "" }),
    );
    expect(q.customer.name).toBe("Acme");
    expect(q.customer.soldTo).toBe("100");
    expect(q.quoteBase).toBe("SQ-2026-0001");
    expect(q.status).toBe("Draft");
    expect(q.validityDays).toBe(30);
  });

  it("toCustomerQuote prefers the JSON when it has the customer", () => {
    const q = toCustomerQuote(
      item({ Customer: JSON.stringify({ name: "Acme Corp", soldTo: "200" }), CustomerName: "Old", CustomerSoldTo: "1" }),
    );
    expect(q.customer.name).toBe("Acme Corp");
    expect(q.customer.soldTo).toBe("200");
  });

  it("buildCustomerQuoteFields writes the Customer JSON AND CustomerSoldTo / CustomerName", () => {
    const customer = { soldTo: " 100 ", name: " Acme ", customerGroup: "", contactName: "", contactEmail: "" };
    const out = buildCustomerQuoteFields({ customer, notes: "n" });
    expect(out).toEqual({
      Customer: JSON.stringify(customer),
      CustomerSoldTo: "100",
      CustomerName: "Acme",
      QuoteNotes: "n",
    });
    expect(buildCustomerQuoteFields({})).toEqual({});
  });
});
