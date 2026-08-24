import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_OPEN_ORDERS_CUSTOMERS_LIST_ID, USE_MOCK } from "./config";
import type { OpenOrderCustomerAccount, OpenOrderCustomerAccountInput } from "@/types/task";
import { MOCK_OPEN_ORDER_ACCOUNTS } from "@/data/openOrdersMockData";

// =============================================================================
// The managed customer list — who gets an individual workbook each week.
//
// One row per account, on SITES.salesTeam. Follows the standard per-list
// pattern: this module owns the USE_MOCK branch and the column names, and
// hooks/useOpenOrdersCustomers.ts owns the caching.
//
// Two things about the columns:
//
//  - **`Title` is the sold-to ACCOUNT NUMBER**, not a name. It's the join key
//    onto the extract, and SAP pads it with leading zeros ("0001042" against a
//    typed "1042"), so every comparison goes through `sameAccount` in
//    lib/openOrders.ts rather than `===`.
//  - **`CustomerName` is the customer-facing name**, and it exists because SAP
//    truncates its own Customer Name at 30 characters. The workbook a customer
//    receives is named from this column.
//
// `Active` is a real column rather than deleting a row: an account that comes
// off the weekly run usually comes back, and the history of who was on the
// list is worth more than a tidy list.
// =============================================================================

const LIST = () => SP_OPEN_ORDERS_CUSTOMERS_LIST_ID;

const SELECT = "Title,CustomerName,RegionalManager,Active,Notes";

interface GraphItem {
  id: string;
  fields?: Record<string, unknown>;
}

/** In-memory store so mock mode can add/edit/remove like the real thing. */
let mockAccounts: OpenOrderCustomerAccount[] | null = null;

function mockStore(): OpenOrderCustomerAccount[] {
  mockAccounts ??= MOCK_OPEN_ORDER_ACCOUNTS.map((a) => ({ ...a }));
  return mockAccounts;
}

/** Test seam — reset the mock store between tests. */
export function resetMockCustomers(): void {
  mockAccounts = null;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toAccount(item: GraphItem): OpenOrderCustomerAccount {
  const f = item.fields ?? {};
  return {
    id: Number.parseInt(item.id, 10),
    accountNumber: text(f.Title),
    customerName: text(f.CustomerName),
    regionalManager: text(f.RegionalManager),
    // A missing Active column reads as ACTIVE. The alternative — treating an
    // unset flag as inactive — would silently drop every customer from the
    // weekly run the moment the column was added, which is the failure nobody
    // would think to look for.
    active: f.Active === undefined || f.Active === null ? true : f.Active === true,
    notes: text(f.Notes),
  };
}

function toFields(input: OpenOrderCustomerAccountInput): Record<string, unknown> {
  return {
    Title: input.accountNumber.trim(),
    CustomerName: input.customerName.trim(),
    RegionalManager: input.regionalManager.trim(),
    Active: input.active,
    Notes: input.notes.trim(),
  };
}

export class OpenOrdersCustomersUnconfiguredError extends Error {
  constructor() {
    super(
      "The Open Orders customer list isn't set up yet. Create it with " +
        "scripts/create-open-orders-lists.ps1 and set " +
        "VITE_SP_OPEN_ORDERS_CUSTOMERS_LIST_ID.",
    );
    this.name = "OpenOrdersCustomersUnconfiguredError";
  }
}

export async function listOpenOrdersCustomers(): Promise<OpenOrderCustomerAccount[]> {
  if (USE_MOCK) return mockStore().map((a) => ({ ...a }));
  if (!LIST()) throw new OpenOrdersCustomersUnconfiguredError();
  const items = await graphFetchAll<GraphItem>(
    `/sites/${SITES.salesTeam}/lists/${LIST()}/items?$expand=fields($select=${SELECT})&$top=500`,
  );
  return items.map(toAccount).sort(byCustomerName);
}

/** Alphabetical by the customer-facing name — how people look one up. */
function byCustomerName(a: OpenOrderCustomerAccount, b: OpenOrderCustomerAccount): number {
  return (a.customerName || a.accountNumber).localeCompare(b.customerName || b.accountNumber);
}

export async function createOpenOrdersCustomer(
  input: OpenOrderCustomerAccountInput,
): Promise<OpenOrderCustomerAccount> {
  if (USE_MOCK) {
    const store = mockStore();
    const created: OpenOrderCustomerAccount = {
      id: Math.max(0, ...store.map((a) => a.id)) + 1,
      accountNumber: input.accountNumber.trim(),
      customerName: input.customerName.trim(),
      regionalManager: input.regionalManager.trim(),
      active: input.active,
      notes: input.notes.trim(),
    };
    store.push(created);
    return { ...created };
  }
  if (!LIST()) throw new OpenOrdersCustomersUnconfiguredError();
  const res = await graphFetch<GraphItem>(`/sites/${SITES.salesTeam}/lists/${LIST()}/items`, {
    method: "POST",
    body: JSON.stringify({ fields: toFields(input) }),
  });
  return toAccount(res);
}

export async function updateOpenOrdersCustomer(
  id: number,
  input: OpenOrderCustomerAccountInput,
): Promise<OpenOrderCustomerAccount> {
  if (USE_MOCK) {
    const store = mockStore();
    const index = store.findIndex((a) => a.id === id);
    if (index === -1) throw new Error(`No customer with id ${id}.`);
    store[index] = {
      id,
      accountNumber: input.accountNumber.trim(),
      customerName: input.customerName.trim(),
      regionalManager: input.regionalManager.trim(),
      active: input.active,
      notes: input.notes.trim(),
    };
    return { ...store[index] };
  }
  if (!LIST()) throw new OpenOrdersCustomersUnconfiguredError();
  await graphFetch(`/sites/${SITES.salesTeam}/lists/${LIST()}/items/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(toFields(input)),
  });
  return { id, ...input };
}

/**
 * Remove an account from the list entirely.
 *
 * Deactivating is the normal way to take somebody off the weekly run — this is
 * for a row added in error. The UI leads with Active for that reason.
 */
export async function deleteOpenOrdersCustomer(id: number): Promise<void> {
  if (USE_MOCK) {
    const store = mockStore();
    const index = store.findIndex((a) => a.id === id);
    if (index !== -1) store.splice(index, 1);
    return;
  }
  if (!LIST()) throw new OpenOrdersCustomersUnconfiguredError();
  await graphFetch(`/sites/${SITES.salesTeam}/lists/${LIST()}/items/${id}`, { method: "DELETE" });
}
