import { beforeEach, describe, expect, it } from "vitest";
import {
  addQuoteItemComment,
  createQuoteItem,
  deleteQuoteItem,
  editQuoteItemComment,
  listQuoteItems,
  setQuoteItemWatchers,
  updateQuoteItemFields,
} from "./quoteItems";
import { __resetQuoteMockStores } from "@/data/quoteMockData";

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 122 };

beforeEach(() => {
  __resetQuoteMockStores();
});

describe("quote items API (mock mode)", () => {
  it("lists every component", async () => {
    const rows = await listQuoteItems();
    expect(rows.filter((i) => i.assemblyId === 1)).toHaveLength(4);
  });

  it("creates, edits, comments, watches and deletes", async () => {
    const created = await createQuoteItem({
      quoteId: 4,
      assemblyId: 6,
      lineNo: 4,
      altronicPartNumber: "CAP-1UF",
      sapPartNumber: "",
      description: "Capacitor",
      quantity: 6,
      cost: 0.42,
      materialOverheadPct: null,
    });
    expect(created).toMatchObject({ quoteId: 4, assemblyId: 6, quantity: 6, comments: [], watchers: [] });

    const edited = await updateQuoteItemFields(created.id, { cost: 0.5 }, created);
    expect(edited.cost).toBe(0.5);

    const commented = await addQuoteItemComment(created.id, {
      authorName: "Ray White",
      authorEmail: RAY.email,
      bodyHtml: "<p>check</p>",
    });
    const ts = commented.comments[0].timestamp;
    const fixed = await editQuoteItemComment(created.id, { timestamp: ts, authorEmail: RAY.email }, "<p>ok</p>");
    expect(fixed.comments[0].bodyHtml).toBe("<p>ok</p>");

    expect((await setQuoteItemWatchers(created.id, [RAY])).watchers).toEqual([RAY]);

    await deleteQuoteItem(created.id);
    expect((await listQuoteItems()).some((i) => i.id === created.id)).toBe(false);
    await expect(setQuoteItemWatchers(created.id, [])).rejects.toThrow(/not found/);
  });
});
