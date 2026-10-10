import { beforeEach, describe, expect, it } from "vitest";
import * as api from "./quotes";
import {
  addQuoteComment,
  createQuote,
  editQuoteComment,
  getQuote,
  listQuotes,
  setQuoteLinks,
  setQuoteWatchers,
  updateQuoteFields,
} from "./quotes";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";

// USE_MOCK is true under Vitest — these run against the in-memory store.

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 122 };

const input = {
  customerId: 2,
  customerCode: "WAB",
  contactName: "Dana",
  contactEmail: "dana@example.com",
  validityDays: 30,
  budgetary: false,
  budgetaryText: "",
  quoteNotes: "",
  watchers: [RAY],
};

beforeEach(() => {
  __resetQuoteMockStores();
});

describe("quotes API (mock mode)", () => {
  it("has no delete", () => {
    expect(Object.keys(api).filter((k) => /delete|remove/i.test(k))).toEqual([]);
  });

  it("lists newest first; gets one; null for an unknown id", async () => {
    const rows = await listQuotes();
    expect(rows.map((q) => q.quoteNumber)).toEqual([
      "IQ-INN-0003-R1",
      "IQ-WAB-0002-R1",
      "IQ-COO-0001-R2",
      "IQ-COO-0001-R1",
    ]);
    expect((await getQuote(2))?.quoteNumber).toBe("IQ-COO-0001-R2");
    expect(await getQuote(999)).toBeNull();
  });

  it("creates at R1 with the next GLOBAL sequence, whatever the customer", async () => {
    const q = await createQuote(input);
    expect(q.quoteNumber).toBe("IQ-WAB-0004-R1");
    expect(q.quoteBase).toBe("IQ-WAB-0004");
    expect(q.rev).toBe(1);
    expect(q.status).toBe("Draft");
    expect(q.watchers).toEqual([RAY]);
    const next = await createQuote({ ...input, customerCode: "coo", status: "Sent" });
    expect(next.quoteNumber).toBe("IQ-COO-0005-R1");
    expect(next.status).toBe("Sent");
  });

  it("numbers highest + 1 even with a gap", async () => {
    quoteMockDb.quotes = quoteMockDb.quotes.filter((q) => q.quoteBase !== "IQ-WAB-0002");
    expect((await createQuote(input)).quoteNumber).toBe("IQ-WAB-0004-R1");
  });

  it("updates only what changed; mutating the result doesn't touch the store", async () => {
    const before = (await getQuote(1))!;
    const after = await updateQuoteFields(1, { status: "Won", quoteNotes: "x" }, before);
    expect(after.status).toBe("Won");
    expect(after.quoteNumber).toBe(before.quoteNumber);
    after.watchers.push(RAY);
    expect((await getQuote(1))!.watchers).toHaveLength(before.watchers.length);
  });

  it("watchers, links and comments", async () => {
    expect((await setQuoteWatchers(4, [RAY])).watchers).toEqual([RAY]);
    const linked = await setQuoteLinks(4, { engineeringTaskLink: { url: "https://x/task/1", description: "T1" } });
    expect(linked.engineeringTaskLink?.url).toBe("https://x/task/1");
    expect(linked.operationsTaskLink).toBeNull();
    expect((await setQuoteLinks(4, { engineeringTaskLink: null })).engineeringTaskLink).toBeNull();

    const commented = await addQuoteComment(4, { authorName: "Ray White", authorEmail: RAY.email, bodyHtml: "<p>a</p>" });
    expect(commented.comments[0].bodyHtml).toBe("<p>a</p>");
    const edited = await editQuoteComment(
      4,
      { timestamp: commented.comments[0].timestamp, authorEmail: RAY.email.toUpperCase() },
      "<p>b</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>b</p>");
  });

  it("refuses a write to an unknown quote", async () => {
    await expect(setQuoteWatchers(999, [])).rejects.toThrow(/not found/);
  });
});
