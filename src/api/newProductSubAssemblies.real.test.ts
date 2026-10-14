import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// NP Sub-Assemblies in REAL mode: saveRevisionRows' request shapes.
//   - a new row POSTs WorksheetRefLookupId as a BARE integer, plus Rev;
//   - a draft whose id belongs to ANOTHER revision is created fresh — the
//     other revision's row is never PATCHed (that is what keeps a new rev
//     from rewriting the old one);
//   - this revision's rows missing from the drafts are DELETEd, other
//     revisions' rows are never touched;
//   - a refused $filter falls back to a whole-list read.
//
// SP_NP_SUBASSEMBLIES_LIST_ID has NO default, so the config mock supplies it.
// `listSubAssemblies` remembers a refused filter in module state, so every
// test imports a FRESH copy of the module.
// =============================================================================

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
    SITES: { ...actual.SITES, salesTeam: "sales-site" },
    SP_NP_SUBASSEMBLIES_LIST_ID: "subs-list",
  };
});

import type { SubAssemblyDraft } from "./newProductSubAssemblies";
import type { SubAssemblyLine } from "@/types/pricing";

const LIST = "/sites/sales-site/lists/subs-list/items";
const LINE: SubAssemblyLine = { partNumber: "310001", description: "BOARD", quantity: 2, uploadedCost: 10, adjustedCost: null };

function row(id: number, rev: number, name: string, worksheetId = 3) {
  return {
    id: String(id),
    fields: { Title: name, WorksheetRefLookupId: String(worksheetId), Rev: rev, SortOrder: 1, Lines: JSON.stringify([LINE]) },
  };
}

function draft(id: number | null, name: string): SubAssemblyDraft {
  return { key: `k-${name}`, id, name, quantityPerProduct: 1, lines: [LINE], fileName: "", uploadedAt: null, uploadedBy: null };
}

const byMethod = (m: string) => graphFetch.mock.calls.filter(([, init]) => init?.method === m);
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

async function load() {
  vi.resetModules();
  return import("./newProductSubAssemblies");
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  graphFetch.mockResolvedValue({});
});

describe("saveRevisionRows", () => {
  it("POSTs a new row with WorksheetRefLookupId as a BARE integer and the revision being saved", async () => {
    graphFetchAll.mockResolvedValue([]);
    const { saveRevisionRows } = await load();
    await saveRevisionRows(3, 2, [draft(null, "Harness")]);

    const posts = byMethod("POST");
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe(LIST);
    const fields = bodyOf(posts[0]).fields;
    expect(fields.WorksheetRefLookupId).toBe(3);
    expect(fields).not.toHaveProperty("WorksheetRefLookupId@odata.type");
    expect(fields.Rev).toBe(2);
    expect(fields.Title).toBe("Harness");
    expect(JSON.parse(fields.Lines)).toEqual([LINE]);
  });

  it("PATCHes this revision's own row in place", async () => {
    graphFetchAll.mockResolvedValue([row(10, 1, "Harness")]);
    const { saveRevisionRows } = await load();
    await saveRevisionRows(3, 1, [draft(10, "Harness v2")]);
    expect(byMethod("POST")).toHaveLength(0);
    expect(byMethod("PATCH").map((c) => c[0])).toEqual([`${LIST}/10/fields`]);
    expect(bodyOf(byMethod("PATCH")[0]).Title).toBe("Harness v2");
  });

  it("creates a FRESH row for a draft whose id belongs to ANOTHER revision — never PATCHes the old row", async () => {
    graphFetchAll.mockResolvedValue([row(10, 1, "Harness"), row(11, 1, "Enclosure")]);
    const { saveRevisionRows } = await load();
    // Saving as revision 2: the drafts still carry revision 1's ids.
    await saveRevisionRows(3, 2, [draft(10, "Harness"), draft(11, "Enclosure")]);

    expect(byMethod("PATCH")).toHaveLength(0);
    expect(byMethod("DELETE")).toHaveLength(0);
    const posts = byMethod("POST");
    expect(posts).toHaveLength(2);
    for (const p of posts) {
      expect(bodyOf(p).fields.Rev).toBe(2);
      expect(bodyOf(p).fields.WorksheetRefLookupId).toBe(3);
    }
  });

  it("DELETEs this revision's rows missing from the drafts, and never touches another revision's", async () => {
    graphFetchAll.mockResolvedValue([row(10, 1, "Old A"), row(20, 2, "Keep"), row(21, 2, "Drop")]);
    const { saveRevisionRows } = await load();
    await saveRevisionRows(3, 2, [draft(20, "Keep")]);

    expect(byMethod("DELETE").map((c) => c[0])).toEqual([`${LIST}/21`]);
    expect(byMethod("PATCH").map((c) => c[0])).toEqual([`${LIST}/20/fields`]);
    const touched = graphFetch.mock.calls.map((c) => String(c[0]));
    expect(touched.some((p) => p.startsWith(`${LIST}/10`))).toBe(false);
  });
});

describe("listSubAssemblies", () => {
  it("filters on the indexed WorksheetRefLookupId", async () => {
    graphFetchAll.mockResolvedValue([row(10, 1, "A")]);
    const { listSubAssemblies } = await load();
    const rows = await listSubAssemblies(3);
    expect(String(graphFetchAll.mock.calls[0][0])).toContain("$filter=fields/WorksheetRefLookupId eq 3");
    expect(String(graphFetchAll.mock.calls[0][0])).toMatch(/WorksheetRef,WorksheetRefLookupId/);
    expect(rows.map((r) => r.id)).toEqual([10]);
  });

  it("falls back to a whole-list read, filtered in the browser, when the $filter request throws", async () => {
    graphFetchAll
      .mockRejectedValueOnce(new Error("Graph 400 — field not indexed"))
      .mockResolvedValueOnce([row(10, 1, "Mine"), row(11, 1, "Someone else's", 4)]);
    const { listSubAssemblies } = await load();
    const rows = await listSubAssemblies(3);
    expect(graphFetchAll).toHaveBeenCalledTimes(2);
    expect(String(graphFetchAll.mock.calls[1][0])).not.toContain("$filter");
    expect(rows.map((r) => r.id)).toEqual([10]);

    // Remembered for the session: the doomed filter isn't sent again.
    graphFetchAll.mockResolvedValueOnce([row(10, 1, "Mine")]);
    await listSubAssemblies(3);
    expect(String(graphFetchAll.mock.calls[2][0])).not.toContain("$filter");
  });

  it("a failure of the fallback read propagates", async () => {
    const boom = new Error("Graph 503");
    graphFetchAll.mockRejectedValueOnce(new Error("refused")).mockRejectedValueOnce(boom);
    const { listSubAssemblies } = await load();
    await expect(listSubAssemblies(3)).rejects.toBe(boom);
  });
});
