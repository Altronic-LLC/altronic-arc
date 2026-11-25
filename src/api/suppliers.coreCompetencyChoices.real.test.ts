import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Core Competency's choices come from the LIVE column (Supply Chain added five
// on 2026-11-24 and will add more), with the built-in list only as the
// fallback. Real mode: the mock branch never reads a column.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll: vi.fn(),
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, SP_SUPPLIERS_LIST_ID: "suppliers-list" };
});

import { listSupplierCoreCompetencyChoices } from "./suppliers";
import { SITES } from "./config";
import { SUPPLIER_CORE_COMPETENCIES } from "@/types/task";

beforeEach(() => {
  graphFetch.mockReset();
});

describe("listSupplierCoreCompetencyChoices (real mode)", () => {
  it("reads the CoreCompetency column's choices off the PMO Suppliers List", async () => {
    graphFetch.mockResolvedValue({
      value: [
        { name: "Status", choice: { choices: ["Active"] } },
        { name: "CoreCompetency", choice: { choices: ["Assembly", "Packaging", "Brand New"] } },
      ],
    });
    await expect(listSupplierCoreCompetencyChoices()).resolves.toEqual(["Assembly", "Packaging", "Brand New"]);
    expect(graphFetch).toHaveBeenCalledWith(`/sites/${SITES.pmo}/lists/suppliers-list/columns?$select=name,choice`);
  });

  it("falls back to the built-in list when the column can't be read", async () => {
    graphFetch.mockRejectedValue(new Error("Graph 403"));
    await expect(listSupplierCoreCompetencyChoices()).resolves.toEqual([...SUPPLIER_CORE_COMPETENCIES]);
  });
});
