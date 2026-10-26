import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// The Parts List's narrow reads, in REAL mode — one list's rows, one row, and
// the one-row "does SharePoint hand this account anything" check. They exist
// so a list screen and a part's page don't download ~14,000 rows; the request
// shapes are what matter, and the mock branch can't show them:
//  - one list = a startswith filter on the INDEXED Title, quoted through
//    odataString, one request per list, never $orderby;
//  - a component category reads each of its lists, de-duped;
//  - a missing Communication column degrades, as on the whole read;
//  - a part that isn't there is null, anything else propagates.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const FakeGraphError = vi.hoisted(
  () =>
    class GraphError extends Error {
      constructor(
        public status: number,
        public statusText = "",
        public body = "",
        public url = "",
      ) {
        super(`Graph ${status}`);
      }
    },
);

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: FakeGraphError,
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, engineering: "engineering-site" },
    SP_ALTRONIC_PART_LIST_ID: "part-list",
    SP_ALTRONIC_COMPONENT_LIST_ID: "component-list",
  };
});

import { altronicPartListHasRows, findAltronicPart, listAltronicPartsInLists } from "./altronicParts";
import { listAltronicComponentsInLists } from "./altronicComponents";
import { __resetPartsListShared, communicationAvailable } from "./partsListShared";

function item(id: string, fields: Record<string, unknown>) {
  return {
    id,
    createdDateTime: "2026-09-28T14:00:00Z",
    lastModifiedDateTime: "2026-09-28T14:00:00Z",
    createdBy: { user: { displayName: "Brandon Mirto", email: "Brandon.Mirto@altronic-llc.com" } },
    fields,
  };
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  __resetPartsListShared();
});

describe("listAltronicPartsInLists — one list, without the whole Part List", () => {
  it("filters on the indexed Title with startswith, quoted, and pages", async () => {
    graphFetchAll.mockResolvedValue([item("1263", { Title: "309032" }), item("1262", { Title: "309027" })]);
    const rows = await listAltronicPartsInLists(["309"]);
    expect(graphFetchAll).toHaveBeenCalledTimes(1);
    const url = String(graphFetchAll.mock.calls[0][0]);
    expect(url).toContain("/sites/engineering-site/lists/part-list/items?");
    expect(url).toContain("$filter=startswith(fields/Title,'309')");
    expect(url).toContain("$top=999");
    expect(url).not.toContain("$orderby");
    expect(url).toContain("Communication");
    // In part-number order, whatever order SharePoint sent.
    expect(rows.map((p) => p.partNumber)).toEqual(["309027", "309032"]);
  });

  it("keeps only rows whose number is really on that list", async () => {
    // startswith reads the raw Title; the screens group by the first three
    // DIGITS, so a Title like "309" alone or " 3091" mustn't slip in wrongly.
    graphFetchAll.mockResolvedValue([item("1", { Title: "309027" }), item("2", { Title: "30" })]);
    const rows = await listAltronicPartsInLists(["309"]);
    expect(rows.map((p) => p.partNumber)).toEqual(["309027"]);
  });

  it("retries once without Communication when the column is missing", async () => {
    graphFetchAll
      .mockRejectedValueOnce(new FakeGraphError(400))
      .mockResolvedValueOnce([item("1", { Title: "309027" })]);
    const rows = await listAltronicPartsInLists(["309"]);
    expect(rows).toHaveLength(1);
    expect(String(graphFetchAll.mock.calls[1][0])).not.toContain("Communication");
    expect(communicationAvailable("part-list")).toBe(false);
  });

  it("doesn't read a throttle as a missing column", async () => {
    graphFetchAll.mockRejectedValue(new FakeGraphError(429));
    await expect(listAltronicPartsInLists(["309"])).rejects.toThrow("Graph 429");
    expect(graphFetchAll).toHaveBeenCalledTimes(1);
    expect(communicationAvailable("part-list")).toBe(true);
  });
});

describe("listAltronicComponentsInLists — a component category", () => {
  it("reads each of the category's lists and de-dupes", async () => {
    graphFetchAll.mockImplementation(async (url: string) => {
      if (url.includes("'701'")) return [item("10", { Title: "701001" })];
      if (url.includes("'711'")) return [item("11", { Title: "711001" }), item("10", { Title: "701001" })];
      return [item("12", { Title: "712001" })];
    });
    const rows = await listAltronicComponentsInLists(["701", "711", "712"]);
    expect(graphFetchAll).toHaveBeenCalledTimes(3);
    for (const call of graphFetchAll.mock.calls) {
      expect(String(call[0])).toContain("/lists/component-list/items?");
    }
    expect(rows.map((c) => c.partNumber)).toEqual(["701001", "711001", "712001"]);
  });
});

describe("findAltronicPart — one row for a part's page", () => {
  it("reads the one item, with the columns the mapper reads", async () => {
    graphFetch.mockResolvedValue(item("1262", { Title: "309027", SignOffStatus: "Approved" }));
    const part = await findAltronicPart(1262);
    expect(String(graphFetch.mock.calls[0][0])).toContain("/lists/part-list/items/1262?");
    expect(part?.partNumber).toBe("309027");
    expect(graphFetchAll).not.toHaveBeenCalled();
  });

  it("is null when SharePoint says the part isn't there", async () => {
    graphFetch.mockRejectedValue(new FakeGraphError(404));
    expect(await findAltronicPart(99)).toBeNull();
  });

  it("propagates anything else — a refusal is not 'no such part'", async () => {
    graphFetch.mockRejectedValue(new FakeGraphError(403));
    await expect(findAltronicPart(99)).rejects.toThrow("Graph 403");
  });

  it("retries once without Communication when the column is missing", async () => {
    graphFetch
      .mockRejectedValueOnce(new FakeGraphError(400))
      .mockResolvedValueOnce(item("1262", { Title: "309027" }));
    expect((await findAltronicPart(1262))?.partNumber).toBe("309027");
    expect(String(graphFetch.mock.calls[1][0])).not.toContain("Communication");
  });
});

describe("altronicPartListHasRows — the one-row check", () => {
  it("asks for one id and nothing else", async () => {
    graphFetch.mockResolvedValue({ value: [{ id: "1" }] });
    expect(await altronicPartListHasRows()).toBe(true);
    const url = String(graphFetch.mock.calls[0][0]);
    expect(url).toContain("$select=id&$top=1");
    expect(url).not.toContain("$filter");
  });

  it("is false when SharePoint hands back nothing", async () => {
    graphFetch.mockResolvedValue({ value: [] });
    expect(await altronicPartListHasRows()).toBe(false);
  });
});
