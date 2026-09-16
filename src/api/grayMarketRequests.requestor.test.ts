import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Gray Market: the Requestor and Parts Location columns, in REAL mode.
//
// Both are SINGLE-value person columns, and Graph hands a single-value person
// column back as a BARE `<Name>LookupId` — no name, no email — even when the
// friendly name is in the `$select`. The read asked for the friendly names
// ALONE and `parseSinglePerson` only understands the expanded object, so both
// mapped to `null` on every row: "Requestor: Not set" on a request that
// genuinely had one (reported 2026-09-16, GMR_2026-207).
//
// This is the SAME trap CLAUDE.md documents for FAIT's three person columns,
// Supplier `BPReference`, the CMMS lists and Feature Requests' `RequestedBy`.
// Invisible from mock mode, which is why `grayMarketRequests.test.ts` passed
// throughout — hence a `USE_MOCK: false` test asserting the request shape.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const listSiteUserDirectory = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./siteUsers", () => ({
  listSiteUserDirectory,
  ensureLookupIds: vi.fn(async (_site: string, people: unknown[]) => people),
  ensurePersonLookupId: vi.fn(async (_site: string, p: unknown) => p),
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, pmo: "pmo-site" },
    SP_GRAY_MARKET_LIST_ID: "gmr-list",
    SP_PMO_SITE_URL: "https://coopermachineryservices.sharepoint.com/sites/Altronic_PMO",
  };
});

import { getGrayMarketRequest, listGrayMarketRequests } from "./grayMarketRequests";
import { GRAY_MARKET_SELECT } from "@/lib/grayMarketFields";

const ADELE = 204;
const GLENN = 88;

/** A row as the live list returns one: bare lookupIds, no expansion. */
function rawItem(fields: Record<string, unknown> = {}) {
  return {
    id: "207",
    fields: {
      Title: "1013-6279-00",
      LogNo_x002e_Raw: "GMR_2026-207",
      RequestStatus: "Open",
      RequestorLookupId: String(ADELE),
      Parts_x0020_LocationLookupId: String(GLENN),
      Created: "2026-09-16T10:00:00Z",
      Modified: "2026-09-16T10:00:00Z",
      ...fields,
    },
  };
}

function directory() {
  return new Map([
    [ADELE, { displayName: "Adele Ferguson", email: "adele.ferguson@altronic-llc.com", lookupId: ADELE }],
    [GLENN, { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com", lookupId: GLENN }],
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  listSiteUserDirectory.mockResolvedValue(directory());
});

describe("the $select", () => {
  it("asks for BOTH halves of each single-value person column", () => {
    // The friendly name alone comes back as a bare id and reads as nobody.
    expect(GRAY_MARKET_SELECT).toContain("Requestor");
    expect(GRAY_MARKET_SELECT).toContain("RequestorLookupId");
    expect(GRAY_MARKET_SELECT).toContain("Parts_x0020_Location");
    expect(GRAY_MARKET_SELECT).toContain("Parts_x0020_LocationLookupId");
  });

  it("sends that selection to Graph", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listGrayMarketRequests();
    expect(graphFetchAll.mock.calls[0][0]).toContain("RequestorLookupId");
  });
});

describe("reading the Requestor", () => {
  it("resolves a BARE lookupId to the person's name", async () => {
    graphFetchAll.mockResolvedValue([rawItem()]);

    const [request] = await listGrayMarketRequests();

    // The whole bug: this was null, so the page read "Not set".
    expect(request.requestor).not.toBeNull();
    expect(request.requestor?.displayName).toBe("Adele Ferguson");
    expect(request.requestor?.lookupId).toBe(ADELE);
  });

  it("resolves Parts Location the same way — it is a person column too", async () => {
    // Despite the name. `Parts_x0020_Location` is documented in CLAUDE.md as
    // one of the four GMR columns whose name doesn't say what they hold.
    graphFetchAll.mockResolvedValue([rawItem()]);

    const [request] = await listGrayMarketRequests();

    expect(request.partsLocation?.displayName).toBe("Glenn Terry");
  });

  it("still reads the EXPANDED object when Graph happens to send one", async () => {
    graphFetchAll.mockResolvedValue([
      rawItem({
        RequestorLookupId: undefined,
        Requestor: { LookupId: ADELE, LookupValue: "Adele Ferguson", Email: "a@x.com" },
      }),
    ]);

    const [request] = await listGrayMarketRequests();

    expect(request.requestor?.displayName).toBe("Adele Ferguson");
  });

  it("renders an UNRESOLVABLE id as 'User #n', never as empty", async () => {
    // A column that IS set must not look unset, or the next person to open
    // the request overwrites somebody's entry without knowing it was there.
    graphFetchAll.mockResolvedValue([rawItem({ RequestorLookupId: "999" })]);
    listSiteUserDirectory.mockResolvedValue(new Map());

    const [request] = await listGrayMarketRequests();

    expect(request.requestor?.displayName).toBe("User #999");
  });

  it("leaves a genuinely empty column as null", async () => {
    graphFetchAll.mockResolvedValue([
      rawItem({ RequestorLookupId: null, Parts_x0020_LocationLookupId: "" }),
    ]);

    const [request] = await listGrayMarketRequests();

    expect(request.requestor).toBeNull();
    expect(request.partsLocation).toBeNull();
  });

  it("reads the directory ONCE per load, not once per row", async () => {
    graphFetchAll.mockResolvedValue([rawItem(), rawItem({ Title: "b" }), rawItem({ Title: "c" })]);

    await listGrayMarketRequests();

    expect(listSiteUserDirectory).toHaveBeenCalledTimes(1);
  });

  it("degrades to 'User #n' rather than failing the whole load", async () => {
    // Best-effort: a throttled or refused directory read must not take the
    // list with it. Degraded names are honest; an empty screen is not.
    graphFetchAll.mockResolvedValue([rawItem()]);
    listSiteUserDirectory.mockRejectedValue(new Error("throttled"));

    const [request] = await listGrayMarketRequests();

    expect(request.logNo).toBe("GMR_2026-207");
    expect(request.requestor?.displayName).toBe(`User #${ADELE}`);
  });
});

describe("one request on its own", () => {
  it("resolves the Requestor on the detail read too", async () => {
    graphFetch.mockResolvedValue(rawItem());

    const request = await getGrayMarketRequest(207);

    expect(request?.requestor?.displayName).toBe("Adele Ferguson");
  });
});
