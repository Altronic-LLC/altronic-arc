import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Assigned Buyer in REAL mode — "if you go to set an assigned buyer it
// doesn't save" (2026-11-03).
//
// Two bugs, both invisible from mock mode:
//
// 1. READ. Graph returns the single-person `AssignedBuyer` column as a bare
//    `AssignedBuyerLookupId`. The mapper only understood the expanded object,
//    so a buyer that HAD saved read back as nobody and the picker snapped back
//    to "No buyer assigned".
// 2. WRITE. `ensurePersonLookupId(...)?.lookupId ?? null` PATCHed `null`
//    whenever `ensureuser` couldn't answer — SharePoint accepts that, so the
//    column was cleared with no error. It now resolves Graph-first and refuses.
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
    USE_MOCK: false,
    SP_SUPPLIERS_LIST_ID: "suppliers-list",
    SP_PMO_SITE_URL: "https://example.sharepoint.com/sites/PMO",
  };
});

import { getSupplier, listSuppliers, updateSupplierAssignedBuyer } from "./suppliers";
import { resetSiteUserDirectoryCache } from "./siteUsers";

/** The PMO site's User Information List: Glenn is user 21 there. */
const DIRECTORY = [
  { id: "21", fields: { Title: "Glenn Terry", EMail: "glenn.terry@altronic-llc.com" } },
];

function routeFetchAll(listRows: unknown[]) {
  graphFetchAll.mockImplementation(async (url: string) =>
    url.includes("User%20Information%20List") ? DIRECTORY : listRows,
  );
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  spFetch.mockReset();
  resetSiteUserDirectoryCache();
});

describe("Assigned Buyer — read", () => {
  it("reads a bare AssignedBuyerLookupId as the person, named from the site directory", async () => {
    routeFetchAll([{ id: "7", fields: { Title: "Acme", AssignedBuyerLookupId: "21" } }]);
    const [supplier] = await listSuppliers();
    expect(supplier.assignedBuyer).toMatchObject({
      displayName: "Glenn Terry",
      email: "glenn.terry@altronic-llc.com",
      lookupId: 21,
    });
  });

  it("shows an id nobody answers for as User #n, never as unassigned", async () => {
    routeFetchAll([{ id: "7", fields: { Title: "Acme", AssignedBuyerLookupId: 99 } }]);
    const [supplier] = await listSuppliers();
    expect(supplier.assignedBuyer?.displayName).toBe("User #99");
  });

  it("still loads the list when the directory read is refused", async () => {
    graphFetchAll.mockImplementation(async (url: string) => {
      if (url.includes("User%20Information%20List")) throw new Error("Graph 403");
      return [{ id: "7", fields: { Title: "Acme", AssignedBuyerLookupId: 21 } }];
    });
    const [supplier] = await listSuppliers();
    expect(supplier.assignedBuyer?.displayName).toBe("User #21");
  });
});

describe("Assigned Buyer — write", () => {
  it("writes the PMO-site lookupId as a bare integer and reads the buyer back", async () => {
    routeFetchAll([]);
    graphFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return {};
      return { id: "7", fields: { Title: "Acme", AssignedBuyerLookupId: "21" } };
    });

    const updated = await updateSupplierAssignedBuyer(7, {
      displayName: "Glenn Terry",
      email: "glenn.terry@altronic-llc.com",
      // An Engineering-site id — must be re-resolved, never sent.
      lookupId: 88,
    });

    const patch = graphFetch.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(patch![1].body)).toEqual({
      AssignedBuyerLookupId: 21,
      // The buyer becomes a watcher in the SAME write.
      "WatchersLookupId@odata.type": "Collection(Edm.Int32)",
      WatchersLookupId: [21],
    });
    expect(updated.assignedBuyer?.displayName).toBe("Glenn Terry");
  });

  it("keeps the watchers already on the supplier when the buyer is added", async () => {
    graphFetchAll.mockImplementation(async (url: string) =>
      url.includes("User%20Information%20List")
        ? [
            ...DIRECTORY,
            { id: "34", fields: { Title: "Katie Fleming", EMail: "katie.fleming@altronic-llc.com" } },
          ]
        : [],
    );
    graphFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return {};
      return {
        id: "7",
        fields: {
          Title: "Acme",
          Watchers: [{ LookupId: 34, LookupValue: "Katie Fleming", Email: "katie.fleming@altronic-llc.com" }],
        },
      };
    });

    await updateSupplierAssignedBuyer(7, {
      displayName: "Glenn Terry",
      email: "glenn.terry@altronic-llc.com",
    });

    const patch = graphFetch.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect([...JSON.parse(patch![1].body).WatchersLookupId].sort()).toEqual([21, 34]);
  });

  it("REFUSES rather than clearing the column when the person can't be resolved", async () => {
    routeFetchAll([]);
    spFetch.mockRejectedValue(new Error("SharePoint scope not granted"));

    await expect(
      updateSupplierAssignedBuyer(7, { displayName: "New Starter", email: "new.starter@altronic-llc.com" }),
    ).rejects.toThrow(/Couldn't set Assigned Buyer to New Starter/);
    expect(graphFetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("clears the buyer when nobody is picked, and leaves the watchers alone", async () => {
    routeFetchAll([]);
    graphFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH" ? {} : { id: "7", fields: { Title: "Acme" } },
    );
    const updated = await updateSupplierAssignedBuyer(7, null);
    const patch = graphFetch.mock.calls.find(([, init]) => init?.method === "PATCH");
    // No Watchers key: unassigning never takes anybody off the watch list.
    expect(JSON.parse(patch![1].body)).toEqual({ AssignedBuyerLookupId: null });
    expect(updated.assignedBuyer).toBeNull();
  });

  it("a failed re-read after the PATCH is reported as itself, not 'disappeared'", async () => {
    routeFetchAll([]);
    graphFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return {};
      throw new Error("Graph 429 Too Many Requests");
    });
    await expect(getSupplier(7)).rejects.toThrow(/429/);
  });
});
