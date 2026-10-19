import { beforeEach, describe, expect, it, vi } from "vitest";

// The customer search in REAL mode (Ray, 2026-10-17) — `vw_sales_customers`,
// three fields mapped straight: the Sold-to # box searches CUSTOMER
// (startsWith), the Customer name box searches CUSTOMER_NAME (contains, as
// typed / Title Case / UPPER CASE — the warehouse matches case exactly).

const fabricQuery = vi.hoisted(() => vi.fn());

vi.mock("./fabric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fabric")>();
  return { ...actual, fabricQuery };
});

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, FABRIC_ENABLED: true };
});

import { searchSapCustomers } from "./pricingLookup";

// A BLOCK body — a returned mock would run as the test's cleanup.
beforeEach(() => {
  fabricQuery.mockReset();
});

describe("searchSapCustomers (real mode)", () => {
  it("searches CUSTOMER_NAME for a name as typed, Title Case and UPPER CASE — through variables", async () => {
    fabricQuery.mockResolvedValue({
      vw_sales_customers: {
        items: [
          { CUSTOMER: "900101", CUSTOMER_NAME: "Northwind, LLC", CUSTOMER_GROUP: "Z9", CUSTOMER_GROUP_LABEL: "Z9 — Demo Group" },
          { CUSTOMER: "900101", CUSTOMER_NAME: "Northwind, LLC", CUSTOMER_GROUP: "Z9", CUSTOMER_GROUP_LABEL: "Z9 — Demo Group" },
          { CUSTOMER: "900102", CUSTOMER_NAME: "R&D Demo Supply Co", CUSTOMER_GROUP: null, CUSTOMER_GROUP_LABEL: "(not mapped)" },
        ],
      },
    });

    const out = await searchSapCustomers("  northwind ", "name");

    const [query, variables] = fabricQuery.mock.calls[0];
    expect(query).toContain("vw_sales_customers(first: 25, filter: { or: [");
    expect(query).toContain("{ CUSTOMER_NAME: { contains: $q0 } }");
    expect(query).not.toContain("CUSTOMER_LABEL");
    expect(query).toContain("items { CUSTOMER CUSTOMER_NAME CUSTOMER_GROUP CUSTOMER_GROUP_LABEL }");
    expect(variables).toEqual({ q0: "northwind", q1: "Northwind", q2: "NORTHWIND" });
    // One per sold-to, sorted by name; a group SAP hasn't mapped is blank.
    expect(out).toEqual([
      { soldTo: "900101", name: "Northwind, LLC", customerGroup: "Z9", customerGroupLabel: "Z9 — Demo Group" },
      { soldTo: "900102", name: "R&D Demo Supply Co", customerGroup: "", customerGroupLabel: undefined },
    ]);
  });

  it("searches a sold-to number against the START of CUSTOMER, once", async () => {
    fabricQuery.mockResolvedValue({ vw_sales_customers: { items: [] } });
    await searchSapCustomers(" 9001 ", "number");
    const [query, variables] = fabricQuery.mock.calls[0];
    expect(query).toContain("filter: { CUSTOMER: { startsWith: $q0 } }");
    expect(query).not.toContain("or:");
    expect(variables).toEqual({ q0: "9001" });
  });

  it("asks nothing for fewer than 2 characters", async () => {
    expect(await searchSapCustomers("4", "number")).toEqual([]);
    expect(await searchSapCustomers("e", "name")).toEqual([]);
    expect(fabricQuery).not.toHaveBeenCalled();
  });
});
