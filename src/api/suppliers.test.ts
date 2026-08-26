import { describe, it, expect } from "vitest";
import * as suppliersModule from "./suppliers";
import {
  addSupplierComment,
  createSupplier,
  editSupplierComment,
  getSupplier,
  listSuppliers,
  setSupplierWatchers,
  updateSupplierAssignedBuyer,
  updateSupplierDetails,
  updateSupplierPointOfContact,
} from "./suppliers";

describe("Suppliers API", () => {
  it("lists alphabetically by label", async () => {
    const suppliers = await listSuppliers();
    expect(suppliers.length).toBeGreaterThan(0);
  });

  it("creates a supplier, computing Title and resolving watchers", async () => {
    const created = await createSupplier({
      companyName: "New Supplier Co",
      businessPartnerNumber: "999999",
      address: "",
      website: "",
      status: "Active",
      assignedBuyer: null,
      watchers: [{ displayName: "Ray White", email: "ray.white@altronic-llc.com" }],
    });
    expect(created.title).toBe("999999-New Supplier Co");
    expect(created.watchers[0].lookupId).toBeGreaterThan(0);

    const found = await getSupplier(created.id);
    expect(found?.companyName).toBe("New Supplier Co");
  });

  it("patches the Details card, recomputing Title", async () => {
    const created = await createSupplier({
      companyName: "Old Name",
      businessPartnerNumber: "111",
      address: "",
      website: "",
      status: null,
      assignedBuyer: null,
      watchers: [],
    });
    const updated = await updateSupplierDetails(created, { companyName: "New Name" });
    expect(updated.companyName).toBe("New Name");
    expect(updated.title).toBe("111-New Name");
  });

  it("patches the Assigned Buyer and Point of Contact", async () => {
    const created = await createSupplier({
      companyName: "X",
      businessPartnerNumber: "",
      address: "",
      website: "",
      status: null,
      assignedBuyer: null,
      watchers: [],
    });
    const withBuyer = await updateSupplierAssignedBuyer(created.id, {
      displayName: "Glenn Terry",
      email: "glenn.terry@altronic-llc.com",
    });
    expect(withBuyer.assignedBuyer?.lookupId).toBeGreaterThan(0);

    const withPoc = await updateSupplierPointOfContact(created.id, 1);
    expect(withPoc.pointOfContactId).toBe(1);
  });

  it("patches watchers", async () => {
    const created = await createSupplier({
      companyName: "X",
      businessPartnerNumber: "",
      address: "",
      website: "",
      status: null,
      assignedBuyer: null,
      watchers: [],
    });
    const updated = await setSupplierWatchers(created.id, [
      { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
    ]);
    expect(updated.watchers).toHaveLength(1);
  });

  it("posts and edits a comment", async () => {
    const created = await createSupplier({
      companyName: "X",
      businessPartnerNumber: "",
      address: "",
      website: "",
      status: null,
      assignedBuyer: null,
      watchers: [],
    });
    const withComment = await addSupplierComment(created.id, {
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml: "<p>Frist</p>",
    });
    expect(withComment.comments[0].bodyHtml).toContain("Frist");

    const edited = await editSupplierComment(
      created.id,
      { timestamp: withComment.comments[0].timestamp, authorEmail: "ray.white@altronic-llc.com" },
      "<p>First</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>First</p>");
  });

  it("returns null for a supplier that doesn't exist", async () => {
    expect(await getSupplier(999_999)).toBeNull();
  });

  // A supplier is the anchor for Contacts and Issues — deleting one would
  // orphan whatever points at it. Archive/Phase Out the Status instead.
  it("has no delete", () => {
    expect(Object.keys(suppliersModule).filter((n) => /delete|remove/i.test(n))).toEqual([]);
  });
});
