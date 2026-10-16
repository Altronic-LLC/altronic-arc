import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Pricing Requests in REAL mode: the request shapes.
//
// Mock mode never builds a request, so none of this is visible from it. This
// file forces `USE_MOCK: false` and asserts what goes over the wire:
//   - PR-YYYY-#### from a FRESH Title read, highest + 1;
//   - one renumber-and-retry, ONLY on a unique-value refusal, ONLY when the
//     fresh number differs;
//   - RequestedByLookupId is a BARE integer resolved on the SALES site, never
//     the caller's (Engineering) lookupId; unresolvable refuses the create;
//   - Watchers use the two-key Collection(Edm.Int32) shape;
//   - edits are diffed, and PricedByLookupId rides in the same PATCH as Status.
//
// Config is mocked explicitly — a test must not depend on VITE_* being set.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const resolveSiteUserLookupId = vi.hoisted(() => vi.fn());
const resolvePeopleLookupIds = vi.hoisted(() => vi.fn());
const listSiteUserDirectory = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./siteUsers", () => ({ resolveSiteUserLookupId, resolvePeopleLookupIds, listSiteUserDirectory }));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, salesTeam: "sales-site" },
    SP_SALESTEAM_SITE_URL: "https://example.sharepoint.com/sites/ALTRONICSALESTEAM",
    SP_PRICING_REQUESTS_LIST_ID: "requests-list",
  };
});

import {
  createPricingRequest,
  getPricingRequest,
  listPricingRequests,
  updatePricingRequest,
  type PricingRequestCreateInput,
} from "./pricingRequests";
import { toPricingRequest } from "@/lib/pricingMapper";
import type { GraphListItem, Person } from "@/types/task";

const SALES_URL = "https://example.sharepoint.com/sites/ALTRONICSALESTEAM";
const LIST = "/sites/sales-site/lists/requests-list/items";
const NOW = new Date(2026, 9, 13, 12, 0, 0);
const DUPLICATE = Object.assign(new Error("Graph 409 Conflict"), {
  status: 409,
  body: '{"error":{"code":"nameAlreadyExists","message":"duplicate values were found in the following field(s) in the list: [Title]"}}',
});

// The caller's Person carries an ENGINEERING lookupId (88) — it must never be
// what lands on the Sales site.
const katie: Person = { lookupId: 88, displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com" };

function input(overrides: Partial<PricingRequestCreateInput> = {}): PricingRequestCreateInput {
  return {
    status: "Submitted",
    altronicPartNumber: "791950-08",
    sapPartNumber: "1003-0114-40",
    requestedDescription: "CPU-95",
    description: "CPU-95 IGNITION",
    mpg: "IGN",
    requestedBy: katie,
    notes: "",
    customerSoldTo: "",
    customerName: "",
    customerGroup: "",
    watchers: [katie],
    ...overrides,
  };
}

function titles(...t: string[]) {
  return t.map((title, i) => ({ id: String(i + 1), fields: { Title: title } }));
}

function item(id: number, fields: Record<string, unknown> = {}) {
  return { id: String(id), fields: { Title: `PR-2026-${String(id).padStart(4, "0")}`, Status: "Submitted", ...fields } };
}

function posts() {
  return graphFetch.mock.calls.filter(([, init]) => init?.method === "POST");
}
function patches() {
  return graphFetch.mock.calls.filter(([, init]) => init?.method === "PATCH");
}
function bodyOf(call: unknown[]) {
  return JSON.parse((call[1] as RequestInit).body as string);
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  resolveSiteUserLookupId.mockReset();
  resolvePeopleLookupIds.mockReset();
  listSiteUserDirectory.mockReset();
  listSiteUserDirectory.mockResolvedValue(new Map());
  resolveSiteUserLookupId.mockResolvedValue(512);
  resolvePeopleLookupIds.mockImplementation(async (_s: string, _u: string, people: Person[]) =>
    people.map((p) => ({ ...p, lookupId: 512 })),
  );
  graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") return { id: "77", fields: {} };
    if (init?.method === "PATCH") return {};
    const m = /\/items\/(\d+)\?/.exec(path);
    if (m) return item(Number(m[1]));
    throw new Error(`unexpected GET ${path}`);
  });
});

describe("createPricingRequest — numbering", () => {
  it("numbers from a FRESH Title read: the highest this year + 1, ignoring other years and prefixes", async () => {
    graphFetchAll.mockResolvedValue(titles("PR-2026-0007", "PR-2026-0012", "PR-2025-0099", "NP-2026-0050", "junk"));
    await createPricingRequest(input(), NOW);
    expect(graphFetchAll.mock.calls[0][0]).toContain(`${LIST}?$expand=fields($select=Title)`);
    expect(bodyOf(posts()[0]).fields.Title).toBe("PR-2026-0013");
  });

  it("starts at 0001 on an empty year", async () => {
    graphFetchAll.mockResolvedValue(titles("PR-2025-0099"));
    await createPricingRequest(input(), NOW);
    expect(bodyOf(posts()[0]).fields.Title).toBe("PR-2026-0001");
  });

  it("on a unique-value refusal re-reads, renumbers and retries ONCE", async () => {
    graphFetchAll
      .mockResolvedValueOnce(titles("PR-2026-0004"))
      .mockResolvedValueOnce(titles("PR-2026-0004", "PR-2026-0005"));
    let n = 0;
    graphFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        n += 1;
        if (n === 1) throw DUPLICATE;
        return { id: "78", fields: {} };
      }
      return item(78);
    });
    const created = await createPricingRequest(input(), NOW);
    expect(posts().map((c) => bodyOf(c).fields.Title)).toEqual(["PR-2026-0005", "PR-2026-0006"]);
    expect(created.id).toBe(78);
  });

  it("a second refusal surfaces — there is no third attempt", async () => {
    graphFetchAll
      .mockResolvedValueOnce(titles("PR-2026-0004"))
      .mockResolvedValueOnce(titles("PR-2026-0005"));
    graphFetch.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init?.method === "POST") throw DUPLICATE;
      return {};
    });
    await expect(createPricingRequest(input(), NOW)).rejects.toBe(DUPLICATE);
    expect(posts()).toHaveLength(2);
  });

  it("does NOT retry when the fresh read yields the same number", async () => {
    graphFetchAll.mockResolvedValue(titles("PR-2026-0004"));
    graphFetch.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init?.method === "POST") throw DUPLICATE;
      return {};
    });
    await expect(createPricingRequest(input(), NOW)).rejects.toBe(DUPLICATE);
    expect(posts()).toHaveLength(1);
    expect(graphFetchAll).toHaveBeenCalledTimes(2);
  });

  it("any other error surfaces unchanged, with no re-read and no retry", async () => {
    const boom = Object.assign(new Error("Graph 400 Bad Request"), { status: 400, body: "invalidRequest" });
    graphFetchAll.mockResolvedValue(titles());
    graphFetch.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init?.method === "POST") throw boom;
      return {};
    });
    await expect(createPricingRequest(input(), NOW)).rejects.toBe(boom);
    expect(posts()).toHaveLength(1);
    expect(graphFetchAll).toHaveBeenCalledTimes(1);
  });

  it("a 409 resourceModified is NOT a unique-value refusal", async () => {
    const conflict = Object.assign(new Error("Graph 409"), { status: 409, body: '{"error":{"code":"resourceModified"}}' });
    graphFetchAll.mockResolvedValue(titles());
    graphFetch.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init?.method === "POST") throw conflict;
      return {};
    });
    await expect(createPricingRequest(input(), NOW)).rejects.toBe(conflict);
    expect(posts()).toHaveLength(1);
  });
});

describe("createPricingRequest — people", () => {
  beforeEach(() => {
    graphFetchAll.mockResolvedValue(titles());
  });

  it("writes RequestedByLookupId as a BARE integer resolved on the SALES site — not the caller's id", async () => {
    await createPricingRequest(input(), NOW);
    expect(resolveSiteUserLookupId).toHaveBeenCalledWith("sales-site", SALES_URL, "katie.fleming@altronic-llc.com");
    const fields = bodyOf(posts()[0]).fields;
    expect(fields.RequestedByLookupId).toBe(512);
    expect(fields).not.toHaveProperty("RequestedByLookupId@odata.type");
    expect(fields).not.toHaveProperty("RequestedBy");
  });

  it("REFUSES the create, with no POST, when the requester can't be resolved", async () => {
    resolveSiteUserLookupId.mockResolvedValue(0);
    await expect(createPricingRequest(input(), NOW)).rejects.toThrow(/Requested By/);
    expect(posts()).toHaveLength(0);
  });

  it("writes Watchers in the two-key Collection(Edm.Int32) shape, resolved on the Sales site", async () => {
    await createPricingRequest(input(), NOW);
    expect(resolvePeopleLookupIds).toHaveBeenCalledWith("sales-site", SALES_URL, [katie]);
    const fields = bodyOf(posts()[0]).fields;
    expect(fields["WatchersLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
    expect(fields.WatchersLookupId).toEqual([512]);
  });

  it("re-reads the created item afterwards", async () => {
    const created = await createPricingRequest(input(), NOW);
    expect(graphFetch.mock.calls.some(([p]) => String(p).startsWith(`${LIST}/77?`))).toBe(true);
    expect(created.id).toBe(77);
  });
});

describe("updatePricingRequest — diffed", () => {
  const previous = toPricingRequest(
    item(5, { Status: "Submitted", Description: "OLD", ListPrice: 100, AltronicPartNumber: "791950-08" }) as unknown as GraphListItem,
  );

  it("sends ONLY the columns that changed", async () => {
    await updatePricingRequest(5, { description: "NEW", listPrice: 100, altronicPartNumber: "791950-08" }, previous);
    expect(patches()).toHaveLength(1);
    expect(patches()[0][0]).toBe(`${LIST}/5/fields`);
    expect(bodyOf(patches()[0])).toEqual({ Description: "NEW" });
  });

  it("sends NOTHING when nothing changed, and returns the previous row", async () => {
    const out = await updatePricingRequest(5, { description: "OLD", listPrice: 100, status: "Submitted" }, previous);
    expect(graphFetch).not.toHaveBeenCalled();
    expect(out).toBe(previous);
  });

  it("PricedByLookupId travels in the SAME PATCH as Status, as a bare integer on the Sales site", async () => {
    resolveSiteUserLookupId.mockResolvedValue(901);
    const brandon: Person = { lookupId: 3, displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com" };
    await updatePricingRequest(5, { status: "Priced", listPrice: 250 }, previous, { pricedBy: brandon });
    expect(resolveSiteUserLookupId).toHaveBeenCalledWith("sales-site", SALES_URL, "brandon.mirto@altronic-llc.com");
    expect(patches()).toHaveLength(1);
    expect(bodyOf(patches()[0])).toEqual({ Status: "Priced", ListPrice: 250, PricedByLookupId: 901 });
  });

  it("refuses rather than clearing PricedBy when the pricer can't be resolved", async () => {
    resolveSiteUserLookupId.mockResolvedValue(0);
    await expect(
      updatePricingRequest(5, { status: "Priced" }, previous, {
        pricedBy: { lookupId: 3, displayName: "X", email: "x@altronic-llc.com" },
      }),
    ).rejects.toThrow(/Priced By/);
    expect(patches()).toHaveLength(0);
  });

  it("a deliberate null clears PricedBy", async () => {
    await updatePricingRequest(5, {}, previous, { pricedBy: null });
    expect(bodyOf(patches()[0])).toEqual({ PricedByLookupId: null });
  });
});

describe("reads", () => {
  it("the list $select carries BOTH halves of every single-person column", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listPricingRequests();
    const path = String(graphFetchAll.mock.calls[0][0]);
    for (const col of ["RequestedBy", "RequestedByLookupId", "PricedBy", "PricedByLookupId", "AddedToSapByLookupId"]) {
      expect(path).toMatch(new RegExp(`[(,]${col}[,)]`));
    }
    expect(listSiteUserDirectory).toHaveBeenCalledWith("sales-site");
  });

  it("fills a bare RequestedByLookupId from the Sales directory, and an unknown one reads User #n", async () => {
    listSiteUserDirectory.mockResolvedValue(
      new Map([[512, { lookupId: 512, displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com" }]]),
    );
    graphFetchAll.mockResolvedValue([item(1, { RequestedByLookupId: "512" }), item(2, { RequestedByLookupId: "999" })]);
    const rows = await listPricingRequests();
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(1)?.requestedBy?.displayName).toBe("Katie Fleming");
    expect(byId.get(2)?.requestedBy?.displayName).toBe("User #999");
  });

  it("getPricingRequest returns null on a 404", async () => {
    graphFetch.mockRejectedValue(Object.assign(new Error("Graph 404 Not Found"), { status: 404 }));
    await expect(getPricingRequest(9)).resolves.toBeNull();
  });

  it("getPricingRequest propagates anything else", async () => {
    const boom = Object.assign(new Error("Graph 503"), { status: 503 });
    graphFetch.mockRejectedValue(boom);
    await expect(getPricingRequest(9)).rejects.toBe(boom);
  });
});
