import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Customer Quotes in REAL mode: the request shapes.
//   - SQ-YYYY-####-R1 from a fresh Title read; one renumber-and-retry, only on
//     a unique-value refusal and only when the fresh base differs;
//   - a new revision is a NEW ROW (same QuoteBase, Rev + 1) — the source row
//     is never PATCHed;
//   - a Lines write re-reads Lines first and refuses when it is corrupt;
//   - Customer JSON and its CustomerSoldTo / CustomerName columns travel
//     together.
//
// SP_CUSTOMER_QUOTES_LIST_ID has NO default, so the config mock supplies it.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const resolvePeopleLookupIds = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./siteUsers", () => ({
  resolvePeopleLookupIds,
  resolveSiteUserLookupId: vi.fn(),
  listSiteUserDirectory: vi.fn(async () => new Map()),
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, salesTeam: "sales-site" },
    SP_SALESTEAM_SITE_URL: "https://example.sharepoint.com/sites/ALTRONICSALESTEAM",
    SP_CUSTOMER_QUOTES_LIST_ID: "quotes-list",
  };
});

import {
  createCustomerQuote,
  createCustomerQuoteRevision,
  updateCustomerQuote,
  type CustomerQuoteRow,
} from "./customerQuotes";
import { HistoryUnreadableError } from "@/lib/pricingHistory";
import type { CustomerQuoteLine, QuoteCustomerInfo } from "@/types/pricing";
import type { Person } from "@/types/task";

const LIST = "/sites/sales-site/lists/quotes-list/items";
const NOW = new Date(2026, 9, 13, 12, 0, 0);
const DUPLICATE = Object.assign(new Error("Graph 409 Conflict"), {
  status: 409,
  body: '{"error":{"code":"nameAlreadyExists","message":"duplicate values were found in the following field(s) in the list: [Title]"}}',
});

const ray: Person = { lookupId: 88, displayName: "Ray White", email: "ray.white@altronic-llc.com" };
const CUSTOMER: QuoteCustomerInfo = {
  soldTo: " 0001042 ",
  name: " Acme Compression ",
  customerGroup: "DI",
  contactName: "Pat",
  contactEmail: "pat@acme.com",
};
const LINE: CustomerQuoteLine = {
  id: "l1",
  kind: "free",
  partNumber: "791950-08",
  description: "CPU-95",
  quantity: 2,
  listPrice: null,
  customerDiscountPct: null,
  unitPrice: 100,
  breaks: [],
};

function body(): CustomerQuoteRow {
  return { validityDays: 30, customer: CUSTOMER, lines: [LINE], notes: "n", watchers: [ray] };
}

const byMethod = (m: string) => graphFetch.mock.calls.filter(([, init]) => init?.method === m);
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const titles = (...t: string[]) => t.map((title, i) => ({ id: String(i + 1), fields: { Title: title } }));

function quoteItem(id: number, base: string, rev: number, extra: Record<string, unknown> = {}) {
  return {
    id: String(id),
    fields: {
      Title: `${base}-R${rev}`,
      QuoteBase: base,
      Rev: rev,
      Status: "Sent",
      ValidityDays: 45,
      Customer: JSON.stringify(CUSTOMER),
      Lines: JSON.stringify([LINE]),
      QuoteNotes: "carried",
      ...extra,
    },
  };
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  resolvePeopleLookupIds.mockReset();
  resolvePeopleLookupIds.mockImplementation(async (_s: string, _u: string, people: Person[]) =>
    people.map((p) => ({ ...p, lookupId: 512 })),
  );
  graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") return { id: "90", fields: {} };
    if (init?.method === "PATCH") return {};
    return quoteItem(Number(/\/items\/(\d+)/.exec(path)?.[1] ?? 0), "SQ-2026-0001", 1);
  });
});

describe("createCustomerQuote", () => {
  it("numbers SQ-YYYY-####-R1 from the highest base this year + 1, with Watchers two-key and Rev 1", async () => {
    graphFetchAll.mockResolvedValue(titles("SQ-2026-0003-R1", "SQ-2026-0009-R2", "SQ-2025-0050-R1"));
    await createCustomerQuote(body(), NOW);
    const fields = bodyOf(byMethod("POST")[0]).fields;
    expect(fields.Title).toBe("SQ-2026-0010-R1");
    expect(fields.QuoteBase).toBe("SQ-2026-0010");
    expect(fields.Rev).toBe(1);
    expect(fields.Status).toBe("Draft");
    expect(fields["WatchersLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
    expect(fields.WatchersLookupId).toEqual([512]);
    expect(resolvePeopleLookupIds).toHaveBeenCalledWith(
      "sales-site",
      "https://example.sharepoint.com/sites/ALTRONICSALESTEAM",
      [ray],
    );
  });

  it("writes the Customer JSON AND its CustomerSoldTo / CustomerName columns together", async () => {
    graphFetchAll.mockResolvedValue(titles());
    await createCustomerQuote(body(), NOW);
    const fields = bodyOf(byMethod("POST")[0]).fields;
    expect(JSON.parse(fields.Customer)).toEqual(CUSTOMER);
    expect(fields.CustomerSoldTo).toBe("0001042");
    expect(fields.CustomerName).toBe("Acme Compression");
  });

  it("retries ONCE with a fresh base on a unique-value refusal", async () => {
    graphFetchAll.mockResolvedValueOnce(titles("SQ-2026-0001-R1")).mockResolvedValueOnce(titles("SQ-2026-0002-R1"));
    let n = 0;
    graphFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        n += 1;
        if (n === 1) throw DUPLICATE;
        return { id: "91", fields: {} };
      }
      return quoteItem(91, "SQ-2026-0003", 1);
    });
    await createCustomerQuote(body(), NOW);
    expect(byMethod("POST").map((c) => bodyOf(c).fields.Title)).toEqual(["SQ-2026-0002-R1", "SQ-2026-0003-R1"]);
  });

  it("does not retry when the fresh base is the same, and never on another error", async () => {
    graphFetchAll.mockResolvedValue(titles("SQ-2026-0001-R1"));
    graphFetch.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init?.method === "POST") throw DUPLICATE;
      return {};
    });
    await expect(createCustomerQuote(body(), NOW)).rejects.toBe(DUPLICATE);
    expect(byMethod("POST")).toHaveLength(1);

    graphFetch.mockReset();
    graphFetchAll.mockClear();
    const boom = Object.assign(new Error("Graph 400"), { status: 400, body: "invalidRequest" });
    graphFetch.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init?.method === "POST") throw boom;
      return {};
    });
    await expect(createCustomerQuote(body(), NOW)).rejects.toBe(boom);
    expect(byMethod("POST")).toHaveLength(1);
    expect(graphFetchAll).toHaveBeenCalledTimes(1);
  });
});

describe("createCustomerQuoteRevision", () => {
  it("POSTs a NEW row with the same QuoteBase and the next Rev, and never PATCHes the source", async () => {
    graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") return { id: "95", fields: {} };
      if (init?.method === "PATCH") return {};
      if (path.startsWith(`${LIST}/12`)) return quoteItem(12, "SQ-2026-0004", 1);
      return quoteItem(95, "SQ-2026-0004", 3);
    });
    graphFetchAll.mockResolvedValue([
      quoteItem(12, "SQ-2026-0004", 1),
      quoteItem(13, "SQ-2026-0004", 2),
      quoteItem(14, "SQ-2026-0005", 7),
    ]);
    await createCustomerQuoteRevision(12, [ray]);

    expect(byMethod("PATCH")).toHaveLength(0);
    const posts = byMethod("POST");
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe(LIST);
    const fields = bodyOf(posts[0]).fields;
    expect(fields.QuoteBase).toBe("SQ-2026-0004");
    expect(fields.Rev).toBe(3);
    expect(fields.Title).toBe("SQ-2026-0004-R3");
    expect(fields.Status).toBe("Draft");
    expect(fields.ValidityDays).toBe(45);
    expect(JSON.parse(fields.Lines)).toEqual([LINE]);
    expect(fields.QuoteNotes).toBe("carried");
  });

  it("refuses to copy a revision whose Lines can't be read", async () => {
    graphFetch.mockImplementation(async () => quoteItem(12, "SQ-2026-0004", 1, { Lines: "{broken" }));
    await expect(createCustomerQuoteRevision(12, [ray])).rejects.toBeInstanceOf(HistoryUnreadableError);
    expect(byMethod("POST")).toHaveLength(0);
  });
});

describe("updateCustomerQuote", () => {
  it("a Lines write re-reads Lines first and REFUSES, with no PATCH, when it is corrupt", async () => {
    graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return {};
      if (path.includes("$select=Lines)")) return { id: "12", fields: { Lines: "[not json" } };
      return quoteItem(12, "SQ-2026-0004", 1);
    });
    await expect(updateCustomerQuote(12, { lines: [LINE] })).rejects.toBeInstanceOf(HistoryUnreadableError);
    expect(graphFetch.mock.calls[0][0]).toBe(`${LIST}/12?$expand=fields($select=Lines)`);
    expect(byMethod("PATCH")).toHaveLength(0);
  });

  it("a readable Lines value is written", async () => {
    graphFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return {};
      if (path.includes("$select=Lines)")) return { id: "12", fields: { Lines: "[]" } };
      return quoteItem(12, "SQ-2026-0004", 1);
    });
    await updateCustomerQuote(12, { lines: [LINE] });
    expect(byMethod("PATCH")).toHaveLength(1);
    expect(JSON.parse(bodyOf(byMethod("PATCH")[0]).Lines)).toEqual([LINE]);
  });

  it("a customer edit writes the JSON and both plain columns in ONE PATCH, without re-reading Lines", async () => {
    await updateCustomerQuote(12, { customer: { ...CUSTOMER, name: "Acme Co" } });
    expect(graphFetch.mock.calls.some(([p]) => String(p).includes("$select=Lines)"))).toBe(false);
    const patches = byMethod("PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0][0]).toBe(`${LIST}/12/fields`);
    const sent = bodyOf(patches[0]);
    expect(Object.keys(sent).sort()).toEqual(["Customer", "CustomerName", "CustomerSoldTo"]);
    expect(sent.CustomerName).toBe("Acme Co");
    expect(JSON.parse(sent.Customer).name).toBe("Acme Co");
  });
});
