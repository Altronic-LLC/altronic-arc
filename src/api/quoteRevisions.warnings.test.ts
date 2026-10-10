import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// createQuoteRevision is best-effort AFTER the header exists: every later
// failure is collected and named, and the call still resolves. Before it, a
// header failure throws. Mock mode, with individual writes made to fail.
// =============================================================================

const failAssembly = vi.hoisted(() => ({ partNumber: "" }));
const failItem = vi.hoisted(() => ({ partNumber: "" }));
const failHeader = vi.hoisted(() => ({ on: false }));
const failAttachments = vi.hoisted(() => ({ on: false }));

vi.mock("./quoteAssemblies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./quoteAssemblies")>();
  return {
    ...actual,
    createQuoteAssembly: vi.fn(async (input: Parameters<typeof actual.createQuoteAssembly>[0]) => {
      if (input.altronicPartNumber === failAssembly.partNumber) throw new Error("Graph 500");
      return actual.createQuoteAssembly(input);
    }),
  };
});

vi.mock("./quoteItems", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./quoteItems")>();
  return {
    ...actual,
    createQuoteItem: vi.fn(async (input: Parameters<typeof actual.createQuoteItem>[0]) => {
      if (input.altronicPartNumber === failItem.partNumber) throw new Error("Graph 429");
      return actual.createQuoteItem(input);
    }),
  };
});

vi.mock("./quotes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./quotes")>();
  return {
    ...actual,
    createQuoteWithNumbering: vi.fn(async (...args: Parameters<typeof actual.createQuoteWithNumbering>) => {
      if (failHeader.on) throw new Error("Graph 403 accessDenied");
      return actual.createQuoteWithNumbering(...args);
    }),
  };
});

vi.mock("./attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./attachments")>();
  return {
    ...actual,
    copyAttachments: vi.fn(async (...args: Parameters<typeof actual.copyAttachments>) => {
      if (failAttachments.on) throw new Error("SharePoint unavailable");
      return actual.copyAttachments(...args);
    }),
  };
});

import { createQuoteRevision } from "./quoteRevisions";
import { listQuoteItems } from "./quoteItems";
import { listQuotes } from "./quotes";
import { __resetQuoteMockStores } from "@/data/quoteMockData";

beforeEach(() => {
  __resetQuoteMockStores();
  failAssembly.partNumber = "";
  failItem.partNumber = "";
  failHeader.on = false;
  failAttachments.on = false;
});

describe("createQuoteRevision — failures", () => {
  it("a failed header create throws, and nothing else is written", async () => {
    failHeader.on = true;
    const before = (await listQuoteItems()).length;
    await expect(createQuoteRevision(2)).rejects.toThrow(/403/);
    expect((await listQuotes()).filter((q) => q.quoteBase === "IQ-COO-0001")).toHaveLength(2);
    expect((await listQuoteItems()).length).toBe(before);
  });

  it("names a failed assembly, skips its components, and still resolves", async () => {
    failAssembly.partNumber = "693005-1";
    const { quote, warnings } = await createQuoteRevision(2);
    expect(quote.quoteNumber).toBe("IQ-COO-0001-R3");
    expect(warnings).toContain("Assembly 693005-1 wasn't copied to R3: Graph 500");
    expect(warnings).toContain("Component 693005-WIRE wasn't copied to R3: its assembly didn't come across.");
    expect(warnings).toContain("Component 693005-CONN wasn't copied to R3: its assembly didn't come across.");
    // The other assembly's four components still came across.
    expect((await listQuoteItems()).filter((i) => i.quoteId === quote.id)).toHaveLength(4);
  });

  it("names a failed component and carries on", async () => {
    failItem.partNumber = "791950-ENC";
    const { quote, warnings } = await createQuoteRevision(2);
    expect(warnings).toEqual(["Component 791950-ENC wasn't copied to R3: Graph 429"]);
    expect((await listQuoteItems()).filter((i) => i.quoteId === quote.id)).toHaveLength(5);
  });

  it("an attachment copy that throws becomes a warning", async () => {
    failAttachments.on = true;
    // Counted BEFORE the rev, from the data — not hard-coded, so adding demo
    // components to quote 4 doesn't break this.
    const components = (await listQuoteItems()).filter((i) => i.quoteId === 4).length;
    const { warnings } = await createQuoteRevision(4);
    expect(warnings[0]).toMatch(/^Quote attachments: attachments couldn't be copied to R2/);
    expect(warnings.length).toBe(1 + components); // header + one per component
  });
});
