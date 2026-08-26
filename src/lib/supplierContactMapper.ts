import type {
  GraphListItem,
  Person,
  SupplierContact,
  SupplierContactInput,
  SupplierContactStatus,
} from "@/types/task";
import { SUPPLIER_CONTACT_STATUSES } from "@/types/task";
import { parseCommunication } from "./communicationParser";
import { parseSpDate } from "./spDates";
import { parsePersonField } from "./taskMapper";
import { multiPersonField } from "./graphFields";

// =============================================================================
// Graph item → SupplierContact, and back. `BPReference` is a SINGLE lookup
// into Suppliers List, written as a bare integer.
//
// `Title`, `FirstName` and `LastName` are blank on every row seen live (566
// rows, 2026-08-26) — every contact so far is identified by email alone.
// `supplierContactLabel` falls back through name → email → a numbered
// placeholder, the same shape as `faitLabel`.
// =============================================================================

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toContactStatus(raw: unknown): SupplierContactStatus | null {
  const v = text(raw).trim();
  return (SUPPLIER_CONTACT_STATUSES as readonly string[]).includes(v)
    ? (v as SupplierContactStatus)
    : null;
}

export function toSupplierContact(item: GraphListItem): SupplierContact {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    name: text(f.Title).trim(),
    firstName: text(f.FirstName).trim(),
    lastName: text(f.LastName).trim(),
    supplierId: f.BPReferenceLookupId ? toInt(f.BPReferenceLookupId, 0) || null : null,
    email: text(f.Email).trim(),
    phone: text(f.Phone).trim(),
    status: toContactStatus(f.Status),
    contactNotes: text(f.ContactNotes),
    comments: parseCommunication(text(f.Communication)),
    watchers: parsePersonField(f.Watchers),
    hasAttachments: f.Attachments === true,
    createdAt: parseSpDate(f.Created) ?? new Date(0),
    modifiedAt: parseSpDate(f.Modified) ?? new Date(0),
  };
}

export function buildSupplierContactCreateFields(
  input: SupplierContactInput,
  resolved: { watchers: Person[] },
): Record<string, unknown> {
  return {
    Title: input.name.trim(),
    FirstName: input.firstName.trim(),
    LastName: input.lastName.trim(),
    BPReferenceLookupId: input.supplierId,
    Email: input.email.trim(),
    Phone: input.phone.trim(),
    Status: input.status ?? null,
    ContactNotes: input.contactNotes.trim(),
    ...multiPersonField("Watchers", resolved.watchers),
  };
}

/** Field-level patch, keyed by domain field — used by the inline card editors. */
export function supplierContactFieldPatch(
  changed: Partial<
    Pick<
      SupplierContactInput,
      "name" | "firstName" | "lastName" | "email" | "phone" | "status" | "contactNotes"
    >
  >,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (changed.name !== undefined) fields.Title = changed.name.trim();
  if (changed.firstName !== undefined) fields.FirstName = changed.firstName.trim();
  if (changed.lastName !== undefined) fields.LastName = changed.lastName.trim();
  if (changed.email !== undefined) fields.Email = changed.email.trim();
  if (changed.phone !== undefined) fields.Phone = changed.phone.trim();
  if (changed.status !== undefined) fields.Status = changed.status ?? null;
  if (changed.contactNotes !== undefined) fields.ContactNotes = changed.contactNotes.trim();
  return fields;
}

/** Name → email → a numbered placeholder — the label to show anywhere a contact is named. */
export function supplierContactLabel(contact: SupplierContact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return contact.name || name || contact.email || `Contact #${contact.id}`;
}

export function compareSupplierContacts(a: SupplierContact, b: SupplierContact): number {
  return supplierContactLabel(a).localeCompare(supplierContactLabel(b));
}
