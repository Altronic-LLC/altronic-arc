import { beforeEach, describe, expect, it, vi } from "vitest";

// Supplier performance in REAL mode — the GraphQL sent to Fabric, the paging,
// and how a refusal reads. Invisible from mock mode, which builds no query.
// Every value here is invented; the repo is public.

const fabricQuery = vi.hoisted(() => vi.fn());

vi.mock("./fabric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fabric")>();
  return { ...actual, fabricQuery };
});

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, FABRIC_ENABLED: true };
});

import { FabricAuthError, FabricNotConfiguredError, FabricRequestError } from "./fabric";
import { describeSupplierPerformanceFailure, listSapSupplierPerformance } from "./supplierPerformance";

// A BLOCK body — a returned mock would run as the test's cleanup.
beforeEach(() => {
  fabricQuery.mockReset();
});

const row = (bp: string) => ({
  BP_NUMBER: bp,
  VENDOR_NAME: "Example Vendor",
  SUPPLIER_GROUP: "Production",
  PERIOD_YEAR: 2026,
  SUPPLIER_PCT: 80,
  QUALITY_PCT: 90,
  LOGISTICAL_PCT: 70,
  ALL_DELIVERIES: 12,
  CLASSIFICATION: "B",
});

const page = (bps: string[], next: string | null) => ({
  tbl_arc_supplier_performances: { items: bps.map(row), endCursor: next, hasNextPage: next !== null },
});

describe("listSapSupplierPerformance (real mode)", () => {
  it("reads the whole table, nine columns, a page at a time", async () => {
    fabricQuery.mockResolvedValue(page(["900001"], null));

    await listSapSupplierPerformance();

    const [query, variables] = fabricQuery.mock.calls[0];
    // The table was renamed from the misspelt `…_perfomance` on 2026-10-22;
    // the old name no longer answers.
    expect(query).toContain("tbl_arc_supplier_performances(first: 1000, after: $after)");
    expect(query).not.toContain("perfomance");
    expect(query).toContain(
      "items { BP_NUMBER VENDOR_NAME SUPPLIER_GROUP PERIOD_YEAR SUPPLIER_PCT QUALITY_PCT LOGISTICAL_PCT ALL_DELIVERIES CLASSIFICATION }",
    );
    expect(variables).toEqual({ after: null });
  });

  it("follows the cursor until the last page", async () => {
    fabricQuery
      .mockResolvedValueOnce(page(["900001", "900002"], "c1"))
      .mockResolvedValueOnce(page(["900003"], null));

    const out = await listSapSupplierPerformance();

    expect(fabricQuery).toHaveBeenCalledTimes(2);
    expect(fabricQuery.mock.calls[1][1]).toEqual({ after: "c1" });
    expect(out.map((r) => r.bpNumber)).toEqual(["900001", "900002", "900003"]);
    expect(out[0]).toMatchObject({ supplierPct: 80, qualityPct: 90, logisticalPct: 70, allDeliveries: 12, classification: "B" });
  });

  it("refuses a cursor that never ends rather than hand back a partial table", async () => {
    fabricQuery.mockResolvedValue(page(["900001"], "again"));
    await expect(listSapSupplierPerformance()).rejects.toThrow(/partial table/);
  });

  it("is empty when the table holds nothing", async () => {
    fabricQuery.mockResolvedValue({ tbl_arc_supplier_performances: { items: null, hasNextPage: false } });
    expect(await listSapSupplierPerformance()).toEqual([]);
  });
});

describe("describeSupplierPerformanceFailure", () => {
  it("says ARC's figures are showing, whatever the reason", () => {
    for (const err of [
      new FabricNotConfiguredError("x"),
      new FabricAuthError("x", "needs-consent"),
      new FabricRequestError("x", "http", { status: 403 }),
      new FabricRequestError("x", "transport"),
    ]) {
      expect(describeSupplierPerformanceFailure(err)).toMatch(/Showing the scores entered in ARC\.$/);
    }
  });

  it("tells a refused read from an unreachable one", () => {
    expect(describeSupplierPerformanceFailure(new FabricRequestError("x", "http", { status: 403 }))).toMatch(
      /can't read SAP supplier performance/,
    );
    expect(describeSupplierPerformanceFailure(new FabricRequestError("x", "transport"))).toMatch(/Couldn't reach SAP/);
    expect(describeSupplierPerformanceFailure(new FabricAuthError("x", "needs-consent"))).toMatch(/Fabric access/);
  });

  it("passes an account problem's own explanation through", () => {
    expect(describeSupplierPerformanceFailure(new FabricAuthError("Your password has expired.", "account"))).toMatch(
      /^Your password has expired\./,
    );
  });
});
