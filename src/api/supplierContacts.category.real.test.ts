import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Contact Category (BusinessIT#80) in REAL mode — invisible from the mock
// branch. The column comes from scripts/add-supplier-contact-columns.ps1,
// which runs separately from any deploy, so a list without it must still
// load: selecting a missing column 400s the whole read.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => {
  class GraphError extends Error {
    constructor(
      public status: number,
      message = `Graph ${status}`,
    ) {
      super(message);
    }
  }
  return { graphFetch, graphFetchAll, GraphError, SessionExpiredError: class extends Error {} };
});

vi.mock("./siteUsers", () => ({ ensureLookupIds: vi.fn(async (_url: string, people: unknown[]) => people) }));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, SP_SUPPLIER_CONTACTS_LIST_ID: "contacts-list" };
});

import { GraphError } from "./graph";
import {
  __resetSupplierContactCategoryColumn,
  createSupplierContact,
  listSupplierContactCategoryChoices,
  listSupplierContacts,
  supplierContactCategoryAvailable,
  updateSupplierContactFields,
} from "./supplierContacts";
import { SUPPLIER_CONTACT_CATEGORIES, type SupplierContactInput } from "@/types/task";

const ROW = { id: "7", fields: { Title: "", Email: "q@acme.com", ContactCategory: "Quality", BPReferenceLookupId: "25" } };

const INPUT: SupplierContactInput = {
  name: "",
  firstName: "",
  lastName: "",
  supplierId: 25,
  email: "q@acme.com",
  phone: "",
  status: null,
  category: "Quality",
  contactNotes: "",
  watchers: [],
};

const missingColumn = () => new (GraphError as unknown as new (s: number) => Error)(400);

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  __resetSupplierContactCategoryColumn();
});

describe("Contact Category (real mode)", () => {
  it("reads ContactCategory with the list", async () => {
    graphFetchAll.mockResolvedValue([ROW]);
    const [contact] = await listSupplierContacts();
    expect(contact.category).toBe("Quality");
    expect(graphFetchAll.mock.calls[0][0]).toContain(",ContactCategory)");
  });

  it("still loads the list when the column doesn't exist yet, and remembers", async () => {
    graphFetchAll.mockRejectedValueOnce(missingColumn()).mockResolvedValue([ROW]);
    const contacts = await listSupplierContacts();
    expect(contacts).toHaveLength(1);
    expect(graphFetchAll.mock.calls[1][0]).not.toContain("ContactCategory");
    expect(supplierContactCategoryAvailable()).toBe(false);

    // Remembered: the next read doesn't ask again.
    await listSupplierContacts();
    expect(graphFetchAll).toHaveBeenCalledTimes(3);
    expect(graphFetchAll.mock.calls[2][0]).not.toContain("ContactCategory");
  });

  it("does not read a throttle or refusal as a missing column", async () => {
    graphFetchAll.mockRejectedValue(new (GraphError as unknown as new (s: number) => Error)(403));
    await expect(listSupplierContacts()).rejects.toThrow();
    expect(graphFetchAll).toHaveBeenCalledTimes(1);
    expect(supplierContactCategoryAvailable()).toBe(true);
  });

  it("writes the category as a plain string, and null to clear it", async () => {
    graphFetch.mockResolvedValue(ROW);
    await updateSupplierContactFields(7, { category: "Accounting" });
    expect(JSON.parse(graphFetch.mock.calls[0][1].body)).toEqual({ ContactCategory: "Accounting" });
    await updateSupplierContactFields(7, { category: null });
    expect(JSON.parse(graphFetch.mock.calls[2][1].body)).toEqual({ ContactCategory: null });
  });

  it("creates with the category, and leaves it out of the POST when blank", async () => {
    graphFetch.mockResolvedValue(ROW);
    await createSupplierContact(INPUT);
    expect(JSON.parse(graphFetch.mock.calls[0][1].body).fields.ContactCategory).toBe("Quality");

    graphFetch.mockClear();
    await createSupplierContact({ ...INPUT, category: null });
    expect(JSON.parse(graphFetch.mock.calls[0][1].body).fields).not.toHaveProperty("ContactCategory");
  });

  it("refuses a category write while the column is missing, naming the script", async () => {
    graphFetchAll.mockRejectedValueOnce(missingColumn()).mockResolvedValue([ROW]);
    await listSupplierContacts();
    await expect(updateSupplierContactFields(7, { category: "Quality" })).rejects.toThrow(
      /add-supplier-contact-columns\.ps1/,
    );
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it("offers the column's live choices, the built-in three as the fallback", async () => {
    graphFetch.mockResolvedValueOnce({
      value: [{ name: "ContactCategory", choice: { choices: ["Quality", "Accounting", "Customer Service", "Sales"] } }],
    });
    await expect(listSupplierContactCategoryChoices()).resolves.toEqual([
      "Quality",
      "Accounting",
      "Customer Service",
      "Sales",
    ]);
    graphFetch.mockRejectedValueOnce(new Error("Graph 403"));
    await expect(listSupplierContactCategoryChoices()).resolves.toEqual([...SUPPLIER_CONTACT_CATEGORIES]);
  });
});
