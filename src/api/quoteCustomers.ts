import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_QUOTE_CUSTOMERS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { QuoteCustomer } from "@/types/quote";
import {
  QUOTE_CUSTOMER_SELECT,
  applyQuoteCustomerPatch,
  buildQuoteCustomerCreateFields,
  buildQuoteCustomerUpdateFields,
  isUniqueValueRejection,
  toQuoteCustomer,
  type QuoteCustomerInput,
  type QuoteCustomerPatch,
} from "@/lib/quoteMapper";
import { nextMockId, quoteMockClone, quoteMockDb } from "@/data/quoteMockData";

// =============================================================================
// Quote Customers — name, generated code, SAP sold-to (PMO site).
//
// **No delete**, in the UI or here: quotes point at these rows, so a customer
// that has stopped buying is RETIRED (`Active = false`), which leaves every
// picker while every quote already naming it keeps showing it.
//
// `CustomerCode` has Enforce Unique Values in SharePoint, and is FROZEN at
// creation — `QuoteCustomerPatch` has no code key, so no edit can send it.
// A duplicate is refused by SharePoint and surfaces here as
// `QuoteCustomerCodeTakenError`, so the form can re-propose a code rather than
// show a raw 409.
// =============================================================================

/** The code is already on another customer — SharePoint's unique index said no. */
export class QuoteCustomerCodeTakenError extends Error {
  constructor(public code: string) {
    super(`The customer code "${code}" is already taken. Pick another code — or check this isn't a customer that already exists.`);
    this.name = "QuoteCustomerCodeTakenError";
  }
}

const ENV_VAR = "VITE_SP_QUOTE_CUSTOMERS_LIST_ID";

function requireListId(action: string): string {
  if (!SP_QUOTE_CUSTOMERS_LIST_ID) {
    throw new Error(`Cannot ${action}: the Quote Customers list isn't configured (${ENV_VAR} is not set).`);
  }
  return SP_QUOTE_CUSTOMERS_LIST_ID;
}

function listPath(listId: string): string {
  return `/sites/${SITES.pmo}/lists/${listId}/items`;
}

function compareCustomers(a: QuoteCustomer, b: QuoteCustomer): number {
  return a.name.localeCompare(b.name) || a.id - b.id;
}

/** Every customer, retired ones included, by name. `[]` when the list isn't configured. */
export async function listQuoteCustomers(): Promise<QuoteCustomer[]> {
  if (USE_MOCK) {
    return mockDelay([...quoteMockDb.customers].sort(compareCustomers).map(quoteMockClone.customer));
  }
  if (!SP_QUOTE_CUSTOMERS_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${listPath(SP_QUOTE_CUSTOMERS_LIST_ID)}?$expand=fields($select=${QUOTE_CUSTOMER_SELECT})&$top=999`,
  );
  return items.map(toQuoteCustomer).sort(compareCustomers);
}

/** Add a customer. A code already in use throws `QuoteCustomerCodeTakenError`. */
export async function createQuoteCustomer(input: QuoteCustomerInput): Promise<QuoteCustomer> {
  const code = input.code.trim().toUpperCase();
  if (USE_MOCK) {
    if (quoteMockDb.customers.some((c) => c.code.toUpperCase() === code)) {
      await mockDelay();
      throw new QuoteCustomerCodeTakenError(code);
    }
    const row: QuoteCustomer = {
      id: nextMockId(quoteMockDb.customers),
      name: input.name.trim(),
      code,
      customerNumber: input.customerNumber.trim(),
      active: input.active !== false,
      note: input.note,
    };
    quoteMockDb.customers.push(row);
    return mockDelay(quoteMockClone.customer(row));
  }

  const listId = requireListId("add a customer");
  try {
    const created = await graphFetch<GraphListItem>(listPath(listId), {
      method: "POST",
      body: JSON.stringify({ fields: buildQuoteCustomerCreateFields({ ...input, code }) }),
    });
    return toQuoteCustomer(created);
  } catch (err) {
    // Title (the name) isn't unique on this list, so a duplicate refusal can
    // only be the code.
    if (isUniqueValueRejection(err)) throw new QuoteCustomerCodeTakenError(code);
    throw err;
  }
}

/**
 * Edit a customer, DIFFED against `previous` — only changed columns travel,
 * and nothing is sent when nothing changed (the previous row comes back).
 * The code is never part of an edit.
 */
export async function updateQuoteCustomer(
  id: number,
  changes: QuoteCustomerPatch,
  previous: QuoteCustomer,
): Promise<QuoteCustomer> {
  if (USE_MOCK) {
    const idx = quoteMockDb.customers.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Quote customer ${id} not found`);
    const next = applyQuoteCustomerPatch(quoteMockDb.customers[idx], changes);
    quoteMockDb.customers[idx] = next;
    return mockDelay(quoteMockClone.customer(next));
  }

  const listId = requireListId("update a customer");
  const fields = buildQuoteCustomerUpdateFields(changes, previous);
  if (Object.keys(fields).length === 0) return previous;
  await graphFetch(`${listPath(listId)}/${id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const item = await graphFetch<GraphListItem>(
    `${listPath(listId)}/${id}?$expand=fields($select=${QUOTE_CUSTOMER_SELECT})`,
  );
  return toQuoteCustomer(item);
}
