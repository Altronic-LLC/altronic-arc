import { describe, it, expect } from "vitest";
import {
  addSupplierContactComment,
  createSupplierContact,
  deleteSupplierContact,
  editSupplierContactComment,
  listSupplierContacts,
  setSupplierContactWatchers,
  updateSupplierContactFields,
} from "./supplierContacts";

describe("Supplier Contacts API", () => {
  it("lists contacts", async () => {
    const contacts = await listSupplierContacts();
    expect(contacts.length).toBeGreaterThan(0);
  });

  it("creates a contact scoped to a supplier", async () => {
    const created = await createSupplierContact({
      name: "New Contact",
      firstName: "New",
      lastName: "Contact",
      supplierId: 25,
      email: "new@x.com",
      phone: "",
      status: "Active",
      contactNotes: "",
      watchers: [],
    });
    expect(created.supplierId).toBe(25);
    expect(created.name).toBe("New Contact");
  });

  it("updates only the changed fields", async () => {
    const created = await createSupplierContact({
      name: "X",
      firstName: "",
      lastName: "",
      supplierId: 25,
      email: "",
      phone: "",
      status: null,
      contactNotes: "",
      watchers: [],
    });
    const updated = await updateSupplierContactFields(created.id, { email: "new@y.com" });
    expect(updated.email).toBe("new@y.com");
    expect(updated.name).toBe("X");
  });

  it("patches watchers", async () => {
    const created = await createSupplierContact({
      name: "X",
      firstName: "",
      lastName: "",
      supplierId: 25,
      email: "",
      phone: "",
      status: null,
      contactNotes: "",
      watchers: [],
    });
    const updated = await setSupplierContactWatchers(created.id, [
      { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
    ]);
    expect(updated.watchers).toHaveLength(1);
  });

  it("posts and edits a comment", async () => {
    const created = await createSupplierContact({
      name: "X",
      firstName: "",
      lastName: "",
      supplierId: 25,
      email: "",
      phone: "",
      status: null,
      contactNotes: "",
      watchers: [],
    });
    const withComment = await addSupplierContactComment(created.id, {
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml: "<p>Frist</p>",
    });
    expect(withComment.comments[0].bodyHtml).toContain("Frist");

    const edited = await editSupplierContactComment(
      created.id,
      { timestamp: withComment.comments[0].timestamp, authorEmail: "ray.white@altronic-llc.com" },
      "<p>First</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>First</p>");
  });

  it("deletes a contact", async () => {
    const created = await createSupplierContact({
      name: "Temp",
      firstName: "",
      lastName: "",
      supplierId: 25,
      email: "",
      phone: "",
      status: null,
      contactNotes: "",
      watchers: [],
    });
    await deleteSupplierContact(created.id);
    const contacts = await listSupplierContacts();
    expect(contacts.find((c) => c.id === created.id)).toBeUndefined();
  });
});
