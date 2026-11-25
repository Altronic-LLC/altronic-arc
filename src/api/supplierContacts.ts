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
import { mockDelay } from "./mockLatency";
import { readColumnChoices } from "./columnChoices";
import { GraphError } from "./graph";
import { SUPPLIER_CONTACT_CATEGORIES } from "@/types/task";

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
  // BOTH halves of BPReference. It is a SINGLE lookup, and Graph returns only
// the bare `BPReferenceLookupId` for one of those — asking for the friendly
// name alone (which is what this did until 2026-09-09) means the id never
// comes back, every contact maps to `supplierId: null`, and the supplier
// detail page's `contacts.filter(c => c.supplierId === supplier.id)` matches
// NOTHING. That is the "contacts aren't showing up" report: the rows and
// their lookups were fine all along (live samples carry 353, 496, 476...),
// the read just never asked for the column it maps.
"Title,BPReference,BPReferenceLookupId,FirstName,LastName,Email,Phone,Status,ContactNotes,Communication,Watchers,Attachments,Created,Modified";

/**
 * `ContactCategory` (BusinessIT#80) came after the list and is added by
 * scripts/add-supplier-contact-columns.ps1, which runs separately from any
 * deploy. Selecting a column a list hasn't got 400s the WHOLE read, so a read
 * asks for it and, on a 400 only, retries without and remembers (the MRB
 * Watchers arrangement). A write naming it is then refused, naming the script.
 */
let categoryColumnAvailable: boolean | null = null;

export function supplierContactCategoryAvailable(): boolean {
  return categoryColumnAvailable !== false;
}

/** Tests only. */
export function __resetSupplierContactCategoryColumn(): void {
  categoryColumnAvailable = null;
}

const CATEGORY_MISSING =
  "The Supplier Contact List has no Contact Category column yet - run scripts/add-supplier-contact-columns.ps1.";

function refuseCategoryWhileMissing(fields: Record<string, unknown>): void {
  if (categoryColumnAvailable === false && "ContactCategory" in fields) throw new Error(CATEGORY_MISSING);
}

/** Runs a read with ContactCategory in the $select, falling back without it on a 400. */
async function readWithCategory<T>(read: (select: string) => Promise<T>): Promise<T> {
  if (categoryColumnAvailable === false) return read(SELECT);
  try {
    const out = await read(`${SELECT},ContactCategory`);
    categoryColumnAvailable = true;
    return out;
  } catch (err) {
    if (categoryColumnAvailable === null && err instanceof GraphError && err.status === 400) {
      const out = await read(SELECT);
      categoryColumnAvailable = false;
      return out;
    }
    throw err;
  }
}

/**
 * The Contact Category column's LIVE choices — a category added in SharePoint
 * is offered with no deploy. SUPPLIER_CONTACT_CATEGORIES is the fallback.
 */
export async function listSupplierContactCategoryChoices(): Promise<string[]> {
  if (USE_MOCK) return mockDelay([...SUPPLIER_CONTACT_CATEGORIES]);
  return readColumnChoices(SITES.pmo, SP_SUPPLIER_CONTACTS_LIST_ID, "ContactCategory", SUPPLIER_CONTACT_CATEGORIES);
}

export async function listSupplierContacts(): Promise<SupplierContact[]> {
  if (USE_MOCK) {
    return mockDelay([...mockStore].sort(compareSupplierContacts).map((c) => ({ ...c })));
  }
  const listId = requireListId("load supplier contacts");
  const items = await readWithCategory((select) =>
    graphFetchAll<GraphListItem>(
      `/sites/${SITES.pmo}/lists/${listId}/items?$expand=fields($select=${select})&$top=999`,
    ),
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
      category: input.category || null,
      contactNotes: input.contactNotes.trim(),
      comments: [],
      watchers,
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [contact, ...mockStore];
    return mockDelay(contact);
  }
  const listId = requireListId("create the contact");
  const fields = buildSupplierContactCreateFields(input, { watchers });
  refuseCategoryWhileMissing(fields);
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields }) },
  );
  const item = await readWithCategory((select) =>
    graphFetch<GraphListItem>(`${itemPath(parseInt(created.id, 10))}?$expand=fields($select=${select})`),
  );
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
    return mockDelay({ ...next });
  }
  refuseCategoryWhileMissing(fields);
  await graphFetch(`${itemPath(id)}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const item = await readWithCategory((select) =>
    graphFetch<GraphListItem>(`${itemPath(id)}?$expand=fields($select=${select})`),
  );
  return toSupplierContact(item);
}

function applyMockFields(next: SupplierContact, fields: Record<string, unknown>) {
  if ("Title" in fields) next.name = String(fields.Title ?? "");
  if ("FirstName" in fields) next.firstName = String(fields.FirstName ?? "");
  if ("LastName" in fields) next.lastName = String(fields.LastName ?? "");
  if ("Email" in fields) next.email = String(fields.Email ?? "");
  if ("Phone" in fields) next.phone = String(fields.Phone ?? "");
  if ("Status" in fields) next.status = (fields.Status as SupplierContact["status"]) ?? null;
  if ("ContactCategory" in fields) next.category = (fields.ContactCategory as string | null) || null;
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
    return mockDelay(undefined);
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
    return mockDelay({ ...next });
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
    return mockDelay({ ...next });
  }
  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateFields(id, { Communication: replaceComment(existingRaw, target, newBodyHtml) });
}
