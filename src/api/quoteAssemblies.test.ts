import { beforeEach, describe, expect, it } from "vitest";
import {
  createQuoteAssembly,
  deleteQuoteAssembly,
  listQuoteAssemblies,
  updateQuoteAssemblyFields,
} from "./quoteAssemblies";
import { __resetQuoteMockStores } from "@/data/quoteMockData";

beforeEach(() => {
  __resetQuoteMockStores();
});

describe("quote assemblies API (mock mode)", () => {
  it("lists every assembly in line order", async () => {
    const rows = await listQuoteAssemblies();
    expect(rows.length).toBeGreaterThan(0);
    const onQuote2 = rows.filter((a) => a.quoteId === 2).map((a) => a.lineNo);
    expect(onQuote2).toEqual([1, 2]);
  });

  it("creates, edits and deletes", async () => {
    const created = await createQuoteAssembly({
      quoteId: 4,
      lineNo: 2,
      lineType: "Assembly",
      quotedQty: 2,
      cost: null,
      materialOverheadPct: null,
      altronicPartNumber: " NGI-2000-HARN ",
      sapPartNumber: "",
      customerPartNumber: "",
      description: "Harness",
      priceBreaks: [{ qty: 10, discountPct: 4, note: "" }],
      targetGM: 35,
      manualPrice: null,
      customerPrice: 300,
    });
    expect(created).toMatchObject({ quoteId: 4, altronicPartNumber: "NGI-2000-HARN", targetGM: 35 });

    const edited = await updateQuoteAssemblyFields(created.id, { manualPrice: 280, customerPrice: 280 }, created);
    expect(edited).toMatchObject({ manualPrice: 280, customerPrice: 280, priceBreaks: created.priceBreaks });

    await deleteQuoteAssembly(created.id);
    expect((await listQuoteAssemblies()).some((a) => a.id === created.id)).toBe(false);
    await expect(updateQuoteAssemblyFields(created.id, {}, created)).rejects.toThrow(/not found/);
  });
});
