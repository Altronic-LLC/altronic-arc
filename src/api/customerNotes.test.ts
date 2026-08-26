import { describe, it, expect } from "vitest";
import * as customerNotesModule from "./customerNotes";
import {
  addCustomerNoteComment,
  createCustomerNote,
  deleteCustomerNote,
  editCustomerNoteComment,
  getCustomerNote,
  listCustomerNotes,
  updateCustomerNoteDetails,
  updateCustomerNotePeople,
  updateCustomerNoteText,
} from "./customerNotes";

// USE_MOCK is true under Vitest — these run against the in-memory store.

describe("Customer Notes API", () => {
  it("lists alphabetically", async () => {
    const notes = await listCustomerNotes();
    expect(notes.length).toBeGreaterThan(0);
    const names = notes.map((n) => n.customerName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("creates a customer, resolving CSR/KAM to lookupIds", async () => {
    const created = await createCustomerNote({
      customerName: "New Co",
      oldCustomerNumber: "",
      sapCustomerNumber: "",
      group: "Arrow",
      customerTypes: ["OEM"],
      csr: [{ displayName: "Sena Wheelhouse", email: "sena.wheelhouse@altronic-llc.com" }],
      kam: null,
    });
    expect(created.customerName).toBe("New Co");
    expect(created.csr[0].lookupId).toBeGreaterThan(0);

    const found = await getCustomerNote(created.id);
    expect(found?.customerName).toBe("New Co");
  });

  it("patches the Details card", async () => {
    const created = await createCustomerNote({
      customerName: "Old Name",
      oldCustomerNumber: "",
      sapCustomerNumber: "",
      group: null,
      customerTypes: [],
      csr: [],
      kam: null,
    });
    const updated = await updateCustomerNoteDetails(created.id, { customerName: "New Name" });
    expect(updated.customerName).toBe("New Name");
  });

  it("patches CSR/KAM", async () => {
    const created = await createCustomerNote({
      customerName: "X",
      oldCustomerNumber: "",
      sapCustomerNumber: "",
      group: null,
      customerTypes: [],
      csr: [],
      kam: null,
    });
    const updated = await updateCustomerNotePeople(created.id, {
      kam: { displayName: "Jerrod Waldron", email: "jerrod.waldron@altronic-llc.com" },
    });
    // Mock mode only knows the lookupId from the patch, the same as the ECN
    // project-lookup mock (name arrives once the item is re-read in real mode).
    expect(updated.kam?.lookupId).toBeGreaterThan(0);
  });

  it("patches General/Compliance Notes", async () => {
    const created = await createCustomerNote({
      customerName: "X",
      oldCustomerNumber: "",
      sapCustomerNumber: "",
      group: null,
      customerTypes: [],
      csr: [],
      kam: null,
    });
    const updated = await updateCustomerNoteText(created.id, { generalNotes: "<p>Hi</p>" });
    expect(updated.generalNotes).toBe("<p>Hi</p>");
  });

  it("deletes a customer", async () => {
    const created = await createCustomerNote({
      customerName: "Temp",
      oldCustomerNumber: "",
      sapCustomerNumber: "",
      group: null,
      customerTypes: [],
      csr: [],
      kam: null,
    });
    await deleteCustomerNote(created.id);
    expect(await getCustomerNote(created.id)).toBeNull();
  });

  it("posts and edits a comment", async () => {
    const created = await createCustomerNote({
      customerName: "X",
      oldCustomerNumber: "",
      sapCustomerNumber: "",
      group: null,
      customerTypes: [],
      csr: [],
      kam: null,
    });
    const withComment = await addCustomerNoteComment(created.id, {
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml: "<p>Frist</p>",
    });
    expect(withComment.comments[0].bodyHtml).toContain("Frist");

    const edited = await editCustomerNoteComment(
      created.id,
      { timestamp: withComment.comments[0].timestamp, authorEmail: "ray.white@altronic-llc.com" },
      "<p>First</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>First</p>");
  });

  it("rejects an update to a customer that isn't there", async () => {
    await expect(updateCustomerNoteDetails(999_999, { customerName: "x" })).rejects.toThrow();
  });

  it("returns null for a customer that doesn't exist", async () => {
    expect(await getCustomerNote(999_999)).toBeNull();
  });

  // Unlike Visit Reports / Gray Market, this IS a maintained address book —
  // so a delete is expected, not a gap to guard against.
  it("has a delete", () => {
    expect(Object.keys(customerNotesModule)).toContain("deleteCustomerNote");
  });
});
