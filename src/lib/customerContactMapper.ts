import type { CustomerContact, CustomerContactInput, GraphListItem } from "@/types/task";

// =============================================================================
// Graph item → CustomerContact, and back. `Customer` is a SINGLE lookup into
// Customer Notes, written as a bare integer (Customer Notes/EIRs/ECNs' project
// lookup pattern, not multiLookupField's Collection(Edm.Int32) shape).
// =============================================================================

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function toCustomerContact(item: GraphListItem): CustomerContact {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    name: text(f.Title).trim(),
    customerId: f.CustomerLookupId ? toInt(f.CustomerLookupId, 0) || null : null,
    email: text(f.Email).trim(),
    phoneNumber: text(f.PhoneNumber).trim(),
    jobTitle: text(f.JobTitle).trim(),
    contactNotes: text(f.ContactNotes),
  };
}

export function buildCustomerContactFields(
  input: Partial<CustomerContactInput>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (input.name !== undefined) fields.Title = input.name.trim();
  if (input.customerId !== undefined) fields.CustomerLookupId = input.customerId;
  if (input.email !== undefined) fields.Email = input.email.trim();
  if (input.phoneNumber !== undefined) fields.PhoneNumber = input.phoneNumber.trim();
  if (input.jobTitle !== undefined) fields.JobTitle = input.jobTitle.trim();
  if (input.contactNotes !== undefined) fields.ContactNotes = input.contactNotes.trim();
  return fields;
}

export function compareCustomerContacts(a: CustomerContact, b: CustomerContact): number {
  return a.name.localeCompare(b.name);
}
