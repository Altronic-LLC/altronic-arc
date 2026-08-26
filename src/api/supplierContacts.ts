import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PMO_SITE_URL, SP_SUPPLIER_CONTACTS_LIST_ID, USE_MOCK } from "./config";
import { ensureLookupIds } from "./siteUsers";
import type { GraphListItem, Person, SupplierContact, SupplierContactInput } from "@/types/task";
import {
  buildSupplierContactCreateFields,
  compareSupplierContacts,
  supplierContactFieldPatch,
  toSupplierContact,
} from "@/lib/supplierContactMapper";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { MOCK_SUPPLIER_CONTACTS } from "@/data/srmMockData";

// =============================================================================
// "Supplier Contact List" — one row per person at a supplier, on the PMO
// site. 566 rows at discovery; fetched whole and scoped to one supplier
// client-side (the detail page's own Contacts section), same as Customer
// Contacts.
//
// Communication and Watchers were added to this list for ARC on 2026-08-26
// (scripts/add-supplier-contact-columns.ps1) — Suppliers List and Supplier
// Issue Tracker already had both.
//
// There IS a delete — a contact who left the company is removed, the same
// as removing a name from an address book, unlike the issue tracker below.
// =============================================================================

let mockStore: SupplierContact[] = MOCK_SUPPLIER_CONTACTS.map((c) => ({ ...c }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_SUPPLIER_CONTACTS_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_SUPPLIER_CONTACTS_LIST_ID is not set.`);
  }
  return SP_SUPPLIER_CONTACTS_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.pmo}/lists/${requireListId("reach the contact")}/items/${id}`;
}

const SELECT =
  "Title,BPReference,FirstName,LastName,Email,Phone,Status,ContactNotes,Communication,Watchers,Attachments,Created,Modified";

export async function listSupplierContacts(): Promise<SupplierContact[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareSupplierContacts).map((c) => ({ ...c })));
  }
  const listId = requireListId("load supplier contacts");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${listId}/items?$expand=fields($select=${SELECT})&$top=999`,
  );
  return items.map(toSupplierContact).sort(compareSupplierContacts);
}

export async function createSupplierContact(
  input: SupplierContactInput,
): Promise<SupplierContact> {
  const watchers = await ensureLookupIds(SP_PMO_SITE_URL, input.watchers);

  if (USE_MOCK) {
    const now = new Date();
    const contact: SupplierContact = {
      id: Math.max(0, ...mockStore.map((c) => c.id)) + 1,
      name: input.name.trim(),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      supplierId: input.supplierId,
      email: input.email.trim(),
      phone: input.phone.trim(),
      status: input.status,
      contactNotes: input.contactNotes.trim(),
      comments: [],
      watchers,
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [contact, ...mockStore];
    return delay(contact);
  }
  const listId = requireListId("create the contact");
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields: buildSupplierContactCreateFields(input, { watchers }) }) },
  );
  const item = await graphFetch<GraphListItem>(`${itemPath(parseInt(created.id, 10))}?$expand=fields($select=${SELECT})`);
  return toSupplierContact(item);
}

export async function updateSupplierContactFields(
  id: number,
  changed: Parameters<typeof supplierContactFieldPatch>[0],
): Promise<SupplierContact> {
  return updateFields(id, supplierContactFieldPatch(changed));
}

export async function setSupplierContactWatchers(
  id: number,
  people: Person[],
): Promise<SupplierContact> {
  if (USE_MOCK) {
    return updateFields(id, { Watchers: people });
  }
  const ensured = await ensureLookupIds(SP_PMO_SITE_URL, people);
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.",
    );
  }
  return updateFields(id, multiPersonField("Watchers", ensured));
}

async function updateFields(id: number, fields: Record<string, unknown>): Promise<SupplierContact> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Contact ${id} not found`);
    const next: SupplierContact = { ...mockStore[idx], modifiedAt: new Date() };
    applyMockFields(next, fields);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }
  await graphFetch(`${itemPath(id)}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const item = await graphFetch<GraphListItem>(`${itemPath(id)}?$expand=fields($select=${SELECT})`);
  return toSupplierContact(item);
}

function applyMockFields(next: SupplierContact, fields: Record<string, unknown>) {
  if ("Title" in fields) next.name = String(fields.Title ?? "");
  if ("FirstName" in fields) next.firstName = String(fields.FirstName ?? "");
  if ("LastName" in fields) next.lastName = String(fields.LastName ?? "");
  if ("Email" in fields) next.email = String(fields.Email ?? "");
  if ("Phone" in fields) next.phone = String(fields.Phone ?? "");
  if ("Status" in fields) next.status = (fields.Status as SupplierContact["status"]) ?? null;
  if ("ContactNotes" in fields) next.contactNotes = String(fields.ContactNotes ?? "");
  if (Array.isArray(fields.Watchers)) {
    next.watchers = fields.Watchers as Person[];
  } else {
    const watcherIds = fields["WatchersLookupId"];
    if (Array.isArray(watcherIds)) {
      next.watchers = watcherIds.map((lookupId: number) => ({ displayName: "", lookupId }));
    }
  }
}

export async function deleteSupplierContact(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((c) => c.id !== id);
    return delay(undefined);
  }
  await graphFetch(itemPath(id), { method: "DELETE" });
}

export async function addSupplierContactComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<SupplierContact> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Contact ${id} not found`);
    const next: SupplierContact = {
      ...mockStore[idx],
      comments: [
        { timestamp: new Date(), authorName: comment.authorName, authorEmail: comment.authorEmail, bodyHtml: comment.bodyHtml, attachments: [] },
        ...mockStore[idx].comments,
      ],
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }
  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateFields(id, { Communication: appendComment(existingRaw, comment) });
}

export async function editSupplierContactComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<SupplierContact> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Contact ${id} not found`);
    const next: SupplierContact = {
      ...mockStore[idx],
      comments: mockStore[idx].comments.map((c) =>
        c.timestamp.getTime() === target.timestamp.getTime() &&
        (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
          ? { ...c, bodyHtml: newBodyHtml }
          : c,
      ),
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }
  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateFields(id, { Communication: replaceComment(existingRaw, target, newBodyHtml) });
}
