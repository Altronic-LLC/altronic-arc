import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Quotes' ProjectFolder column, in REAL mode (Ray, 2026-11-24).
//
// The column was added after the list was live. Selecting a column the list
// hasn't got 400s the WHOLE read, which would make every quote vanish — so the
// read asks for it and, on a 400 only, retries without and remembers. A write
// naming it is then refused, naming the script. Invisible from mock mode.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => {
  class GraphError extends Error {
    constructor(
      public status: number,
      public statusText: string,
      public body: string,
      public url: string,
    ) {
      super(`Graph ${status}`);
    }
  }
  return { graphFetch, graphFetchAll, GraphError };
});

vi.mock("./siteUsers", () => ({
  resolvePeopleLookupIds: vi.fn(async (_s: string, _u: string, p: unknown) => p),
  resolveSiteUserLookupId: vi.fn(),
  listSiteUserDirectory: vi.fn(async () => new Map()),
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, pmo: "pmo-site" },
    SP_QUOTES_LIST_ID: "quotes-list",
  };
});

import { GraphError } from "./graph";
import {
  __resetQuoteFolderColumn,
  listQuotes,
  quoteFolderColumnAvailable,
  updateQuoteFields,
} from "./quotes";
import { toQuote } from "@/lib/quoteMapper";

const ITEM = {
  id: "7",
  createdDateTime: "2026-11-24T12:00:00Z",
  lastModifiedDateTime: "2026-11-24T12:00:00Z",
  fields: { Title: "IQ-COO-0042-R1", QuoteBase: "IQ-COO-0042", Rev: 1, ProjectFolder: " IQ-COO-0042 Job " },
};
const bad = () => new GraphError(400, "Bad Request", "", "");

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  __resetQuoteFolderColumn();
});

describe("Quotes — ProjectFolder column", () => {
  it("selects ProjectFolder and reads it trimmed", async () => {
    graphFetchAll.mockResolvedValueOnce([ITEM]);
    const [q] = await listQuotes();
    expect(graphFetchAll.mock.calls[0][0]).toMatch(/,ProjectFolder\)/);
    expect(q.projectFolder).toBe("IQ-COO-0042 Job");
  });

  it("a 400 retries WITHOUT the column, so the quotes still load, and remembers", async () => {
    graphFetchAll.mockRejectedValueOnce(bad()).mockResolvedValueOnce([ITEM]).mockResolvedValueOnce([ITEM]);
    expect(await listQuotes()).toHaveLength(1);
    expect(graphFetchAll.mock.calls[1][0]).not.toMatch(/ProjectFolder/);
    expect(quoteFolderColumnAvailable()).toBe(false);
    await listQuotes();
    expect(graphFetchAll).toHaveBeenCalledTimes(3);
    expect(graphFetchAll.mock.calls[2][0]).not.toMatch(/ProjectFolder/);
  });

  it("anything but a 400 propagates", async () => {
    graphFetchAll.mockRejectedValueOnce(new GraphError(503, "Unavailable", "", ""));
    await expect(listQuotes()).rejects.toThrow("Graph 503");
    expect(quoteFolderColumnAvailable()).toBe(true);
  });

  it("a write sends ProjectFolder as plain text", async () => {
    graphFetchAll.mockResolvedValueOnce([ITEM]);
    await listQuotes();
    graphFetch.mockResolvedValueOnce({}).mockResolvedValueOnce(ITEM);
    await updateQuoteFields(7, { projectFolder: "New name" }, toQuote(ITEM));
    const [url, init] = graphFetch.mock.calls[0];
    expect(url).toMatch(/\/items\/7\/fields$/);
    expect(JSON.parse(init.body)).toEqual({ ProjectFolder: "New name" });
  });

  it("refuses a folder write while the column is missing, naming the script", async () => {
    graphFetchAll.mockRejectedValueOnce(bad()).mockResolvedValueOnce([ITEM]);
    await listQuotes();
    await expect(updateQuoteFields(7, { projectFolder: "X" }, toQuote(ITEM))).rejects.toThrow(
      /create-quote-lists\.ps1/,
    );
    expect(graphFetch).not.toHaveBeenCalled();
  });
});
