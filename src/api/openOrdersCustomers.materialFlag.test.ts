import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// The Customer Material Number flag, in REAL mode.
//
// Two things here are invisible from mock mode, which is why this file forces
// the real branch rather than extending a mock-mode test:
//
//  1. **A missing or unset column reads as FALSE.** This is the opposite
//     default from `Active`, and deliberately so: the day the SharePoint
//     column is created, every existing row is unset, and reading that as
//     "yes" would add a column to ~70 customer-facing workbooks at once with
//     nobody having asked for it.
//  2. **The flag is actually SENT** on a create and an update. A field quietly
//     dropped from the write payload looks identical to one that saved, until
//     somebody reopens the row a week later.
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
    SP_OPEN_ORDERS_CUSTOMERS_LIST_ID: "customers-list",
  };
});

import {
  createOpenOrdersCustomer,
  listOpenOrdersCustomers,
  updateOpenOrdersCustomer,
} from "./openOrdersCustomers";

function row(id: string, fields: Record<string, unknown>) {
  return { id, fields: { Title: "1042", CustomerName: "Permian", ...fields } };
}

/** The `fields` object off the most recent write. */
function lastWrittenFields(): Record<string, unknown> {
  const body = graphFetch.mock.calls.at(-1)?.[1]?.body as string;
  const parsed = JSON.parse(body) as Record<string, unknown>;
  // A create wraps the columns in `fields`; a PATCH sends them bare.
  return (parsed.fields as Record<string, unknown>) ?? parsed;
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
});

describe("reading the flag", () => {
  it("is TRUE only when the column is explicitly true", async () => {
    graphFetchAll.mockResolvedValue([row("1", { IncludeCustomerMaterialNumber: true })]);
    const [account] = await listOpenOrdersCustomers();
    expect(account.includeCustomerMaterialNumber).toBe(true);
  });

  it("reads a MISSING column as false — nobody is opted in by the column appearing", async () => {
    graphFetchAll.mockResolvedValue([row("1", {})]);
    const [account] = await listOpenOrdersCustomers();
    expect(account.includeCustomerMaterialNumber).toBe(false);
    // The contrast that makes the point: Active defaults the OTHER way, and a
    // missing column there must not empty the weekly run.
    expect(account.active).toBe(true);
  });

  it("reads an explicit false, and a null, as false", async () => {
    graphFetchAll.mockResolvedValue([
      row("1", { IncludeCustomerMaterialNumber: false }),
      row("2", { IncludeCustomerMaterialNumber: null }),
    ]);
    const accounts = await listOpenOrdersCustomers();
    expect(accounts.map((a) => a.includeCustomerMaterialNumber)).toEqual([false, false]);
  });

  it("asks Graph for the column in the first place", async () => {
    graphFetchAll.mockResolvedValue([]);
    await listOpenOrdersCustomers();
    expect(graphFetchAll.mock.calls[0][0]).toContain("IncludeCustomerMaterialNumber");
  });
});

describe("writing the flag", () => {
  const input = {
    accountNumber: "1042",
    customerName: "Permian",
    active: true,
    includeCustomerMaterialNumber: true,
    notes: "",
  };

  it("sends it on a create", async () => {
    graphFetch.mockResolvedValue(row("9", { IncludeCustomerMaterialNumber: true }));
    await createOpenOrdersCustomer(input);
    expect(lastWrittenFields().IncludeCustomerMaterialNumber).toBe(true);
  });

  it("sends it on an update, including when turning it OFF", async () => {
    graphFetch.mockResolvedValue({});
    await updateOpenOrdersCustomer(9, { ...input, includeCustomerMaterialNumber: false });
    // Explicitly present and false — not simply omitted, which would leave a
    // previously-opted-in customer opted in.
    expect(lastWrittenFields()).toHaveProperty("IncludeCustomerMaterialNumber", false);
  });

  it("round-trips the flag back out of an update", async () => {
    graphFetch.mockResolvedValue({});
    const updated = await updateOpenOrdersCustomer(9, input);
    expect(updated.includeCustomerMaterialNumber).toBe(true);
  });
});
