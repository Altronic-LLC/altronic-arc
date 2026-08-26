import { describe, it, expect } from "vitest";
import {
  createCustomerContact,
  deleteCustomerContact,
  listCustomerContacts,
  updateCustomerContact,
} from "./customerContacts";

describe("Customer Contacts API", () => {
  it("lists alphabetically by name", async () => {
    const contacts = await listCustomerContacts();
    expect(contacts.length).toBeGreaterThan(0);
    const names = contacts.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("creates a contact scoped to a customer", async () => {
    const created = await createCustomerContact({
      name: "New Contact",
      customerId: 1,
      email: "x@y.com",
      phoneNumber: "",
      jobTitle: "",
      contactNotes: "",
    });
    expect(created.customerId).toBe(1);
    expect(created.name).toBe("New Contact");
  });

  it("updates only the changed fields", async () => {
    const created = await createCustomerContact({
      name: "X",
      customerId: 1,
      email: "",
      phoneNumber: "",
      jobTitle: "",
      contactNotes: "",
    });
    const updated = await updateCustomerContact(created.id, { email: "new@y.com" });
    expect(updated.email).toBe("new@y.com");
    expect(updated.name).toBe("X");
  });

  it("deletes a contact", async () => {
    const created = await createCustomerContact({
      name: "Temp",
      customerId: 1,
      email: "",
      phoneNumber: "",
      jobTitle: "",
      contactNotes: "",
    });
    await deleteCustomerContact(created.id);
    const contacts = await listCustomerContacts();
    expect(contacts.find((c) => c.id === created.id)).toBeUndefined();
  });
});
