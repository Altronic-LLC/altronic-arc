import { describe, expect, it } from "vitest";
import {
  indexSapSupplierPerformance,
  supplierBpKey,
  supplierPerformanceFor,
  toSapSupplierPerformance,
  type SapSupplierPerformance,
} from "./supplierPerformance";

// Invented figures throughout — the repo is public.

const sap = (bp: string, overrides: Partial<SapSupplierPerformance> = {}): SapSupplierPerformance => ({
  bpNumber: bp,
  vendorName: "Example Vendor",
  supplierGroup: "Production",
  periodYear: 2026,
  supplierPct: 80,
  qualityPct: 85,
  logisticalPct: 75,
  allDeliveries: 40,
  classification: "B",
  ...overrides,
});

const supplier = (bp: string) => ({
  businessPartnerNumber: bp,
  supplierPerformanceRate: 55,
  qualityPerformance: 60,
  logisticalPerformance: 50,
  allDeliveries: 9,
});

describe("supplierBpKey", () => {
  it("ignores SAP's zero padding and surrounding space", () => {
    expect(supplierBpKey(" 000103832 ")).toBe("103832");
    expect(supplierBpKey(103832)).toBe("103832");
  });

  it("is empty for a blank number, so it matches nothing", () => {
    expect(supplierBpKey("")).toBe("");
    expect(supplierBpKey(null)).toBe("");
  });
});

describe("toSapSupplierPerformance", () => {
  it("maps the warehouse's columns", () => {
    expect(
      toSapSupplierPerformance({
        BP_NUMBER: "900001",
        VENDOR_NAME: " Example Co ",
        SUPPLIER_GROUP: "Packaging",
        PERIOD_YEAR: 2026,
        SUPPLIER_PCT: 62,
        QUALITY_PCT: "70",
        LOGISTICAL_PCT: 55,
        ALL_DELIVERIES: 4,
        CLASSIFICATION: " c ",
      }),
    ).toEqual({
      bpNumber: "900001",
      vendorName: "Example Co",
      supplierGroup: "Packaging",
      periodYear: 2026,
      supplierPct: 62,
      qualityPct: 70,
      logisticalPct: 55,
      allDeliveries: 4,
      classification: "C",
    });
  });

  it("reads a missing figure as null, never 0 — a 0 would read as the worst score", () => {
    const out = toSapSupplierPerformance({ BP_NUMBER: "900002", LOGISTICAL_PCT: null, QUALITY_PCT: "", CLASSIFICATION: null });
    expect(out.logisticalPct).toBeNull();
    expect(out.qualityPct).toBeNull();
    expect(out.classification).toBeNull();
  });

  it("keeps a real 0", () => {
    expect(toSapSupplierPerformance({ BP_NUMBER: "1", LOGISTICAL_PCT: 0 }).logisticalPct).toBe(0);
  });
});

describe("indexSapSupplierPerformance", () => {
  it("keys rows by BP number", () => {
    const index = indexSapSupplierPerformance([sap("900001"), sap("900002")]);
    expect([...index.keys()]).toEqual(["900001", "900002"]);
  });

  it("keeps the LATEST year when a supplier has several", () => {
    const index = indexSapSupplierPerformance([
      sap("900001", { periodYear: 2026, supplierPct: 90 }),
      sap("900001", { periodYear: 2025, supplierPct: 10 }),
      sap("900001", { periodYear: null, supplierPct: 20 }),
    ]);
    expect(index.get("900001")?.supplierPct).toBe(90);
  });

  it("skips a row with no BP number", () => {
    expect(indexSapSupplierPerformance([sap("")]).size).toBe(0);
  });
});

describe("supplierPerformanceFor — SAP first, ARC's figures as the fallback", () => {
  const index = indexSapSupplierPerformance([sap("900001")]);

  it("uses SAP's figures when SAP has a row for the BP number", () => {
    expect(supplierPerformanceFor(supplier("900001"), index)).toEqual({
      source: "sap",
      supplierPct: 80,
      qualityPct: 85,
      logisticalPct: 75,
      allDeliveries: 40,
      classification: "B",
      periodYear: 2026,
    });
  });

  it("matches through SAP's zero padding", () => {
    expect(supplierPerformanceFor(supplier("000900001"), index).source).toBe("sap");
  });

  it("falls back to the scores typed into ARC when SAP has no row", () => {
    expect(supplierPerformanceFor(supplier("900999"), index)).toEqual({
      source: "arc",
      supplierPct: 55,
      qualityPct: 60,
      logisticalPct: 50,
      allDeliveries: 9,
      classification: null,
      periodYear: null,
    });
  });

  it("falls back when SAP couldn't be read", () => {
    expect(supplierPerformanceFor(supplier("900001"), null).source).toBe("arc");
  });

  it("never matches a supplier with no BP number", () => {
    const withBlank = indexSapSupplierPerformance([sap("0")]);
    expect(supplierPerformanceFor(supplier(""), withBlank).source).toBe("arc");
  });
});
