import { describe, it, expect } from "vitest";
import {
  buildSupplierContactCreateFields,
  compareSupplierContacts,
  supplierContactLabel,
  toSupplierContact,
} from "./supplierContactMapper";
import type { GraphListItem, SupplierContact } from "@/types/task";

function item(fields: Record<string, unknown>): GraphListItem {
  return { id: "1", fields } as unknown as GraphListItem;
}

describe("toSupplierContact", () => {
  it("reads the BPReference lookup as a bare id", () => {
    const contact = toSupplierContact(item({ Email: "josh.neal@carlton-bates.com", BPReferenceLookupId: "353" }));
    expect(contact.supplierId).toBe(353);
    expect(contact.email).toBe("josh.neal@carlton-bates.com");
  });

  it("reads Watchers as multi-person", () => {
    const contact = toSupplierContact(
      item({ Watchers: [{ LookupId: 64, LookupValue: "Ray White", Email: "ray@x.com" }] }),
    );
    expect(contact.watchers).toHaveLength(1);
  });
});

describe("buildSupplierContactCreateFields", () => {
  it("writes Watchers as a multi-person field", () => {
    const fields = buildSupplierContactCreateFields(
      { name: "", firstName: "", lastName: "", supplierId: 1, email: "", phone: "", status: null, contactNotes: "", watchers: [] },
      { watchers: [{ displayName: "Ray White", lookupId: 22 }] },
    );
    expect(fields["WatchersLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
    expect(fields.WatchersLookupId).toEqual([22]);
  });
});

describe("supplierContactLabel", () => {
  it("falls back through name → email → a numbered placeholder", () => {
    const base: SupplierContact = {
      id: 1,
      name: "",
      firstName: "",
      lastName: "",
      supplierId: 1,
      email: "",
      phone: "",
      status: null,
      contactNotes: "",
      comments: [],
      watchers: [],
      hasAttachments: false,
      createdAt: new Date(0),
      modifiedAt: new Date(0),
    };
    expect(supplierContactLabel(base)).toBe("Contact #1");
    expect(supplierContactLabel({ ...base, email: "josh@x.com" })).toBe("josh@x.com");
    expect(supplierContactLabel({ ...base, firstName: "Josh", lastName: "Neal", email: "josh@x.com" })).toBe(
      "Josh Neal",
    );
    expect(supplierContactLabel({ ...base, name: "Custom Title" })).toBe("Custom Title");
  });
});

describe("compareSupplierContacts", () => {
  it("sorts alphabetically by label", () => {
    const base = {
      id: 1,
      name: "",
      firstName: "",
      lastName: "",
      supplierId: 1,
      email: "",
      phone: "",
      status: null,
      contactNotes: "",
      comments: [],
      watchers: [],
      hasAttachments: false,
      createdAt: new Date(0),
      modifiedAt: new Date(0),
    } as SupplierContact;
    const a = { ...base, id: 1, name: "Zeta" };
    const b = { ...base, id: 2, name: "Andy" };
    expect([a, b].sort(compareSupplierContacts)).toEqual([b, a]);
  });
});
