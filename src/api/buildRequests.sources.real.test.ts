import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// The "raised from" link columns (BusinessIT#68/#69/#65), in REAL mode.
//
// None of this is visible from the mock branch, which reads `input` directly:
//
//  - EIRReference / FAITReference are SINGLE lookups — a bare integer, never
//    multiLookupField's Collection(Edm.Int32) shape, which 400s the create.
//  - GrayMarketRequestId is a plain NUMBER column (another site collection).
//  - The columns are added by a script that runs separately from the deploy.
//    Selecting a column the list hasn't got 400s the WHOLE read, so the read
//    must fall back without them — and so must a create, rather than leave
//    the person with no build request at all.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => {
  class GraphError extends Error {
    constructor(
      public status: number,
      public statusText = "",
      public body = "",
      public url = "",
    ) {
      super(`Graph ${status}`);
    }
  }
  return {
    graphFetch,
    graphFetchAll,
    GraphError,
    SessionExpiredError: class SessionExpiredError extends Error {},
  };
});

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SP_BUILD_REQUESTS_LIST_ID: "br-list",
    SP_SITE_URL: "https://example.sharepoint.com/sites/Eng",
  };
});

vi.mock("./tasks", () => ({ listProjects: vi.fn(async () => []) }));
vi.mock("./eirs", () => ({ listSiteUsers: vi.fn(async () => []) }));

import { GraphError } from "./graph";
import {
  __resetBuildRequestSourceColumns,
  buildRequestSourceColumnsAvailable,
  createBuildRequest,
  listBuildRequests,
  setBuildRequestSourceLink,
} from "./buildRequests";

const BASE = { title: "Coil trial", brNo: "BR_2026-1100", taskReferenceLookupId: 15 };

function posts(): Record<string, unknown>[] {
  return graphFetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)).fields);
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  __resetBuildRequestSourceColumns();
});

describe("writing the link", () => {
  beforeEach(() => {
    graphFetch.mockImplementation(async (_url: string, init: RequestInit) => ({
      id: "500",
      createdDateTime: "2026-11-23T12:00:00Z",
      lastModifiedDateTime: "2026-11-23T12:00:00Z",
      fields: JSON.parse(String(init.body)).fields,
    }));
  });

  it("writes an EIR as a bare-integer single lookup", async () => {
    const br = await createBuildRequest({ ...BASE, eirReferenceLookupId: 42 });
    const [fields] = posts();
    expect(fields.EIRReferenceLookupId).toBe(42);
    expect(fields).not.toHaveProperty("EIRReferenceLookupId@odata.type");
    expect(br.eirReferenceLookupId).toBe(42);
  });

  it("writes a FAIT as a bare-integer single lookup", async () => {
    await createBuildRequest({ ...BASE, faitReferenceLookupId: 7 });
    expect(posts()[0].FAITReferenceLookupId).toBe(7);
  });

  it("writes a Gray Market request as a plain number", async () => {
    const br = await createBuildRequest({ ...BASE, grayMarketRequestId: 207 });
    expect(posts()[0].GrayMarketRequestId).toBe(207);
    expect(br.grayMarketRequestId).toBe(207);
  });

  it("sends no link column when the request isn't raised from anything", async () => {
    await createBuildRequest(BASE);
    const [fields] = posts();
    expect(fields).not.toHaveProperty("EIRReferenceLookupId");
    expect(fields).not.toHaveProperty("FAITReferenceLookupId");
    expect(fields).not.toHaveProperty("GrayMarketRequestId");
  });
});

describe("before the columns exist", () => {
  it("a create refused with a 400 is sent again WITHOUT the link, once", async () => {
    graphFetch
      .mockRejectedValueOnce(new GraphError(400, "", "", ""))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => ({
        id: "501",
        createdDateTime: "2026-11-23T12:00:00Z",
        lastModifiedDateTime: "2026-11-23T12:00:00Z",
        fields: JSON.parse(String(init.body)).fields,
      }));
    const br = await createBuildRequest({ ...BASE, eirReferenceLookupId: 42 });
    const sent = posts();
    expect(sent).toHaveLength(2);
    expect(sent[0].EIRReferenceLookupId).toBe(42);
    expect(sent[1]).not.toHaveProperty("EIRReferenceLookupId");
    // The rest of the request still went: a build request exists.
    expect(sent[1].TaskReferenceLookupId).toBe(15);
    expect(br.eirReferenceLookupId).toBeNull();
    expect(buildRequestSourceColumnsAvailable()).toBe(false);
  });

  it("anything but a 400 is NOT retried", async () => {
    graphFetch.mockRejectedValueOnce(new GraphError(403, "", "", ""));
    await expect(createBuildRequest({ ...BASE, eirReferenceLookupId: 42 })).rejects.toThrow();
    expect(posts()).toHaveLength(1);
  });

  it("the read falls back without the columns on a 400, and remembers", async () => {
    graphFetchAll
      .mockRejectedValueOnce(new GraphError(400, "", "", ""))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await listBuildRequests();
    await listBuildRequests();
    const urls = graphFetchAll.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain("EIRReferenceLookupId");
    expect(urls[1]).not.toContain("EIRReferenceLookupId");
    // Remembered: the second read doesn't ask again.
    expect(urls[2]).not.toContain("EIRReferenceLookupId");
    expect(buildRequestSourceColumnsAvailable()).toBe(false);
  });

  it("a throttle on the read propagates — never read as 'the columns are missing'", async () => {
    graphFetchAll.mockRejectedValueOnce(new GraphError(429, "", "", ""));
    await expect(listBuildRequests()).rejects.toThrow();
    expect(buildRequestSourceColumnsAvailable()).toBe(true);
  });
});

describe("linking an existing request", () => {
  function patches(): Record<string, unknown>[] {
    return graphFetch.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
  }

  beforeEach(() => {
    graphFetch.mockResolvedValue({});
    graphFetchAll.mockResolvedValue([
      { id: "40", createdDateTime: "2026-11-23T12:00:00Z", lastModifiedDateTime: "2026-11-23T12:00:00Z", fields: {} },
    ]);
  });

  it("PATCHes a bare integer to link, and null to unlink", async () => {
    await setBuildRequestSourceLink(40, "fait", 12);
    await setBuildRequestSourceLink(40, "grayMarket", null);
    expect(patches()).toEqual([{ FAITReferenceLookupId: 12 }, { GrayMarketRequestId: null }]);
  });

  it("is refused, naming the script, once the columns are known to be missing", async () => {
    graphFetchAll.mockReset();
    graphFetchAll.mockRejectedValueOnce(new GraphError(400, "", "", "")).mockResolvedValue([]);
    await listBuildRequests();
    await expect(setBuildRequestSourceLink(40, "eir", 3)).rejects.toThrow(/add-build-request-source-columns/);
    expect(patches()).toHaveLength(0);
  });
});
