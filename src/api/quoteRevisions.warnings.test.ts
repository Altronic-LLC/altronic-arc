import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// createQuoteRevision is best-effort AFTER the header exists: every later
// failure is collected and named, and the call still resolves. Before it, a
// header failure throws. Mock mode, with individual writes made to fail.
// =============================================================================

const failAssembly = vi.hoisted(() => ({ partNumber: "" }));
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
import { listQuoteAssemblies } from "./quoteAssemblies";
import { listQuotes } from "./quotes";
import { __resetQuoteMockStores } from "@/data/quoteMockData";

beforeEach(() => {
  __resetQuoteMockStores();
  failAssembly.partNumber = "";
  failHeader.on = false;
  failAttachments.on = false;
});

describe("createQuoteRevision — failures", () => {
  it("a failed header create throws, and nothing else is written", async () => {
    failHeader.on = true;
    const before = (await listQuoteAssemblies()).length;
    await expect(createQuoteRevision(2)).rejects.toThrow(/403/);
    expect((await listQuotes()).filter((q) => q.quoteBase === "IQ-COO-0001")).toHaveLength(2);
    expect((await listQuoteAssemblies()).length).toBe(before);
  });

  it("names a failed line and still copies the rest", async () => {
    failAssembly.partNumber = "693005-1";
    const { quote, warnings } = await createQuoteRevision(2);
    expect(quote.quoteNumber).toBe("IQ-COO-0001-R3");
    expect(warnings).toEqual(["Line 693005-1 wasn't copied to R3: Graph 500"]);
    expect((await listQuoteAssemblies()).filter((a) => a.quoteId === quote.id).map((a) => a.altronicPartNumber)).toEqual([
      "791950-08",
    ]);
  });

  it("an attachment copy that throws becomes a warning", async () => {
    failAttachments.on = true;
    const { warnings } = await createQuoteRevision(4);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Quote attachments: attachments couldn't be copied to R2/);
  });
});
