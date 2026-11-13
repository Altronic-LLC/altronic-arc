import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Conformal Coating Checks in REAL mode — the request shapes the mock branch
// can't show:
//  - SpecRef is a SINGLE lookup, written as a bare integer;
//  - the averages, ThicknessMm (judged), ThicknessMils (reference), OutOfSpec
//    and Title are written derived from the readings;
//  - the year filter goes to SharePoint as a bare DateTimeOffset first, and a
//    refusal falls back to reading the list whole, filtered here;
//  - a spec with a duplicate name, or without both limits, is refused before POST.
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
  return { ...actual, USE_MOCK: false, SP_COATING_CHECKS_LIST_ID: "check-list", SP_COATING_SPECS_LIST_ID: "spec-list" };
});

import { createCoatingCheck, listCoatingChecks, resetCoatingFilterProbe } from "./coatingChecks";
import { createCoatingSpec } from "./coatingSpecs";
import type { CoatingCheckInput, CoatingSpecInput } from "@/types/coating";

const meta = { createdDateTime: "2026-11-04T10:00:00Z", lastModifiedDateTime: "2026-11-04T10:00:00Z" };

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  resetCoatingFilterProbe();
});

const input: CoatingCheckInput = {
  measuredAt: new Date(2026, 10, 4, 7, 15),
  machine: " SPRAY-1 ",
  operator: "Demo Operator",
  unit: "mm",
  snapshot: { specId: 3, specName: "Acrylic", minMm: 0.025, maxMm: 0.075, specUnit: "mm", coatedSides: 1 },
  uncoated: [1.575, 1.577, 1.576],
  coated: [1.66, 1.662, 1.661],
  notes: "",
};

describe("createCoatingCheck (real mode)", () => {
  it("POSTs SpecRefLookupId as a bare integer with the derived columns", async () => {
    graphFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { id: "44" };
      return { id: "44", fields: { SpecRefLookupId: "3", OutOfSpec: true, Unit: "mm" }, ...meta };
    });
    const created = await createCoatingCheck(input);

    const [url, init] = graphFetch.mock.calls[0];
    expect(url).toContain("/lists/check-list/items");
    const body = JSON.parse(init.body as string);
    expect(body.fields.SpecRefLookupId).toBe(3);
    // 1.661 − 1.576 = 0.085 mm, one side: over the 0.075 mm maximum.
    expect(body.fields).toMatchObject({
      Title: "SPRAY-1 / Acrylic / 2026-11-04",
      Machine: "SPRAY-1",
      Unit: "mm",
      UncoatedAverage: 1.576,
      CoatedAverage: 1.661,
      ThicknessMm: 0.085,
      ThicknessIn: 0.003346,
      ThicknessMils: 3.35,
      OutOfSpec: true,
      MinMm: 0.025,
      MaxMm: 0.075,
      SpecUnit: "mm",
      CoatedSides: 1,
    });
    expect(Object.keys(body.fields).some((k) => k.includes("@odata.type"))).toBe(false);
    expect(graphFetch.mock.calls[1][0]).toContain("ThicknessMm");
    expect(created).toMatchObject({ id: 44, specId: 3, outOfSpec: true });
  });
});

describe("listCoatingChecks (real mode)", () => {
  it("asks SharePoint for one year with a bare DateTimeOffset", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listCoatingChecks({ kind: "year", year: 2026 });
    const url = graphFetchAll.mock.calls[0][0] as string;
    expect(url).toContain("$filter=fields/MeasuredAt%20ge%202026-");
    expect(url).not.toContain("ge%20'");
  });

  it("falls back to the whole list, filtered by year here, when both filters are refused", async () => {
    graphFetchAll
      .mockRejectedValueOnce(new Error("refused"))
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValueOnce([
        { id: "1", fields: { MeasuredAt: "2026-06-01T12:00:00Z" }, ...meta },
        { id: "2", fields: { MeasuredAt: "2025-06-01T12:00:00Z" }, ...meta },
      ]);
    const checks = await listCoatingChecks({ kind: "year", year: 2026 });
    expect(checks.map((c) => c.id)).toEqual([1]);
    expect(graphFetchAll.mock.calls[2][0]).not.toContain("$filter");
  });
});

describe("createCoatingSpec (real mode)", () => {
  const spec: CoatingSpecInput = { name: "acrylic", minMm: 0.025, maxMm: 0.075, specUnit: "mm", coatedSides: 2, notes: "", active: true };

  it("refuses a second spec with the same name", async () => {
    graphFetchAll.mockResolvedValue([{ id: "1", fields: { Title: "Acrylic", Active: true }, ...meta }]);
    await expect(createCoatingSpec(spec)).rejects.toThrow(/already a spec called "Acrylic"/);
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it("refuses a spec that couldn't judge a check", async () => {
    await expect(createCoatingSpec({ ...spec, maxMm: null })).rejects.toThrow(/both the minimum and the maximum/);
    await expect(createCoatingSpec({ ...spec, minMm: 0.1 })).rejects.toThrow(/can't be less than the minimum/);
    expect(graphFetchAll).not.toHaveBeenCalled();
  });

  it("writes the limits in mm and the coated sides", async () => {
    graphFetchAll.mockResolvedValue([]);
    graphFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? { id: "9" } : { id: "9", fields: { Title: "acrylic", MinMm: 0.025, MaxMm: 0.075, CoatedSides: 2 }, ...meta },
    );
    const created = await createCoatingSpec(spec);
    const body = JSON.parse(graphFetch.mock.calls[0][1].body as string);
    expect(body.fields).toEqual({ Title: "acrylic", MinMm: 0.025, MaxMm: 0.075, SpecUnit: "mm", CoatedSides: 2, Notes: "", Active: true });
    expect(created).toMatchObject({ id: 9, minMm: 0.025, maxMm: 0.075, coatedSides: 2 });
  });
});
