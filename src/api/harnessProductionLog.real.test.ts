import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// The Harness Production Log in REAL mode — the request shapes, which none of
// the mock-mode tests can see:
//  - PartNumber is a SINGLE lookup: read as `PartNumberLookupId`, written as a
//    bare integer, never `multiLookupField`'s Collection(Edm.Int32) shape;
//  - the year filter goes to SharePoint as a bare DateTimeOffset first;
//  - DataQualityNotes / LegacySource are never part of a write;
//  - a part-number rename never re-sends Active.
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
    SP_HARNESS_PRODUCTION_LOG_LIST_ID: "log-list",
    SP_HARNESS_PART_NUMBERS_LIST_ID: "part-list",
  };
});

import {
  buildHarnessLogFields,
  createHarnessLogEntry,
  deleteHarnessLogEntry,
  listHarnessLog,
  listHarnessPartUsage,
  listHarnessRecentCodes,
  recentCodesSince,
  resetHarnessFilterProbe,
  updateHarnessLogEntry,
} from "./harnessProductionLog";
import { setHarnessPartNumberActive, updateHarnessPartNumber } from "./harnessPartNumbers";
import type { HarnessLogInput } from "@/types/task";

const parts = [{ id: "4", fields: { Title: "593027-15", Active: true } }];
const row = (id: string, date: string) => ({
  id,
  fields: { Title: "t", ProductionDate: date, PartNumberLookupId: "4", WorkOrder: "1" },
  createdDateTime: "2026-01-01T00:00:00Z",
  lastModifiedDateTime: "2026-01-01T00:00:00Z",
});

const input: HarnessLogInput = {
  productionDate: new Date("2026-03-05T12:00:00Z"),
  workOrder: " 1002089401 ",
  partLookupId: 4,
  quantity: 50,
  reworkQuantity: 0,
  comments: "",
  builtBy: "278",
  visualCheck: "",
};

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  resetHarnessFilterProbe();
});

describe("listHarnessLog", () => {
  it("selects the lookup id, filters the year server-side with a bare literal, and joins the part", async () => {
    graphFetchAll.mockImplementation(async (url: string) =>
      url.includes("part-list") ? parts : [row("1", "2025-04-01T12:00:00Z")],
    );
    const result = await listHarnessLog({ kind: "year", year: 2025 });
    const logUrl = graphFetchAll.mock.calls.map((c) => c[0] as string).find((u) => u.includes("log-list"))!;
    expect(logUrl).toContain("PartNumberLookupId");
    expect(logUrl).toContain("$filter=fields/ProductionDate%20ge%202025-01-01T00:00:00Z");
    expect(result.filteredServerSide).toBe(true);
    expect(result.entries[0].part).toEqual({ lookupId: 4, title: "593027-15" });
  });

  it("falls back to filtering in the browser when SharePoint refuses, and remembers", async () => {
    graphFetchAll.mockImplementation(async (url: string) => {
      if (url.includes("part-list")) return parts;
      if (url.includes("$filter")) throw new Error("refused");
      return [row("1", "2025-04-01T12:00:00Z"), row("2", "2024-04-01T12:00:00Z")];
    });
    const first = await listHarnessLog({ kind: "year", year: 2025 });
    expect(first.filteredServerSide).toBe(false);
    expect(first.entries.map((e) => e.id)).toEqual([1]);

    graphFetchAll.mockClear();
    await listHarnessLog({ kind: "year", year: 2025 });
    const logCalls = graphFetchAll.mock.calls.map((c) => c[0] as string).filter((u) => u.includes("log-list"));
    expect(logCalls).toHaveLength(1);
    expect(logCalls[0]).not.toContain("$filter");
  });

  it("asks for no filter at all for every year", async () => {
    graphFetchAll.mockImplementation(async (url: string) => (url.includes("part-list") ? parts : []));
    const result = await listHarnessLog({ kind: "all" });
    expect(graphFetchAll.mock.calls.some((c) => (c[0] as string).includes("$filter"))).toBe(false);
    expect(result.filteredServerSide).toBe(true);
  });
});

describe("writes", () => {
  it("writes the part as a bare integer, the date at midday UTC, and never the import columns", () => {
    const fields = buildHarnessLogFields(input, "593027-15");
    expect(fields.PartNumberLookupId).toBe(4);
    expect(fields.ProductionDate).toBe("2026-03-05T12:00:00Z");
    expect(fields.Title).toBe("593027-15 / WO 1002089401");
    expect(fields.WorkOrder).toBe("1002089401");
    expect(Object.keys(fields).some((k) => k.includes("@odata.type"))).toBe(false);
    expect(fields).not.toHaveProperty("DataQualityNotes");
    expect(fields).not.toHaveProperty("LegacySource");
  });

  it("creates with POST { fields } and reads the row back", async () => {
    graphFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { id: "30" };
      return row("30", "2026-03-05T12:00:00Z");
    });
    graphFetchAll.mockResolvedValue(parts);
    const created = await createHarnessLogEntry(input, "593027-15");
    const post = graphFetch.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(post[0]).toBe(`/sites/${(await import("./config")).SITES.pmo}/lists/log-list/items`);
    expect(JSON.parse(post[1].body).fields.PartNumberLookupId).toBe(4);
    expect(created.id).toBe(30);
  });

  it("updates with PATCH …/fields", async () => {
    graphFetch.mockImplementation(async () => row("30", "2026-03-05T12:00:00Z"));
    graphFetchAll.mockResolvedValue(parts);
    await updateHarnessLogEntry(30, input, "593027-15");
    const patch = graphFetch.mock.calls.find((c) => c[1]?.method === "PATCH")!;
    expect(patch[0]).toMatch(/\/items\/30\/fields$/);
  });

  it("deletes with DELETE", async () => {
    graphFetch.mockResolvedValue(undefined);
    await deleteHarnessLogEntry(30);
    expect(graphFetch.mock.calls[0][1]).toEqual({ method: "DELETE" });
  });

  it("counts part usage from the lookup column alone", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "1", fields: { PartNumberLookupId: "4" } },
      { id: "2", fields: { PartNumberLookupId: 4 } },
      { id: "3", fields: {} },
    ]);
    const usage = await listHarnessPartUsage();
    expect(usage.get(4)).toBe(2);
    expect(graphFetchAll.mock.calls[0][0]).toContain("$select=PartNumberLookupId)");
  });
});

describe("listHarnessRecentCodes", () => {
  const today = new Date("2026-10-08T15:00:00Z");

  it("reads only the three columns it needs, from 12 months back, filtered server-side", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "1", fields: { ProductionDate: "2026-01-05T12:00:00Z", BuiltBy: "342", VisualCheck: "208" } },
      { id: "2", fields: { ProductionDate: "2026-02-05T12:00:00Z", BuiltBy: "PJ" } },
    ]);
    const codes = await listHarnessRecentCodes(today);
    const url = graphFetchAll.mock.calls[0][0] as string;
    expect(url).toContain("$select=ProductionDate,BuiltBy,VisualCheck)");
    expect(url).toContain("$filter=fields/ProductionDate%20ge%202025-10-08T00:00:00Z");
    expect(url).not.toContain("part-list");
    expect(codes).toEqual({ builtBy: ["342", "PJ"], visualCheck: ["208", ""] });
  });

  it("filters in the browser when SharePoint refuses the filter", async () => {
    graphFetchAll.mockImplementation(async (url: string) => {
      if (url.includes("$filter")) throw new Error("refused");
      return [
        { id: "1", fields: { ProductionDate: "2026-01-05T12:00:00Z", BuiltBy: "342" } },
        { id: "2", fields: { ProductionDate: "2024-01-05T12:00:00Z", BuiltBy: "LEFT-2024" } },
        { id: "3", fields: { BuiltBy: "UNDATED" } },
      ];
    });
    const codes = await listHarnessRecentCodes(today);
    expect(codes.builtBy).toEqual(["342"]);
  });
});

describe("recentCodesSince", () => {
  it("is midnight UTC twelve months back", () => {
    expect(recentCodesSince(new Date("2026-10-08T15:00:00Z")).toISOString()).toBe("2025-10-08T00:00:00.000Z");
  });
});

describe("part numbers", () => {
  it("never re-sends Active on a rename", async () => {
    graphFetchAll.mockResolvedValue(parts);
    graphFetch.mockResolvedValue({ id: "4", fields: { Title: "593027-16", Active: false } });
    await updateHarnessPartNumber(4, { title: "593027-16", description: "x", active: true });
    const patch = graphFetch.mock.calls.find((c) => c[1]?.method === "PATCH")!;
    expect(JSON.parse(patch[1].body)).toEqual({ Title: "593027-16", Description: "x", Note: "" });
  });

  it("retires by writing Active alone", async () => {
    graphFetch.mockResolvedValue({ id: "4", fields: { Title: "593027-15", Active: false } });
    const part = await setHarnessPartNumberActive(4, false);
    const patch = graphFetch.mock.calls.find((c) => c[1]?.method === "PATCH")!;
    expect(JSON.parse(patch[1].body)).toEqual({ Active: false });
    expect(part.active).toBe(false);
  });
});
