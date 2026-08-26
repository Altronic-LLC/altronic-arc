import { describe, it, expect } from "vitest";
import {
  buildCustomerNoteCreateFields,
  compareCustomerNotes,
  customerNoteDetailsPatch,
  customerNoteLabel,
  toCustomerNote,
} from "./customerNoteMapper";
import type { CustomerNote, GraphListItem } from "@/types/task";

function item(fields: Record<string, unknown>): GraphListItem {
  return { id: "1", fields } as unknown as GraphListItem;
}

describe("toCustomerNote", () => {
  it("reads a single-choice Group and a multi-choice CustomerType", () => {
    const note = toCustomerNote(
      item({ Title: "Arrow Engine Company", Group: "Arrow", CustomerType: ["OEM", "AM"] }),
    );
    expect(note.group).toBe("Arrow");
    expect(note.customerTypes).toEqual(["OEM", "AM"]);
  });

  it("drops a Group/CustomerType value outside the known choices", () => {
    const note = toCustomerNote(item({ Group: "Not A Group", CustomerType: ["Not A Type"] }));
    expect(note.group).toBeNull();
    expect(note.customerTypes).toEqual([]);
  });

  it("reads CSR as multi-person and KAM as single-person", () => {
    const note = toCustomerNote(
      item({
        CSR: [{ LookupId: 64, LookupValue: "Sena Wheelhouse", Email: "sena@x.com" }],
        KAM: { LookupId: 45, LookupValue: "Jerrod Waldron", Email: "jerrod@x.com" },
      }),
    );
    expect(note.csr).toEqual([{ displayName: "Sena Wheelhouse", email: "sena@x.com", lookupId: 64 }]);
    expect(note.kam?.displayName).toBe("Jerrod Waldron");
  });

  it("parses the Communication thread", () => {
    const note = toCustomerNote(
      item({
        Communication:
          "07/18/2024 07:28:33 PM|||Ray White|||ray.white@altronic-llc.com|||<p>Hi</p>",
      }),
    );
    expect(note.comments).toHaveLength(1);
    expect(note.comments[0].bodyHtml).toBe("<p>Hi</p>");
  });

  it("defaults missing fields to empty/blank", () => {
    const note = toCustomerNote(item({}));
    expect(note.customerName).toBe("");
    expect(note.group).toBeNull();
    expect(note.customerTypes).toEqual([]);
    expect(note.csr).toEqual([]);
    expect(note.kam).toBeNull();
    expect(note.hasAttachments).toBe(false);
  });
});

describe("buildCustomerNoteCreateFields", () => {
  it("sends Group/CustomerType only when set", () => {
    const fields = buildCustomerNoteCreateFields(
      {
        customerName: "7 Compression",
        oldCustomerNumber: "1007",
        sapCustomerNumber: "105060",
        group: null,
        customerTypes: [],
        csr: [],
        kam: null,
      },
      { csr: [], kam: null },
    );
    expect(fields.Group).toBeUndefined();
    expect(fields.CustomerType).toBeUndefined();
    expect(fields.Title).toBe("7 Compression");
    expect(fields.KAMLookupId).toBeNull();
  });

  it("writes CSR as a multi-person field and KAM as a bare lookupId", () => {
    const fields = buildCustomerNoteCreateFields(
      {
        customerName: "Arrow",
        oldCustomerNumber: "",
        sapCustomerNumber: "",
        group: "Arrow",
        customerTypes: ["OEM"],
        csr: [],
        kam: null,
      },
      {
        csr: [{ displayName: "Sena Wheelhouse", lookupId: 64 }],
        kam: { displayName: "Jerrod Waldron", lookupId: 45 },
      },
    );
    expect(fields.Group).toBe("Arrow");
    expect(fields.CustomerType).toEqual(["OEM"]);
    expect(fields["CSRLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
    expect(fields.CSRLookupId).toEqual([64]);
    expect(fields.KAMLookupId).toBe(45);
  });
});

describe("customerNoteDetailsPatch", () => {
  it("only includes the keys that changed", () => {
    expect(customerNoteDetailsPatch({ customerName: "New Name" })).toEqual({
      Title: "New Name",
    });
    expect(customerNoteDetailsPatch({ group: null })).toEqual({ Group: null });
    expect(customerNoteDetailsPatch({ customerTypes: ["OEM", "AM"] })).toEqual({
      CustomerType: ["OEM", "AM"],
    });
  });
});

describe("customerNoteLabel / compareCustomerNotes", () => {
  const base: CustomerNote = {
    id: 1,
    customerName: "",
    oldCustomerNumber: "",
    sapCustomerNumber: "",
    generalNotes: "",
    complianceNotes: "",
    group: null,
    customerTypes: [],
    csr: [],
    kam: null,
    comments: [],
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
  };

  it("falls back to a numbered label when the name is blank", () => {
    expect(customerNoteLabel(base)).toBe("Customer #1");
    expect(customerNoteLabel({ ...base, customerName: "Arrow" })).toBe("Arrow");
  });

  it("sorts alphabetically by name", () => {
    const a = { ...base, id: 1, customerName: "Zeta" };
    const b = { ...base, id: 2, customerName: "Arrow" };
    expect([a, b].sort(compareCustomerNotes)).toEqual([b, a]);
  });
});
