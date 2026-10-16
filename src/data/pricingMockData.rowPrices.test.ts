import { describe, expect, it } from "vitest";
import { subAssemblyTotals } from "@/lib/pricingMath";
import { MOCK_NEW_PRODUCT_WORKSHEETS, MOCK_SUB_ASSEMBLIES } from "./pricingMockData";

// The demo worksheets' saved snapshots carry each row's own selling price by
// hand. A quote line pins to that snapshot, so it must say exactly what the
// maths says about the rows — or the demo would quote a price the worksheet
// page doesn't show.

describe("demo worksheets — a row's saved selling price matches its rows", () => {
  for (const ws of MOCK_NEW_PRODUCT_WORKSHEETS) {
    const snap = ws.history.find((h) => h.rev === ws.rev);
    if (!snap?.subAssemblies.some((s) => s.sellingPrice)) continue;
    it(`${ws.worksheetNumber} R${ws.rev}`, () => {
      const rows = MOCK_SUB_ASSEMBLIES.filter((s) => s.worksheetId === ws.id && s.rev === ws.rev);
      const computed = subAssemblyTotals(rows, snap.distributorDiscountPct);
      for (const saved of snap.subAssemblies.filter((s) => s.sellingPrice)) {
        const fresh = computed.find((c) => c.name === saved.name)?.sellingPrice;
        expect(fresh, saved.name).toBeDefined();
        expect(fresh!.listPrice, saved.name).toBe(saved.sellingPrice!.listPrice);
        expect(fresh!.distributorDiscountPct, saved.name).toBe(saved.sellingPrice!.distributorDiscountPct);
        expect(fresh!.unitCost!, saved.name).toBeCloseTo(saved.sellingPrice!.unitCost!, 2);
        expect(fresh!.baseGM!, saved.name).toBeCloseTo(saved.sellingPrice!.baseGM!, 1);
        expect(fresh!.priceBreaks, saved.name).toEqual(saved.sellingPrice!.priceBreaks);
      }
    });
  }
});
