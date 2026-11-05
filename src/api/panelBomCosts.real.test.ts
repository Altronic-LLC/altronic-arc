import { beforeEach, describe, expect, it, vi } from "vitest";

// The BOM Builder's SAP cost lookup in REAL mode (BusinessIT#59). Fabric
// refuses an `in` filter past 100 values (measured live 2026-11-05), so the
// numbers go in chunks of 100, sent together, each paged. All numbers here
// are invented.

const fabricQuery = vi.hoisted(() => vi.fn());

vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  USE_MOCK: false,
}));
vi.mock("./fabric", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fabric")>()),
  fabricQuery,
}));

import { describePanelBomCostFailure, FABRIC_IN_FILTER_LIMIT, listPanelBomCosts } from "./panelBomCosts";
import { FabricAuthError, FabricRequestError } from "./fabric";

beforeEach(() => fabricQuery.mockReset());

const sap = (i: number) => `9000-${String(i).padStart(4, "0")}-00`;

describe("listPanelBomCosts (real mode)", () => {
  it("asks in chunks of at most 100, through a variable, on the cost table", async () => {
    fabricQuery.mockResolvedValue({ tbl_cogs_material_apis: { items: [], hasNextPage: false } });
    const numbers = Array.from({ length: 250 }, (_, i) => sap(i));
    await listPanelBomCosts(numbers);
    expect(fabricQuery).toHaveBeenCalledTimes(3);
    for (const [query, vars] of fabricQuery.mock.calls) {
      expect(query).toContain("tbl_cogs_material_apis");
      expect(query).toContain("Material: { in: $saps }");
      expect((vars as { saps: string[] }).saps.length).toBeLessThanOrEqual(FABRIC_IN_FILTER_LIMIT);
    }
    const asked = fabricQuery.mock.calls.flatMap(([, v]) => (v as { saps: string[] }).saps);
    expect(new Set(asked).size).toBe(250);
  });

  it("takes the lowest plant's cost, reads 0 and missing as no cost, and follows the cursor", async () => {
    fabricQuery
      .mockResolvedValueOnce({
        tbl_cogs_material_apis: {
          items: [
            { Plant: "4300", Material: sap(1), UnitCost: 9 },
            { Plant: "4222", Material: sap(1), UnitCost: 7.04 },
            { Plant: "4222", Material: sap(2), UnitCost: 0 },
          ],
          hasNextPage: true,
          endCursor: "c1",
        },
      })
      .mockResolvedValueOnce({
        tbl_cogs_material_apis: { items: [{ Plant: "4222", Material: sap(3), UnitCost: "12.5" }], hasNextPage: false },
      });
    const costs = await listPanelBomCosts([sap(1), sap(2), sap(3), sap(4)]);
    expect(fabricQuery.mock.calls[1][1]).toMatchObject({ after: "c1" });
    expect(Object.fromEntries(costs)).toEqual({ [sap(1)]: 7.04, [sap(2)]: null, [sap(3)]: 12.5, [sap(4)]: null });
  });
});

describe("describePanelBomCostFailure", () => {
  it("hides cost, with no retry, when the account can't read it", () => {
    const refused = new FabricRequestError("x", "http", { status: 403 });
    expect(describePanelBomCostFailure(refused)).toMatchObject({ hidden: true, message: expect.stringMatching(/hidden/) });
    expect(describePanelBomCostFailure(new FabricAuthError("x", "needs-consent")).hidden).toBe(true);
  });
  it("offers a retry for anything else", () => {
    expect(describePanelBomCostFailure(new Error("network")).hidden).toBe(false);
  });
});
