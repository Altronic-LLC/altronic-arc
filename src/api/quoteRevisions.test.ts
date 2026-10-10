import { beforeEach, describe, expect, it } from "vitest";
import { carriedQuoteCommunication, createQuoteRevision } from "./quoteRevisions";
import { listQuoteAssemblies } from "./quoteAssemblies";
import { listQuoteItems } from "./quoteItems";
import { getQuote, listQuotes, updateQuoteFields } from "./quotes";
import { listAttachments, uploadAttachment } from "./attachments";
import { __resetQuoteMockStores } from "@/data/quoteMockData";
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

  it("copies assemblies and components as NEW rows, re-parented old → new", async () => {
    const { quote } = await createQuoteRevision(2);
    const assemblies = (await listQuoteAssemblies()).filter((a) => a.quoteId === quote.id);
    expect(assemblies.map((a) => a.altronicPartNumber)).toEqual(["791950-08", "693005-1"]);
    expect(assemblies[1].manualPrice).toBe(115);
    // Each assembly's target GM comes across with it.
    const sources = (await listQuoteAssemblies()).filter((a) => a.quoteId === 2);
    expect(assemblies.map((a) => a.targetGM)).toEqual(sources.map((a) => a.targetGM));
    expect(assemblies.map((a) => a.quotedQty)).toEqual(sources.map((a) => a.quotedQty));
    expect(assemblies[0].targetGM).not.toBeNull();
    expect(assemblies[0].priceBreaks).toHaveLength(3);

    const items = (await listQuoteItems()).filter((i) => i.quoteId === quote.id);
    expect(items).toHaveLength(6);
    const ids = new Set(assemblies.map((a) => a.id));
    expect(items.every((i) => i.assemblyId !== null && ids.has(i.assemblyId))).toBe(true);
    const board = items.find((i) => i.altronicPartNumber === "791950-PCB")!;
    expect(board.assemblyId).toBe(assemblies[0].id);
    expect(board.watchers.map((w) => w.displayName)).toEqual(["Brandon Mirto"]);
    // Already tagged from R1 — not tagged again from R2.
    expect(board.comments[0].bodyHtml.match(/carried over/g)).toHaveLength(1);

    // The R2 originals are still there.
    expect((await listQuoteItems()).filter((i) => i.quoteId === 2)).toHaveLength(6);
  });

  it("copies a standalone Part line with its type, cost and overhead", async () => {
    const { quote } = await createQuoteRevision(3);
    const lines = (await listQuoteAssemblies()).filter((a) => a.quoteId === quote.id);
    const part = lines.find((a) => a.lineType === "Part")!;
    expect(part).toMatchObject({ lineType: "Part", cost: 38.4, materialOverheadPct: 10, targetGM: 45 });
    expect(lines.find((a) => a.lineType === "Assembly")).toBeDefined();
  });

  it("copies attachments on the header and the components", async () => {
    await uploadAttachment("quote", 2, new File(["x"], "data-package.pdf"));
    await uploadAttachment("quoteItem", 12, new File(["y"], "connector-quote.pdf"));
    const { quote } = await createQuoteRevision(2);
    expect((await listAttachments("quote", quote.id)).map((a) => a.fileName)).toEqual(["data-package.pdf"]);
    const conn = (await listQuoteItems()).find((i) => i.quoteId === quote.id && i.altronicPartNumber === "693005-CONN")!;
    expect((await listAttachments("quoteItem", conn.id)).map((a) => a.fileName)).toEqual(["connector-quote.pdf"]);
  });

  it("throws when the source quote doesn't exist", async () => {
    await expect(createQuoteRevision(999)).rejects.toThrow(/not found/);
  });
});
