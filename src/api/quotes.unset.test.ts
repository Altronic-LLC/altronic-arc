import { describe, expect, it, vi } from "vitest";

// Real mode with NONE of the five list ids set: reads come back empty / null
// (the screen says "not configured" rather than erroring), and every write
// refuses with the env var named.

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
    SP_QUOTES_LIST_ID: undefined,
    SP_QUOTE_ASSEMBLIES_LIST_ID: undefined,
    SP_QUOTE_ITEMS_LIST_ID: undefined,
    SP_QUOTE_CUSTOMERS_LIST_ID: undefined,
    SP_QUOTE_ROLES_LIST_ID: undefined,
  };
});

import { createQuote, getQuote, listQuotes } from "./quotes";
import { createQuoteAssembly, listQuoteAssemblies } from "./quoteAssemblies";
import { createQuoteItem, listQuoteItems } from "./quoteItems";
import { createQuoteCustomer, listQuoteCustomers } from "./quoteCustomers";
import { createQuoteRoleEntry, deleteQuoteRoleEntry, listQuoteRoleEntries } from "./quoteRoles";

describe("quote lists not configured", () => {
  it("reads are empty / null, with no request made", async () => {
    expect(await listQuotes()).toEqual([]);
    expect(await getQuote(1)).toBeNull();
    expect(await listQuoteAssemblies()).toEqual([]);
    expect(await listQuoteItems()).toEqual([]);
    expect(await listQuoteCustomers()).toEqual([]);
    expect(await listQuoteRoleEntries()).toEqual([]);
    expect(graphFetch).not.toHaveBeenCalled();
    expect(graphFetchAll).not.toHaveBeenCalled();
  });

  it("writes refuse, naming the env var", async () => {
    await expect(
      createQuote({
        customerId: 1, customerCode: "COO", contactName: "", contactEmail: "", validityDays: 30,
        budgetary: false, budgetaryText: "", quoteNotes: "", watchers: [],
      }),
    ).rejects.toThrow(/VITE_SP_QUOTES_LIST_ID/);
    await expect(
      createQuoteAssembly({
        quoteId: 1, lineNo: 1, altronicPartNumber: "A", sapPartNumber: "", customerPartNumber: "",
        description: "", priceBreaks: [], targetGM: null, manualPrice: null, customerPrice: null,
        lineType: "Assembly", cost: null, materialOverheadPct: null, quotedQty: 1,
      }),
    ).rejects.toThrow(/VITE_SP_QUOTE_ASSEMBLIES_LIST_ID/);
    await expect(
      createQuoteItem({
        quoteId: 1, assemblyId: 1, lineNo: 1, altronicPartNumber: "A", sapPartNumber: "",
        description: "", quantity: 1, cost: null, materialOverheadPct: null,
      }),
    ).rejects.toThrow(/VITE_SP_QUOTE_ITEMS_LIST_ID/);
    await expect(
      createQuoteCustomer({ name: "X", code: "XX", customerNumber: "", note: "" }),
    ).rejects.toThrow(/VITE_SP_QUOTE_CUSTOMERS_LIST_ID/);
    await expect(
      createQuoteRoleEntry({ email: "a@x.com", displayName: "", roles: ["viewer"], note: "" }),
    ).rejects.toThrow(/VITE_SP_QUOTE_ROLES_LIST_ID/);
    await expect(deleteQuoteRoleEntry(1)).rejects.toThrow(/VITE_SP_QUOTE_ROLES_LIST_ID/);
    expect(graphFetch).not.toHaveBeenCalled();
  });
});
