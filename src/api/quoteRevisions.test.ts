import { beforeEach, describe, expect, it } from "vitest";
import { carriedQuoteCommunication, createQuoteRevision } from "./quoteRevisions";
import { listQuoteAssemblies } from "./quoteAssemblies";
import { getQuote, listQuotes, updateQuoteFields } from "./quotes";
import { listAttachments, uploadAttachment } from "./attachments";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";
import { parseCommunication } from "@/lib/communicationParser";

beforeEach(() => {
  __resetQuoteMockStores();
});

describe("carriedQuoteCommunication", () => {
  it("stores oldest-first, keeps authors and timestamps, tags once", () => {
    const comments = [
      { timestamp: new Date("2026-10-02T14:00:00Z"), authorName: "B", authorEmail: "b@x", bodyHtml: "<p>new</p>" },
      { timestamp: new Date("2026-10-01T14:00:00Z"), authorName: "A", authorEmail: "a@x", bodyHtml: "<p>old</p>" },
      {
        timestamp: new Date("2026-09-01T14:00:00Z"),
        authorName: "C",
        authorEmail: "c@x",
        bodyHtml: "<p>older</p><p><em>— carried over from R1</em></p>",
      },
    ];
    const raw = carriedQuoteCommunication(comments, 2);
    expect(raw.indexOf("older")).toBeLessThan(raw.indexOf("old</p><p><em>— carried over from R2"));
    expect(raw.indexOf("<p>old</p>")).toBeLessThan(raw.indexOf("<p>new</p>"));
    const back = parseCommunication(raw);
    expect(back.map((c) => c.authorName)).toEqual(["B", "A", "C"]);
    expect(back[0].timestamp.toISOString()).toBe("2026-10-02T14:00:00.000Z");
    expect(back[0].bodyHtml).toBe("<p>new</p><p><em>— carried over from R2</em></p>");
    // An already-carried comment isn't tagged twice.
    expect(back[2].bodyHtml.match(/carried over/g)).toHaveLength(1);
    expect(carriedQuoteCommunication([], 1)).toBe("");
  });
});

describe("createQuoteRevision (mock mode)", () => {
  it("copies the header forward as the next rev, Draft, same base", async () => {
    // Quote 1 is R1 of a base that already has R2 — the new rev is R3, not R2.
    await updateQuoteFields(1, { quoteNotes: "R1 notes" }, (await getQuote(1))!);
    const { quote, warnings } = await createQuoteRevision(1);
    expect(warnings).toEqual([]);
    expect(quote).toMatchObject({
      quoteNumber: "IQ-COO-0001-R3",
      quoteBase: "IQ-COO-0001",
      rev: 3,
      status: "Draft",
      customerId: 1,
      quoteNotes: "R1 notes",
    });
    expect(quote.comments.map((c) => c.authorName)).toEqual(["Ray White", "Katie Fleming"]);
    expect(quote.comments.every((c) => c.bodyHtml.endsWith("<p><em>— carried over from R1</em></p>"))).toBe(true);
    // The source is untouched.
    expect((await getQuote(1))!.status).toBe("Sent");
    expect((await listQuotes()).filter((q) => q.quoteBase === "IQ-COO-0001")).toHaveLength(3);
  });

  it("copies the lines as NEW rows, with their material, labor, overhead and GM", async () => {
    const { quote } = await createQuoteRevision(2);
    const lines = (await listQuoteAssemblies()).filter((a) => a.quoteId === quote.id);
    const sources = (await listQuoteAssemblies()).filter((a) => a.quoteId === 2);
    expect(lines.map((a) => a.altronicPartNumber)).toEqual(["791950-08", "693005-1"]);
    expect(lines[1].manualPrice).toBe(115);
    for (const key of ["materialCost", "laborCost", "materialOverheadPct", "targetGM", "quotedQty"] as const) {
      expect(lines.map((a) => a[key])).toEqual(sources.map((a) => a[key]));
    }
    expect(lines[0]).toMatchObject({ materialCost: 520, laborCost: 85, materialOverheadPct: 18 });
    expect(lines[0].priceBreaks).toHaveLength(3);
    expect(new Set(lines.map((a) => a.id)).has(sources[0].id)).toBe(false);
    // The R2 originals are still there.
    expect(sources).toHaveLength(2);
  });

  it("copies the reference, lead times and task / project links", async () => {
    const source = (await getQuote(2))!;
    await updateQuoteFields(
      2,
      { engineeringTaskId: 47, operationsTaskId: 3, operationsProjectRef: "0007-Line 3", engineeringProjectRef: "0042-NGI" },
      source,
    );
    const { quote } = await createQuoteRevision(2);
    expect(quote).toMatchObject({
      customerReference: "RFQ 4471 — CPU-95 retrofit kits",
      engineeringTaskId: 47,
      operationsTaskId: 3,
      engineeringProjectRef: "0042-NGI",
      operationsProjectRef: "0007-Line 3",
    });
    expect(quote.leadTimes).toEqual(source.leadTimes);
    expect(quote.leadTimes.length).toBeGreaterThan(0);
  });

  it("starts with an EMPTY lead-time table, and says so, when the source's couldn't be read", async () => {
    const row = quoteMockDb.quotes.find((q) => q.id === 2)!;
    row.leadTimesCorrupt = true;
    row.leadTimes = [];
    const { quote, warnings } = await createQuoteRevision(2);
    expect(quote.leadTimes).toEqual([]);
    expect(warnings).toEqual([
      "IQ-COO-0001-R2's lead-time table couldn't be read, so R3 starts with an empty one.",
    ]);
  });

  it("copies attachments on the header", async () => {
    await uploadAttachment("quote", 2, new File(["x"], "data-package.pdf"));
    const { quote } = await createQuoteRevision(2);
    expect((await listAttachments("quote", quote.id)).map((a) => a.fileName)).toEqual(["data-package.pdf"]);
  });

  it("throws when the source quote doesn't exist", async () => {
    await expect(createQuoteRevision(999)).rejects.toThrow(/not found/);
  });
});
