import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Quote Assemblies' euro target, in REAL mode (Ray, 2026-11-24).
//
// `TargetPriceEur` and `EurUsdRate` were added after the list was live. A read
// that selects a column the list hasn't got 400s the WHOLE read, which would
// blank every quote's lines — so the read asks for them and, on a 400 only,
// retries without and remembers. A write naming them while they're missing is
// refused with the script's name. None of this is visible from mock mode.
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

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, pmo: "pmo-site" },
    SP_QUOTE_ASSEMBLIES_LIST_ID: "assemblies-list",
  };
});

import { GraphError } from "./graph";
import {
  __resetQuoteAssemblyEurColumns,
  createQuoteAssembly,
  listQuoteAssemblies,
  quoteAssemblyEurColumnsAvailable,
  updateQuoteAssemblyFields,
} from "./quoteAssemblies";
import { toQuoteAssembly } from "@/lib/quoteMapper";

const ROW = {
  id: "3",
  createdDateTime: "2026-11-24T12:00:00Z",
  lastModifiedDateTime: "2026-11-24T12:00:00Z",
  fields: {
    Title: "791950-08",
    QuoteRefLookupId: "2",
    LineNo: 1,
    QuotedQty: 1,
    TargetPrice: 1050,
    TargetPriceEur: 937.5,
    EurUsdRate: 1.12,
  },
};

const BASE_INPUT = {
  quoteId: 2,
  lineNo: 1,
  quotedQty: 1,
  materialCost: 100,
  laborCost: null,
  materialOverheadPct: 18,
  altronicPartNumber: "NEW-1",
  sapPartNumber: "",
  customerPartNumber: "",
  description: "",
  priceBreaks: [],
  targetGM: 35,
  manualPrice: null,
  targetPrice: 112,
  targetPriceEur: 100,
  eurUsdRate: 1.12,
  estimatedEau: null,
  customerPrice: null,
};

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  __resetQuoteAssemblyEurColumns();
});

describe("Quote Assemblies — euro target columns", () => {
  it("selects both euro columns and maps them", async () => {
    graphFetchAll.mockResolvedValueOnce([ROW]);
    const [line] = await listQuoteAssemblies();
    expect(graphFetchAll.mock.calls[0][0]).toMatch(/TargetPriceEur,EurUsdRate/);
    expect(line).toMatchObject({ targetPrice: 1050, targetPriceEur: 937.5, eurUsdRate: 1.12 });
    expect(quoteAssemblyEurColumnsAvailable()).toBe(true);
  });

  it("a 400 retries WITHOUT the euro columns, so the lines still load, and remembers", async () => {
    graphFetchAll.mockRejectedValueOnce(new GraphError(400, "Bad Request", "", "")).mockResolvedValueOnce([ROW]).mockResolvedValueOnce([ROW]);
    const lines = await listQuoteAssemblies();
    expect(lines).toHaveLength(1);
    expect(graphFetchAll.mock.calls[1][0]).not.toMatch(/TargetPriceEur/);
    expect(quoteAssemblyEurColumnsAvailable()).toBe(false);
    // Remembered: the next read doesn't ask again.
    await listQuoteAssemblies();
    expect(graphFetchAll).toHaveBeenCalledTimes(3);
    expect(graphFetchAll.mock.calls[2][0]).not.toMatch(/TargetPriceEur/);
  });

  it("anything but a 400 propagates — a throttle never reads as 'the columns are missing'", async () => {
    graphFetchAll.mockRejectedValueOnce(new GraphError(429, "Too Many Requests", "", ""));
    await expect(listQuoteAssemblies()).rejects.toThrow("Graph 429");
    expect(graphFetchAll).toHaveBeenCalledTimes(1);
    expect(quoteAssemblyEurColumnsAvailable()).toBe(true);
  });

  it("a create sends the euros and the rate beside the dollars", async () => {
    graphFetch.mockResolvedValueOnce({ id: "9" }).mockResolvedValueOnce({ ...ROW, id: "9" });
    await createQuoteAssembly(BASE_INPUT);
    const fields = JSON.parse(graphFetch.mock.calls[0][1].body).fields;
    expect(fields).toMatchObject({ TargetPrice: 112, TargetPriceEur: 100, EurUsdRate: 1.12 });
  });

  it("a dollars-only create sends neither euro column", async () => {
    graphFetch.mockResolvedValueOnce({ id: "9" }).mockResolvedValueOnce({ ...ROW, id: "9" });
    await createQuoteAssembly({ ...BASE_INPUT, targetPriceEur: null, eurUsdRate: 1.12 });
    const fields = JSON.parse(graphFetch.mock.calls[0][1].body).fields;
    expect(fields).not.toHaveProperty("TargetPriceEur");
    expect(fields).not.toHaveProperty("EurUsdRate");
  });

  it("refuses a euro write while the columns are missing, naming the script", async () => {
    graphFetchAll.mockRejectedValueOnce(new GraphError(400, "Bad Request", "", "")).mockResolvedValueOnce([ROW]);
    await listQuoteAssemblies();
    const previous = toQuoteAssembly(ROW);
    await expect(updateQuoteAssemblyFields(3, { targetPriceEur: 800 }, previous)).rejects.toThrow(
      /create-quote-lists\.ps1/,
    );
    expect(graphFetch).not.toHaveBeenCalled();
  });
});
