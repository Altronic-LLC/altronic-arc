import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// `BPReference` in REAL mode — the reason supplier contacts "weren't showing
// up" (Ray, 2026-09-09).
//
// Supplier Contacts and Supplier Issues each hang off Suppliers List through
// `BPReference`, a SINGLE lookup. Graph returns a single-value lookup as a
// bare `<Name>LookupId` — NOT as the expanded friendly-name object — so the
// id only arrives if the read asks for that column by name.
//
// Both reads asked for `BPReference` alone. The mappers read
// `BPReferenceLookupId`, which therefore never arrived, so every contact and
// every issue mapped to `supplierId: null` and
// `contacts.filter(c => c.supplierId === supplier.id)` on the supplier detail
// page matched NOTHING. The rows and their lookups were fine the whole time —
// live samples carry 353, 496, 476 — the read simply never requested the
// column it maps.
//
// Asserted at the request level: the `$select` IS the bug, and none of it is
// visible from mock mode (which is why supplierContacts.test.ts passed
// throughout) or from a rendered page.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const spFetch = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./sharepoint", () => ({
  spFetch,
  SharePointUnavailableError: class SharePointUnavailableError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    // Force the REAL branch — the mock branch is what hid this.
    USE_MOCK: false,
    SP_SUPPLIERS_LIST_ID: "suppliers-list",
    SP_SUPPLIER_CONTACTS_LIST_ID: "contacts-list",
    SP_SUPPLIER_ISSUES_LIST_ID: "issues-list",
    SP_PMO_SITE_URL: "https://example.sharepoint.com/sites/PMO",
  };
});

import { listSupplierContacts } from "./supplierContacts";
import { listSupplierIssues } from "./supplierIssues";
import { listSuppliers } from "./suppliers";

/** The URL of the one list read that was made. */
function requestedUrl(): string {
  expect(graphFetchAll).toHaveBeenCalled();
  return String(graphFetchAll.mock.calls[0][0]);
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  spFetch.mockReset();
  // No site-user directory — irrelevant to a lookup id, and it keeps the
  // people-resolution step from needing a fixture.
  graphFetch.mockResolvedValue({ value: [] });
});

describe("supplier contacts: the BPReference lookup", () => {
  it("asks Graph for BPReferenceLookupId, not just BPReference", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listSupplierContacts();

    const url = requestedUrl();
    // The bare-id column is the one the mapper reads. Selecting only the
    // friendly name is the bug, and it is silent: Graph returns 200 with the
    // column simply absent.
    expect(url).toContain("BPReferenceLookupId");
  });

  it("maps a bare BPReferenceLookupId to supplierId — the shape Graph really sends", async () => {
    // Exactly as live sample rows come back: a bare id, as a STRING, with no
    // friendly-name envelope anywhere.
    graphFetchAll.mockResolvedValue([
      { id: "1", fields: { Email: "josh.neal@carlton-bates.com", BPReferenceLookupId: "353" } },
      { id: "2", fields: { Email: "order@wika.com", BPReferenceLookupId: "139" } },
    ]);

    const contacts = await listSupplierContacts();
    expect(contacts.map((c) => c.supplierId).sort()).toEqual([139, 353]);
  });

  it("leaves supplierId null when the row genuinely has no supplier", async () => {
    // Distinct from the bug: an unlinked row SHOULD be null, and must not
    // become 0 — which would collide with a real supplier id.
    graphFetchAll.mockResolvedValue([{ id: "3", fields: { Email: "x@y.com" } }]);
    const contacts = await listSupplierContacts();
    expect(contacts[0].supplierId).toBeNull();
  });
});

describe("supplier issues: the BPReference lookup", () => {
  it("asks Graph for BPReferenceLookupId, not just BPReference", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listSupplierIssues();
    expect(requestedUrl()).toContain("BPReferenceLookupId");
  });

  it("maps a bare BPReferenceLookupId to supplierId", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "9", fields: { Title: "Late delivery", BPReferenceLookupId: "476" } },
    ]);
    const issues = await listSupplierIssues();
    expect(issues[0].supplierId).toBe(476);
  });
});

describe("suppliers: the new columns and the single-value person halves", () => {
  it("selects PrimarySupplyFocus and PanelsOnly", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listSuppliers();

    const url = requestedUrl();
    // A column absent from the $select comes back absent, with no error — so
    // a field added to the mapper but not here reads as permanently blank.
    expect(url).toContain("PrimarySupplyFocus");
    expect(url).toContain("PanelsOnly");
  });

  it("selects both halves of AssignedBuyer and PointofContact", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listSuppliers();

    const url = requestedUrl();
    expect(url).toContain("AssignedBuyerLookupId");
    expect(url).toContain("PointofContactLookupId");
  });

  it("reads PanelsOnly as a real boolean — blank means No, not unanswered", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "1", fields: { Title: "A", PanelsOnly: true } },
      { id: "2", fields: { Title: "B" } },
    ]);

    const suppliers = await listSuppliers();
    const byTitle = new Map(suppliers.map((s) => [s.title, s]));
    expect(byTitle.get("A")?.panelsOnly).toBe(true);
    expect(byTitle.get("B")?.panelsOnly).toBe(false);
  });

  it("reads PrimarySupplyFocus unclamped, so a real value survives", async () => {
    // The column's only configured choice is the placeholder "Choice", so
    // clamping to that list would throw away whatever Supply Chain sets.
    graphFetchAll.mockResolvedValue([
      { id: "1", fields: { Title: "A", PrimarySupplyFocus: "Printed Circuit Boards" } },
    ]);
    const suppliers = await listSuppliers();
    expect(suppliers[0].primarySupplyFocus).toBe("Printed Circuit Boards");
  });
});
