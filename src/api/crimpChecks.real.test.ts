import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Crimp Height Checks in REAL mode — the request shapes the mock branch can't
// show:
//  - SpecRef is a SINGLE lookup, written as a bare integer;
//  - Average / OutOfSpec / Title are written derived from the readings;
//  - the year filter goes to SharePoint as a bare DateTimeOffset first, and a
//    refusal falls back to reading the list whole, filtered here;
//  - a duplicate spec (terminal + applicator + gauge) is refused before POST.
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
  return { ...actual, USE_MOCK: false, SP_CRIMP_CHECKS_LIST_ID: "check-list", SP_CRIMP_SPECS_LIST_ID: "spec-list" };
});

import { createCrimpCheck, listCrimpChecks, resetCrimpFilterProbe } from "./crimpChecks";
import { createCrimpSpec } from "./crimpSpecs";
import type { CrimpCheckInput } from "@/types/crimp";

const meta = { createdDateTime: "2026-10-27T10:00:00Z", lastModifiedDateTime: "2026-10-27T10:00:00Z" };

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  resetCrimpFilterProbe();
});

const input: CrimpCheckInput = {
  checkedAt: new Date("2026-10-27T13:00:00Z"),
  checkPoint: "Start",
  clockNumber: "342",
  snapshot: { specId: 5, terminal: "900330", wireGauge: "18", applicator: "BLUE", crimpHeight: 0.04, tolerance: 0.002 },
  readings: [0.04, 0.045, 0.039],
  applicatorChange: "",
  verifierClock: "",
  harnessOrAssembly: "",
  notes: "",
};

describe("createCrimpCheck (real mode)", () => {
  it("POSTs SpecRefLookupId as a bare integer with the derived columns", async () => {
    graphFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { id: "44" };
      return { id: "44", fields: { SpecRefLookupId: "5", OutOfSpec: true }, ...meta };
    });
    const created = await createCrimpCheck(input);

    const [url, init] = graphFetch.mock.calls[0];
    expect(url).toContain("/lists/check-list/items");
    const body = JSON.parse(init.body as string);
    expect(body.fields.SpecRefLookupId).toBe(5);
    expect(body.fields).toMatchObject({ OutOfSpec: true, Title: "900330 / 18 AWG / Start", Reading2: 0.045 });
    expect(Object.keys(body.fields).some((k) => k.includes("@odata.type"))).toBe(false);
    expect(created).toMatchObject({ id: 44, specId: 5, outOfSpec: true });
  });
});

describe("listCrimpChecks (real mode)", () => {
  it("asks SharePoint for one year with a bare DateTimeOffset", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listCrimpChecks({ kind: "year", year: 2026 });
    const url = graphFetchAll.mock.calls[0][0] as string;
    expect(url).toContain("$filter=fields/CheckedAt%20ge%202026-");
    expect(url).not.toContain("ge%20'");
  });

  it("falls back to the whole list, filtered by year here, when both filters are refused", async () => {
    graphFetchAll
      .mockRejectedValueOnce(new Error("refused"))
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValueOnce([
        { id: "1", fields: { CheckedAt: "2026-06-01T12:00:00Z" }, ...meta },
        { id: "2", fields: { CheckedAt: "2025-06-01T12:00:00Z" }, ...meta },
      ]);
    const checks = await listCrimpChecks({ kind: "year", year: 2026 });
    expect(checks.map((c) => c.id)).toEqual([1]);
    expect(graphFetchAll.mock.calls[2][0]).not.toContain("$filter");
  });
});

describe("createCrimpSpec (real mode)", () => {
  it("refuses a second spec for the same terminal, applicator and gauge", async () => {
    graphFetchAll.mockResolvedValue([
      { id: "1", fields: { Title: "900101", Applicator: "A1001", WireGauge: "14", Active: true }, ...meta },
    ]);
    await expect(
      createCrimpSpec({
        terminal: "900101",
        manufacturerPartNumber: "",
        applicator: "a1001",
        wireGauge: "14",
        tableHeight: "",
        wireSetting: "",
        insulationSetting: "",
        crimpHeight: 0.09,
        tolerance: 0.002,
        notes: "",
        active: true,
      }),
    ).rejects.toThrow(/already has a spec/);
    expect(graphFetch).not.toHaveBeenCalled();
  });
});
