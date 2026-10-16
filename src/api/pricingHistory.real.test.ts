import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Pricing History in REAL mode: recordPricing's request shapes.
//   - the first pricing POSTs Title + RequestRefLookupId (a BARE integer) +
//     History as a JSON array of one entry;
//   - a later pricing re-reads FRESH and PATCHes History with the entry
//     APPENDED (earlier entries kept);
//   - a History value that can't be parsed is never written over.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, salesTeam: "sales-site" },
    SP_PRICING_HISTORY_LIST_ID: "history-list",
  };
});

import { recordPricing } from "./pricingHistory";
import { HistoryUnreadableError } from "@/lib/pricingHistory";
import type { PricingHistoryEntry } from "@/types/pricing";

const LIST = "/sites/sales-site/lists/history-list/items";

function entry(overrides: Partial<PricingHistoryEntry> = {}): PricingHistoryEntry {
  return {
    pricedAt: "2026-10-13T12:00:00.000Z",
    pricedBy: { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com" },
    cost: 40,
    costSource: "SAP",
    distributorDiscountPct: 36,
    discountSource: "SAP",
    input: { kind: "gm", value: 50 },
    listPrice: 125,
    baseGM: 50,
    customerGroup: "DI",
    customerDiscountPct: 34,
    customerPrice: 82.5,
    customerGM: 51.5,
    mpg: { key: "IGN", averageGM: 48, counted: 12 },
    family: null,
    note: "first",
    ...overrides,
  };
}

const posts = () => graphFetch.mock.calls.filter(([, init]) => init?.method === "POST");
const patches = () => graphFetch.mock.calls.filter(([, init]) => init?.method === "PATCH");
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") return { id: "40", fields: { Title: "PR-2026-0005", RequestRefLookupId: "5" } };
    if (init?.method === "PATCH") return {};
    return { id: "40", fields: { Title: "PR-2026-0005", RequestRefLookupId: "5", History: "[]" }, path };
  });
});

describe("recordPricing", () => {
  it("the first pricing POSTs Title, a BARE-integer RequestRefLookupId and a one-entry History", async () => {
    graphFetchAll.mockResolvedValue([{ id: "1", fields: { Title: "PR-2026-0001", RequestRefLookupId: "1" } }]);
    const e = entry();
    await recordPricing({ id: 5, requestNumber: "PR-2026-0005" }, e);

    expect(patches()).toHaveLength(0);
    expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe(LIST);
    const fields = bodyOf(posts()[0]).fields;
    expect(fields.Title).toBe("PR-2026-0005");
    expect(fields.RequestRefLookupId).toBe(5);
    expect(fields).not.toHaveProperty("RequestRefLookupId@odata.type");
    expect(JSON.parse(fields.History)).toEqual([e]);
    expect(fields.ListPrice).toBe(125);
    expect(fields.TargetGM).toBe(50);
  });

  it("a later pricing re-reads and PATCHes History with the new entry APPENDED", async () => {
    const earlier = entry({ note: "first", listPrice: 120 });
    graphFetchAll.mockResolvedValue([
      { id: "40", fields: { Title: "PR-2026-0005", RequestRefLookupId: "5", History: JSON.stringify([earlier]) } },
    ]);
    const later = entry({ note: "second", listPrice: 140, input: { kind: "list", value: 140 } });
    await recordPricing({ id: 5, requestNumber: "PR-2026-0005" }, later);

    expect(graphFetchAll).toHaveBeenCalledTimes(1); // the FRESH read
    expect(posts()).toHaveLength(0);
    expect(patches()).toHaveLength(1);
    expect(patches()[0][0]).toBe(`${LIST}/40/fields`);
    const body = bodyOf(patches()[0]);
    expect(JSON.parse(body.History)).toEqual([earlier, later]);
    expect(body.ListPrice).toBe(140);
    expect(body.TargetGM).toBeNull();
  });

  it("refuses with HistoryUnreadableError, and sends no PATCH, when the stored History is corrupt", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "40", fields: { Title: "PR-2026-0005", RequestRefLookupId: "5", History: "{not json" } },
    ]);
    await expect(recordPricing({ id: 5, requestNumber: "PR-2026-0005" }, entry())).rejects.toBeInstanceOf(
      HistoryUnreadableError,
    );
    expect(patches()).toHaveLength(0);
    expect(posts()).toHaveLength(0);
  });
});
