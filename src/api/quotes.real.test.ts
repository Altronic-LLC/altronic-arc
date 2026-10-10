import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Insourcing Quotes in REAL mode: the request shapes.
//
// None of this is visible from mock mode, which never builds a request — so
// this file forces `USE_MOCK: false` and asserts what goes over the wire:
//
//   - every `$select` carries BOTH halves of every single lookup;
//   - single lookups are written as BARE integers (never Collection(Edm.Int32));
//   - Hyperlink columns are never in a create POST, only their own PATCH;
//   - diffed updates send only changed columns, and nothing when unchanged;
//   - the unique-value retry happens ONCE and ONLY on that refusal;
//   - Watchers use the two-key Collection(Edm.Int32) shape, resolved on PMO;
//   - createQuoteRevision writes header → assemblies → items, re-parented.
//
// Config is mocked explicitly — a test must not depend on VITE_* being set.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const resolvePeopleLookupIds = vi.hoisted(() => vi.fn());
const copyAttachments = vi.hoisted(() => vi.fn());

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

vi.mock("./attachments", () => ({ copyAttachments }));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SITES: { ...actual.SITES, pmo: "pmo-site" },
    SP_PMO_SITE_URL: "https://example.sharepoint.com/sites/Altronic_PMO",
    SP_QUOTES_LIST_ID: "quotes-list",
    SP_QUOTE_ASSEMBLIES_LIST_ID: "assemblies-list",
    SP_QUOTE_ITEMS_LIST_ID: "items-list",
    SP_QUOTE_CUSTOMERS_LIST_ID: "customers-list",
    SP_QUOTE_ROLES_LIST_ID: "roles-list",
  };
});

import {
  addQuoteComment,
  createQuote,
  getQuote,
  listQuotes,
  setQuoteLinks,
  setQuoteWatchers,
  updateQuoteFields,
} from "./quotes";
import {
  createQuoteAssembly,
  deleteQuoteAssembly,
  listQuoteAssemblies,
  updateQuoteAssemblyFields,
} from "./quoteAssemblies";
import { createQuoteItem, listQuoteItems, updateQuoteItemFields } from "./quoteItems";
import { QuoteCustomerCodeTakenError, createQuoteCustomer, listQuoteCustomers } from "./quoteCustomers";
import { createQuoteRoleEntry, listQuoteRoleEntries } from "./quoteRoles";
import { createQuoteRevision } from "./quoteRevisions";
import { toQuote, toQuoteAssembly, toQuoteItem } from "@/lib/quoteMapper";

const PMO_URL = "https://example.sharepoint.com/sites/Altronic_PMO";
const DUPLICATE = Object.assign(new Error("Graph 409 Conflict"), {
  status: 409,
  body: '{"error":{"code":"nameAlreadyExists","message":"duplicate values were found in the following field(s) in the list: [Title]"}}',
});

function quoteItem(id: number, fields: Record<string, unknown> = {}) {
  return {
    id: String(id),
    createdDateTime: "2026-10-01T12:00:00Z",
    lastModifiedDateTime: "2026-10-01T12:00:00Z",
    fields: {
      Title: "IQ-COO-0042-R1",
      QuoteBase: "IQ-COO-0042",
      Rev: 1,
      CustomerRefLookupId: "3",
      Status: "Draft",
      ValidityDays: 30,
      ContactName: "Mark",
      ...fields,
    },
  };
}

function titles(...values: string[]) {
  return values.map((Title, i) => ({ id: String(i + 1), fields: { Title } }));
}

/** Every call to graphFetch with the given method, as [url, parsed body]. */
function calls(method: string): [string, Record<string, unknown>][] {
  return graphFetch.mock.calls
    .filter(([, init]) => (init?.method ?? "GET") === method)
    .map(([url, init]) => [String(url), init?.body ? JSON.parse(init.body) : {}]);
}

const QUOTE_INPUT = {
  customerId: 3,
  customerCode: "COO",
  contactName: "Mark",
  contactEmail: "",
  validityDays: 30,
  budgetary: false,
  budgetaryText: "",
  quoteNotes: "",
  watchers: [{ displayName: "Ray", email: "ray@x.com", lookupId: 999 }],
};

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  resolvePeopleLookupIds.mockReset();
  copyAttachments.mockReset();
  // Re-resolved against PMO: the Engineering id 999 is replaced.
  resolvePeopleLookupIds.mockImplementation(async (_site: string, _url: string, people: { email?: string }[]) =>
    people.map((p, i) => ({ ...p, lookupId: 40 + i })),
  );
  copyAttachments.mockResolvedValue({ copied: [], failed: [] });
});

describe("reads", () => {
  it("quotes: PMO site, item-level createdBy, BOTH halves of CustomerRef", async () => {
    graphFetchAll.mockResolvedValue([quoteItem(1)]);
    const [q] = await listQuotes();
    const url = String(graphFetchAll.mock.calls[0][0]);
    expect(url).toContain("/sites/pmo-site/lists/quotes-list/items");
    expect(url).toContain("$select=id,createdBy,createdDateTime,lastModifiedDateTime");
    expect(url).toMatch(/CustomerRef,CustomerRefLookupId/);
    expect(q.customerId).toBe(3);
  });

  it("assemblies and items select both halves of every lookup", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listQuoteAssemblies();
    await listQuoteItems();
    const [assemblyUrl, itemUrl] = graphFetchAll.mock.calls.map((c) => String(c[0]));
    expect(assemblyUrl).toContain("/lists/assemblies-list/");
    expect(assemblyUrl).toMatch(/QuoteRef,QuoteRefLookupId/);
    expect(itemUrl).toMatch(/QuoteRef,QuoteRefLookupId/);
    expect(itemUrl).toMatch(/AssemblyRef,AssemblyRefLookupId/);
  });

  it("customers and roles read their own lists; roles select PersonName", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listQuoteCustomers();
    await listQuoteRoleEntries();
    const [c, r] = graphFetchAll.mock.calls.map((x) => String(x[0]));
    expect(c).toContain("/lists/customers-list/");
    expect(r).toContain("/lists/roles-list/");
    expect(r).toContain("PersonName");
    expect(r).not.toContain("DisplayName");
  });

  it("getQuote: 404 is null, anything else propagates", async () => {
    graphFetch.mockRejectedValueOnce(Object.assign(new Error("Graph 404"), { status: 404 }));
    expect(await getQuote(5)).toBeNull();
    graphFetch.mockRejectedValueOnce(Object.assign(new Error("Graph 503"), { status: 503 }));
    await expect(getQuote(5)).rejects.toThrow(/503/);
  });
});

describe("createQuote", () => {
  it("numbers from a fresh read, writes a bare-integer lookup and two-key Watchers, no hyperlinks", async () => {
    graphFetchAll.mockResolvedValueOnce(titles("IQ-COO-0003-R1", "IQ-WAB-0007-R2", "junk"));
    graphFetch.mockResolvedValueOnce({ id: "21" }).mockResolvedValueOnce(quoteItem(21));
    await createQuote(QUOTE_INPUT);

    const [[url, body]] = calls("POST");
    expect(url).toBe("/sites/pmo-site/lists/quotes-list/items");
    const fields = body.fields as Record<string, unknown>;
    expect(fields).toMatchObject({
      Title: "IQ-COO-0008-R1",
      QuoteBase: "IQ-COO-0008",
      Rev: 1,
      Status: "Draft",
      CustomerRefLookupId: 3,
      "WatchersLookupId@odata.type": "Collection(Edm.Int32)",
      WatchersLookupId: [40],
    });
    expect(typeof fields.CustomerRefLookupId).toBe("number");
    expect(fields).not.toHaveProperty("CustomerRefLookupId@odata.type");
    expect(Object.keys(fields).some((k) => /Link/.test(k))).toBe(false);
    expect(resolvePeopleLookupIds).toHaveBeenCalledWith("pmo-site", PMO_URL, QUOTE_INPUT.watchers);
  });

  it("retries ONCE on a unique-value refusal, with the recomputed number", async () => {
    graphFetchAll
      .mockResolvedValueOnce(titles("IQ-COO-0003-R1"))
      .mockResolvedValueOnce(titles("IQ-COO-0003-R1", "IQ-WAB-0004-R1"));
    graphFetch
      .mockRejectedValueOnce(DUPLICATE)
      .mockResolvedValueOnce({ id: "22" })
      .mockResolvedValueOnce(quoteItem(22));
    await createQuote(QUOTE_INPUT);
    const posts = calls("POST").map(([, b]) => (b.fields as Record<string, unknown>).Title);
    expect(posts).toEqual(["IQ-COO-0004-R1", "IQ-COO-0005-R1"]);
  });

  it("doesn't retry when the fresh read yields the same number", async () => {
    graphFetchAll.mockResolvedValue(titles("IQ-COO-0003-R1"));
    graphFetch.mockRejectedValueOnce(DUPLICATE);
    await expect(createQuote(QUOTE_INPUT)).rejects.toBe(DUPLICATE);
    expect(calls("POST")).toHaveLength(1);
  });

  it("surfaces any OTHER failure unchanged, with no re-read and no retry", async () => {
    const refused = Object.assign(new Error("Graph 403"), { status: 403, body: "accessDenied" });
    graphFetchAll.mockResolvedValue(titles());
    graphFetch.mockRejectedValueOnce(refused);
    await expect(createQuote(QUOTE_INPUT)).rejects.toBe(refused);
    expect(calls("POST")).toHaveLength(1);
    expect(graphFetchAll).toHaveBeenCalledTimes(1);
  });

  it("an edit conflict (409 resourceModified) is NOT treated as a duplicate", async () => {
    const conflict = Object.assign(new Error("Graph 409"), { status: 409, body: "resourceModified" });
    graphFetchAll.mockResolvedValue(titles());
    graphFetch.mockRejectedValueOnce(conflict);
    await expect(createQuote(QUOTE_INPUT)).rejects.toBe(conflict);
    expect(graphFetchAll).toHaveBeenCalledTimes(1);
  });
});

describe("quote writes", () => {
  const previous = toQuote(quoteItem(7) as never);

  it("updateQuoteFields sends only what changed, and nothing when nothing did", async () => {
    expect(await updateQuoteFields(7, { contactName: "Mark", status: "Draft" }, previous)).toBe(previous);
    expect(graphFetch).not.toHaveBeenCalled();

    graphFetch.mockResolvedValueOnce({}).mockResolvedValueOnce(quoteItem(7, { Status: "Sent", CustomerRefLookupId: "4" }));
    await updateQuoteFields(7, { status: "Sent", customerId: 4, contactName: "Mark" }, previous);
    const [[url, body]] = calls("PATCH");
    expect(url).toBe("/sites/pmo-site/lists/quotes-list/items/7/fields");
    expect(body).toEqual({ Status: "Sent", CustomerRefLookupId: 4 });
  });

  it("setQuoteLinks is its own PATCH of only the given Hyperlink", async () => {
    graphFetch.mockResolvedValueOnce({}).mockResolvedValueOnce(quoteItem(7));
    await setQuoteLinks(7, { engineeringTaskLink: { url: "https://arc/task/9", description: "T9" } });
    expect(calls("PATCH")).toEqual([
      [
        "/sites/pmo-site/lists/quotes-list/items/7/fields",
        { EngineeringTaskLink: { Url: "https://arc/task/9", Description: "T9" } },
      ],
    ]);
  });

  it("setQuoteWatchers resolves on PMO and writes the two-key shape; refuses when nobody resolves", async () => {
    graphFetch.mockResolvedValueOnce({}).mockResolvedValueOnce(quoteItem(7));
    await setQuoteWatchers(7, [{ displayName: "A", email: "a@x.com" }, { displayName: "B", email: "b@x.com" }]);
    expect(calls("PATCH")[0][1]).toEqual({
      "WatchersLookupId@odata.type": "Collection(Edm.Int32)",
      WatchersLookupId: [40, 41],
    });

    resolvePeopleLookupIds.mockImplementationOnce(async (_s: string, _u: string, people: unknown[]) => people);
    await expect(setQuoteWatchers(7, [{ displayName: "C", email: "c@x.com" }])).rejects.toThrow(/couldn't resolve/);
  });

  it("a comment re-reads Communication and retries on an edit conflict", async () => {
    vi.useFakeTimers();
    try {
      const conflict = Object.assign(new Error("Graph 409"), { status: 409, body: "resourceModified" });
      graphFetch
        .mockResolvedValueOnce({ fields: { Communication: "" } })
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({ fields: { Communication: "" } })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce(quoteItem(7));
      const done = addQuoteComment(7, { authorName: "Ray", authorEmail: "ray@x.com", bodyHtml: "<p>hi</p>" });
      await vi.runAllTimersAsync();
      await done;
      const gets = calls("GET").filter(([u]) => u.includes("Communication)"));
      expect(gets).toHaveLength(2);
      const patches = calls("PATCH");
      expect(patches).toHaveLength(2);
      expect(String(patches[1][1].Communication)).toMatch(/\|\|\|Ray\|\|\|ray@x.com\|\|\|<p>hi<\/p>$/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("assemblies and items", () => {
  it("create writes QuoteRef (and AssemblyRef) as BARE integers", async () => {
    graphFetch
      .mockResolvedValueOnce({ id: "3" })
      .mockResolvedValueOnce({ id: "3", fields: { Title: "A", QuoteRefLookupId: "12" } })
      .mockResolvedValueOnce({ id: "8" })
      .mockResolvedValueOnce({ id: "8", fields: { Title: "C", QuoteRefLookupId: "12", AssemblyRefLookupId: "3" } });
    await createQuoteAssembly({
      quoteId: 12, lineNo: 1, altronicPartNumber: "A", sapPartNumber: "", customerPartNumber: "",
      description: "", priceBreaks: [], targetGM: 35, manualPrice: null, customerPrice: null,
      lineType: "Part", cost: 12.5, materialOverheadPct: 8, quotedQty: 3,
    });
    await createQuoteItem({
      quoteId: 12, assemblyId: 3, lineNo: 1, altronicPartNumber: "C", sapPartNumber: "",
      description: "", quantity: 2, cost: 5, materialOverheadPct: null,
      watchers: [{ displayName: "Ray", email: "ray@x.com" }],
    });
    const [[aUrl, a], [iUrl, i]] = calls("POST");
    expect(aUrl).toBe("/sites/pmo-site/lists/assemblies-list/items");
    expect((a.fields as Record<string, unknown>).QuoteRefLookupId).toBe(12);
    // The margin is the ASSEMBLY's; a component carries cost only.
    expect((a.fields as Record<string, unknown>).TargetGM).toBe(35);
    // A Part line carries its own cost; LineType is always sent.
    expect(a.fields).toMatchObject({ LineType: "Part", Cost: 12.5, MaterialOverheadPct: 8, QuotedQty: 3 });
    expect(i.fields).not.toHaveProperty("TargetGM");
    expect(iUrl).toBe("/sites/pmo-site/lists/items-list/items");
    expect(i.fields).toMatchObject({ QuoteRefLookupId: 12, AssemblyRefLookupId: 3, WatchersLookupId: [40] });
    expect(JSON.stringify(a) + JSON.stringify(i)).not.toMatch(/QuoteRefLookupId@odata/);
  });

  it("updates are diffed; unchanged sends nothing", async () => {
    const assembly = toQuoteAssembly({ id: "3", fields: { Title: "A", QuoteRefLookupId: "12", ManualPrice: 10 } } as never);
    const item = toQuoteItem({ id: "8", fields: { Title: "C", Cost: 5, AssemblyRefLookupId: "3" } } as never);
    await updateQuoteAssemblyFields(3, { manualPrice: 10 }, assembly);
    await updateQuoteItemFields(8, { cost: 5, assemblyId: 3 }, item);
    expect(graphFetch).not.toHaveBeenCalled();

    graphFetch.mockResolvedValue({ id: "8", fields: {} });
    await updateQuoteItemFields(8, { cost: 6, assemblyId: 4 }, item);
    expect(calls("PATCH")[0][1]).toEqual({ Cost: 6, AssemblyRefLookupId: 4 });

    // The target GM is an ASSEMBLY column now.
    await updateQuoteAssemblyFields(3, { targetGM: 40 }, assembly);
    expect(calls("PATCH")[1][1]).toEqual({ TargetGM: 40 });
  });

  it("delete: a 404 resolves, anything else throws", async () => {
    graphFetch.mockRejectedValueOnce(Object.assign(new Error("Graph 404"), { status: 404 }));
    await expect(deleteQuoteAssembly(3)).resolves.toBeUndefined();
    graphFetch.mockRejectedValueOnce(Object.assign(new Error("Graph 403"), { status: 403 }));
    await expect(deleteQuoteAssembly(3)).rejects.toThrow(/403/);
    expect(calls("DELETE")[0][0]).toBe("/sites/pmo-site/lists/assemblies-list/items/3");
  });
});

describe("customers and roles", () => {
  it("a duplicate code becomes QuoteCustomerCodeTakenError; other failures pass through", async () => {
    graphFetch.mockRejectedValueOnce(DUPLICATE);
    await expect(
      createQuoteCustomer({ name: "Cooper", code: "coo", customerNumber: "", note: "" }),
    ).rejects.toBeInstanceOf(QuoteCustomerCodeTakenError);
    expect(calls("POST")[0][1]).toEqual({ fields: { Title: "Cooper", CustomerCode: "COO", Active: true } });

    graphFetch.mockRejectedValueOnce(new Error("Graph 500"));
    await expect(
      createQuoteCustomer({ name: "X", code: "XX", customerNumber: "", note: "" }),
    ).rejects.toThrow(/500/);
  });

  it("a role row writes PersonName", async () => {
    graphFetch.mockResolvedValueOnce({ id: "1", fields: { Title: "a@x.com", Roles: "viewer" } });
    await createQuoteRoleEntry({ email: "a@x.com", displayName: "A", roles: ["viewer"], note: "" });
    expect(calls("POST")[0][1]).toEqual({ fields: { Title: "a@x.com", Roles: "viewer", PersonName: "A" } });
  });
});

describe("createQuoteRevision — order and re-parenting", () => {
  it("header → assemblies → items, each pointed at the NEW rows", async () => {
    const source = quoteItem(2, {
      Title: "IQ-COO-0042-R1",
      Communication: "10/01/2026 9:00:00 AM|||Ray|||ray@x.com|||<p>hi</p>",
      Watchers: [{ LookupId: 22, LookupValue: "Ray", Email: "ray@x.com" }],
      EngineeringTaskLink: { Url: "https://arc/task/9", Description: "T9" },
    });
    let nextId = 100;
    graphFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      if (method === "POST") return { id: String(nextId++) };
      if (method === "PATCH") return {};
      if (url.includes("/quotes-list/items/2?")) return source;
      if (url.includes("/quotes-list/items/")) return quoteItem(100, { Title: "IQ-COO-0042-R2", Rev: 2 });
      const m = /\/items\/(\d+)/.exec(url);
      return { id: m?.[1] ?? "0", fields: {} };
    });
    graphFetchAll.mockImplementation(async (url: string) => {
      if (url.includes("quotes-list")) return titles("IQ-COO-0042-R1");
      if (url.includes("assemblies-list")) {
        return [
          { id: "11", fields: { Title: "ASSY-1", QuoteRefLookupId: "2", LineNo: 1 } },
          { id: "12", fields: { Title: "ASSY-2", QuoteRefLookupId: "2", LineNo: 2 } },
          { id: "13", fields: { Title: "OTHER", QuoteRefLookupId: "9", LineNo: 1 } },
        ];
      }
      return [
        { id: "21", fields: { Title: "C1", QuoteRefLookupId: "2", AssemblyRefLookupId: "11", LineNo: 1, Quantity: 1 } },
        { id: "22", fields: { Title: "C2", QuoteRefLookupId: "2", AssemblyRefLookupId: "12", LineNo: 1, Quantity: 3 } },
        { id: "23", fields: { Title: "X", QuoteRefLookupId: "9", AssemblyRefLookupId: "13", LineNo: 1 } },
      ];
    });

    const { quote, warnings } = await createQuoteRevision(2);
    expect(warnings).toEqual([]);
    expect(quote.quoteNumber).toBe("IQ-COO-0042-R2");

    const posts = calls("POST");
    expect(posts.map(([u]) => u.split("/lists/")[1].split("/")[0])).toEqual([
      "quotes-list",
      "assemblies-list",
      "assemblies-list",
      "items-list",
      "items-list",
    ]);
    const header = posts[0][1].fields as Record<string, unknown>;
    expect(header).toMatchObject({ Title: "IQ-COO-0042-R2", QuoteBase: "IQ-COO-0042", Rev: 2, Status: "Draft" });
    expect(Object.keys(header).some((k) => /Link/.test(k))).toBe(false);
    expect(String(header.Communication)).toContain("<p>hi</p><p><em>— carried over from R1</em></p>");
    // Header id 100, assemblies 101/102 (from 11/12), items re-parented accordingly.
    expect(posts.slice(1, 3).map(([, b]) => (b.fields as Record<string, unknown>).QuoteRefLookupId)).toEqual([100, 100]);
    expect(posts.slice(3).map(([, b]) => b.fields)).toEqual([
      expect.objectContaining({ Title: "C1", QuoteRefLookupId: 100, AssemblyRefLookupId: 101 }),
      expect.objectContaining({ Title: "C2", QuoteRefLookupId: 100, AssemblyRefLookupId: 102, Quantity: 3 }),
    ]);
    // The link went in its own PATCH, after the header.
    expect(calls("PATCH")).toContainEqual([
      "/sites/pmo-site/lists/quotes-list/items/100/fields",
      { EngineeringTaskLink: { Url: "https://arc/task/9", Description: "T9" } },
    ]);
    expect(copyAttachments.mock.calls).toEqual([
      ["quote", 2, "quote", 100],
      ["quoteItem", 21, "quoteItem", 103],
      ["quoteItem", 22, "quoteItem", 104],
    ]);
  });

  it("collects a failed link PATCH and a failed attachment copy as warnings", async () => {
    graphFetch.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      if (method === "POST") return { id: "100" };
      if (method === "PATCH") throw new Error("Graph 400 invalidRequest");
      if (url.includes("/items/2?")) {
        return quoteItem(2, { EngineeringTaskLink: { Url: "https://arc/task/9", Description: "T9" } });
      }
      return quoteItem(100, { Title: "IQ-COO-0042-R2", Rev: 2 });
    });
    graphFetchAll.mockImplementation(async (url: string) =>
      url.includes("quotes-list") ? titles("IQ-COO-0042-R1") : [],
    );
    copyAttachments.mockResolvedValueOnce({ copied: [], failed: ["spec.pdf"] });
    const { quote, warnings } = await createQuoteRevision(2);
    expect(quote.id).toBe(100);
    expect(warnings).toEqual([
      "The task links weren't copied to R2: Graph 400 invalidRequest",
      "Quote attachments: spec.pdf didn't copy to R2.",
    ]);
  });
});
