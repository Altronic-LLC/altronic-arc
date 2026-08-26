import { describe, it, expect } from "vitest";
import {
  buildCustomerContactFields,
  compareCustomerContacts,
  toCustomerContact,
} from "./customerContactMapper";
import type { CustomerContact, GraphListItem } from "@/types/task";

function item(fields: Record<string, unknown>): GraphListItem {
  return { id: "3", fields } as unknown as GraphListItem;
}

describe("toCustomerContact", () => {
  it("reads the Customer lookup as a bare id", () => {
    const contact = toCustomerContact(item({ Title: "Hunter Nixon", CustomerLookupId: "1" }));
    expect(contact.customerId).toBe(1);
    expect(contact.name).toBe("Hunter Nixon");
  });

  it("has no customer when the lookup is unset", () => {
    expect(toCustomerContact(item({})).customerId).toBeNull();
  });
});

describe("buildCustomerContactFields", () => {
  it("only includes keys present on the partial input", () => {
    expect(buildCustomerContactFields({ email: "x@y.com" })).toEqual({ Email: "x@y.com" });
    expect(buildCustomerContactFields({ customerId: 5 })).toEqual({ CustomerLookupId: 5 });
  });
});

describe("compareCustomerContacts", () => {
  it("sorts alphabetically by name", () => {
    const a: CustomerContact = {
      id: 1,
      name: "Zeta",
      customerId: 1,
      email: "",
      phoneNumber: "",
      jobTitle: "",
      contactNotes: "",
    };
    const b: CustomerContact = { ...a, id: 2, name: "Andy" };
    expect([a, b].sort(compareCustomerContacts)).toEqual([b, a]);
  });
});
