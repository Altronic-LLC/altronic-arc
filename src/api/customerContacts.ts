import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_CUSTOMER_CONTACTS_LIST_ID, USE_MOCK } from "./config";
import type { CustomerContact, CustomerContactInput, GraphListItem } from "@/types/task";
import {
  buildCustomerContactFields,
  compareCustomerContacts,
  toCustomerContact,
} from "@/lib/customerContactMapper";
import { MOCK_CUSTOMER_CONTACTS } from "@/data/crmMockData";

// =============================================================================
// "Customer Contacts" — one row per person at a customer, on the
// salesOrderEntry site. ~110 rows: fetched whole, like the customer list, and
// scoped to one customer client-side (the detail page's own contacts section).
// Anyone signed in can add, edit or remove one — same as Customer Notes.
// =============================================================================

let mockStore: CustomerContact[] = MOCK_CUSTOMER_CONTACTS.map((c) => ({ ...c }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_CUSTOMER_CONTACTS_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_CUSTOMER_CONTACTS_LIST_ID is not set.`);
  }
  return SP_CUSTOMER_CONTACTS_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.salesOrderEntry}/lists/${requireListId("reach the contact")}/items/${id}`;
}

const SELECT = "Title,CustomerLookupId,Email,PhoneNumber,JobTitle,ContactNotes";

export async function listCustomerContacts(): Promise<CustomerContact[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareCustomerContacts).map((c) => ({ ...c })));
  }
  const listId = requireListId("load contacts");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.salesOrderEntry}/lists/${listId}/items?$expand=fields($select=${SELECT})&$top=999`,
  );
  return items.map(toCustomerContact).sort(compareCustomerContacts);
}

export async function createCustomerContact(
  input: CustomerContactInput,
): Promise<CustomerContact> {
  if (USE_MOCK) {
    const contact: CustomerContact = {
      id: Math.max(0, ...mockStore.map((c) => c.id)) + 1,
      name: input.name.trim(),
      customerId: input.customerId,
      email: input.email.trim(),
      phoneNumber: input.phoneNumber.trim(),
      jobTitle: input.jobTitle.trim(),
      contactNotes: input.contactNotes.trim(),
    };
    mockStore = [contact, ...mockStore];
    return delay(contact);
  }
  const listId = requireListId("create the contact");
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.salesOrderEntry}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields: buildCustomerContactFields(input) }) },
  );
  return toCustomerContact(created);
}

export async function updateCustomerContact(
  id: number,
  changed: Partial<CustomerContactInput>,
): Promise<CustomerContact> {
  const fields = buildCustomerContactFields(changed);
  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Contact ${id} not found`);
    const next: CustomerContact = { ...mockStore[idx], ...changed };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }
  await graphFetch(`${itemPath(id)}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const item = await graphFetch<GraphListItem>(`${itemPath(id)}?$expand=fields($select=${SELECT})`);
  return toCustomerContact(item);
}

export async function deleteCustomerContact(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((c) => c.id !== id);
    return delay(undefined);
  }
  await graphFetch(itemPath(id), { method: "DELETE" });
}
