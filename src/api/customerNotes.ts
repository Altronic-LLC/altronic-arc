import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_CUSTOMER_NOTES_LIST_ID, SP_SALES_ORDERENTRY_SITE_URL, USE_MOCK } from "./config";
import { ensureLookupIds, ensurePersonLookupId } from "./siteUsers";
import type { CustomerNote, CustomerNoteInput, GraphListItem, Person } from "@/types/task";
import {
  buildCustomerNoteCreateFields,
  compareCustomerNotes,
  customerNoteDetailsPatch,
  toCustomerNote,
} from "@/lib/customerNoteMapper";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { MOCK_CUSTOMER_NOTES } from "@/data/crmMockData";

// =============================================================================
// "Customer Notes" — the anchor list for the CRM tool, on the salesOrderEntry
// site. Customer Contacts, Special Pricing and Capacity all carry a lookup
// back to a row here.
//
// There IS a delete — unlike Visit Reports or Gray Market Requests, this is
// a maintained address book, not a record of something that happened, so a
// customer that's gone (or was added by mistake) can be removed. Anyone
// signed in can add, edit or remove one, matching "Where am I?"'s model —
// no admin gate, no role gating (Ray, 2026-08-26).
//
// `Communication` has no Watchers column behind it: comments here reach only
// whoever is @-mentioned. See `customerNoteCommentRecipients` in
// lib/mentions.ts.
// =============================================================================

let mockStore: CustomerNote[] = MOCK_CUSTOMER_NOTES.map((c) => ({ ...c }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_CUSTOMER_NOTES_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_CUSTOMER_NOTES_LIST_ID is not set.`);
  }
  return SP_CUSTOMER_NOTES_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.salesOrderEntry}/lists/${requireListId("reach the customer")}/items/${id}`;
}

const SELECT =
  "Title,OldCustomerNumber,SAPCustomerNumber,GeneralNotes,ComplianceNotes,Group,CustomerType,CSR,KAM,Communication,Attachments,Created,Modified";

export async function listCustomerNotes(): Promise<CustomerNote[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareCustomerNotes).map((c) => ({ ...c })));
  }
  const listId = requireListId("load customers");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.salesOrderEntry}/lists/${listId}/items?$expand=fields($select=${SELECT})&$top=999`,
  );
  return items.map(toCustomerNote).sort(compareCustomerNotes);
}

export async function getCustomerNote(id: number): Promise<CustomerNote | null> {
  if (USE_MOCK) {
    const found = mockStore.find((c) => c.id === id);
    return delay(found ? { ...found } : null);
  }
  try {
    const item = await graphFetch<GraphListItem>(
      `${itemPath(id)}?$expand=fields($select=${SELECT})`,
    );
    return toCustomerNote(item);
  } catch {
    return null;
  }
}

async function resolvePeople(input: CustomerNoteInput): Promise<{
  csr: Person[];
  kam: Person | null;
}> {
  const [csr, kam] = await Promise.all([
    ensureLookupIds(SP_SALES_ORDERENTRY_SITE_URL, input.csr),
    ensurePersonLookupId(SP_SALES_ORDERENTRY_SITE_URL, input.kam),
  ]);
  return { csr, kam };
}

export async function createCustomerNote(input: CustomerNoteInput): Promise<CustomerNote> {
  const resolved = await resolvePeople(input);

  if (USE_MOCK) {
    const now = new Date();
    const note: CustomerNote = {
      id: Math.max(0, ...mockStore.map((c) => c.id)) + 1,
      customerName: input.customerName.trim(),
      oldCustomerNumber: input.oldCustomerNumber.trim(),
      sapCustomerNumber: input.sapCustomerNumber.trim(),
      generalNotes: "",
      complianceNotes: "",
      group: input.group,
      customerTypes: input.customerTypes,
      csr: resolved.csr,
      kam: resolved.kam,
      comments: [],
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [note, ...mockStore];
    return delay(note);
  }

  const listId = requireListId("create the customer");
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.salesOrderEntry}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields: buildCustomerNoteCreateFields(input, resolved) }) },
  );
  return (await getCustomerNote(parseInt(created.id, 10))) ?? toCustomerNote(created);
}

/** Patch the Details card (name/numbers/group/type) — only the changed keys. */
export async function updateCustomerNoteDetails(
  id: number,
  changed: Parameters<typeof customerNoteDetailsPatch>[0],
): Promise<CustomerNote> {
  return updateCustomerNoteFields(id, customerNoteDetailsPatch(changed));
}

/** Patch CSR/KAM, resolving lookupIds for anyone newly picked. */
export async function updateCustomerNotePeople(
  id: number,
  people: { csr?: Person[]; kam?: Person | null },
): Promise<CustomerNote> {
  const fields: Record<string, unknown> = {};
  if (people.csr !== undefined) {
    const ensured = await ensureLookupIds(SP_SALES_ORDERENTRY_SITE_URL, people.csr);
    Object.assign(fields, multiPersonField("CSR", ensured));
  }
  if (people.kam !== undefined) {
    const ensured = await ensurePersonLookupId(SP_SALES_ORDERENTRY_SITE_URL, people.kam);
    fields.KAMLookupId = ensured?.lookupId ?? null;
  }
  return updateCustomerNoteFields(id, fields);
}

/** Patch General Notes / Compliance Notes — plain text handed over as-is. */
export async function updateCustomerNoteText(
  id: number,
  changed: { generalNotes?: string; complianceNotes?: string },
): Promise<CustomerNote> {
  const fields: Record<string, unknown> = {};
  if (changed.generalNotes !== undefined) fields.GeneralNotes = changed.generalNotes;
  if (changed.complianceNotes !== undefined) fields.ComplianceNotes = changed.complianceNotes;
  return updateCustomerNoteFields(id, fields);
}

async function updateCustomerNoteFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<CustomerNote> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Customer ${id} not found`);
    const next: CustomerNote = { ...mockStore[idx], modifiedAt: new Date() };
    applyMockFields(next, fields);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  const updated = await getCustomerNote(id);
  if (!updated) throw new Error(`Customer ${id} disappeared after update`);
  return updated;
}

function applyMockFields(next: CustomerNote, fields: Record<string, unknown>) {
  if ("Title" in fields) next.customerName = String(fields.Title ?? "");
  if ("OldCustomerNumber" in fields) next.oldCustomerNumber = String(fields.OldCustomerNumber ?? "");
  if ("SAPCustomerNumber" in fields) next.sapCustomerNumber = String(fields.SAPCustomerNumber ?? "");
  if ("Group" in fields) next.group = (fields.Group as CustomerNote["group"]) ?? null;
  if ("CustomerType" in fields) next.customerTypes = (fields.CustomerType as CustomerNote["customerTypes"]) ?? [];
  if ("GeneralNotes" in fields) next.generalNotes = String(fields.GeneralNotes ?? "");
  if ("ComplianceNotes" in fields) next.complianceNotes = String(fields.ComplianceNotes ?? "");
  if ("KAMLookupId" in fields) {
    const lookupId = fields.KAMLookupId;
    next.kam = typeof lookupId === "number" ? { displayName: "", lookupId } : null;
  }
  const csrIds = fields["CSRLookupId"];
  if (Array.isArray(csrIds)) {
    next.csr = csrIds.map((lookupId: number) => ({ displayName: "", lookupId }));
  }
}

export async function deleteCustomerNote(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((c) => c.id !== id);
    return delay(undefined);
  }
  await graphFetch(itemPath(id), { method: "DELETE" });
}

/** Append a comment to the customer's Communication field. */
export async function addCustomerNoteComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<CustomerNote> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Customer ${id} not found`);
    const next: CustomerNote = {
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
  return updateCustomerNoteFields(id, { Communication: appendComment(existingRaw, comment) });
}

/** Edit one existing comment, matched on its timestamp + author. */
export async function editCustomerNoteComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<CustomerNote> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Customer ${id} not found`);
    const next: CustomerNote = {
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
  return updateCustomerNoteFields(id, {
    Communication: replaceComment(existingRaw, target, newBodyHtml),
  });
}
