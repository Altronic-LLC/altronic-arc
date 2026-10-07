import { describe, expect, it } from "vitest";
import { REPORTS } from "./reports";

describe("REPORTS", () => {
  it("has a unique key and route per entry", () => {
    expect(new Set(REPORTS.map((r) => r.key)).size).toBe(REPORTS.length);
    expect(new Set(REPORTS.map((r) => r.route)).size).toBe(REPORTS.length);
  });

  it("every route lives under /reports/", () => {
    expect(REPORTS.every((r) => r.route.startsWith("/reports/"))).toBe(true);
  });

  it("every entry carries one of the three department tags", () => {
    expect(REPORTS.every((r) => ["ICT", "DIG", "IGN"].includes(r.department))).toBe(true);
  });

  it("tags Teradyne ICT, Digital QC DIG, and Ignition QC IGN", () => {
    const byKey = Object.fromEntries(REPORTS.map((r) => [r.key, r.department]));
    expect(byKey["teradyne-fpy"]).toBe("ICT");
    expect(byKey["teradyne-defects"]).toBe("ICT");
    expect(byKey["digital-qc-fpy"]).toBe("DIG");
    expect(byKey["digital-qc-defects"]).toBe("DIG");
    expect(byKey["ignition-qc-fpy"]).toBe("IGN");
    expect(byKey["ignition-qc-defects"]).toBe("IGN");
  });

  it("every department tag has at least one report", () => {
    for (const dept of ["ICT", "DIG", "IGN"] as const) {
      expect(REPORTS.some((r) => r.department === dept)).toBe(true);
    }
  });
});
