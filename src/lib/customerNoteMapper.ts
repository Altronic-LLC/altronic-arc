import type {
  CustomerGroup,
  CustomerNote,
  CustomerNoteInput,
  CustomerType,
  GraphListItem,
  Person,
} from "@/types/task";
import { CUSTOMER_GROUPS, CUSTOMER_TYPES } from "@/types/task";
import { parseCommunication } from "./communicationParser";
import { parseSpDate } from "./spDates";
import { parsePersonField, parseSinglePersonField } from "./taskMapper";
import { multiPersonField } from "./graphFields";

// =============================================================================
// Graph item → CustomerNote, and back.
//
// `Group` is a SINGLE choice (a bare string); `CustomerType` is MULTI (a bare
// string array) — Graph returns both without any lookup envelope, unlike
// person/lookup columns. `GeneralNotes` / `ComplianceNotes` hold rich HTML in
// practice (confirmed against live sample rows, 2026-08-26) even though the
// column metadata reports `textType: "plain"` — the same gap CLAUDE.md notes
// for FAIT's Communication append-behaviour: unverifiable from the schema,
// true from the data. They round-trip as opaque HTML here (no
// toStoredRichText conversion), since the composer for these two fields is
// the plain textarea in FieldEditModal, not RichTextEditor.
// =============================================================================

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toCustomerGroup(raw: unknown): CustomerGroup | null {
  const v = text(raw).trim();
  return (CUSTOMER_GROUPS as readonly string[]).includes(v) ? (v as CustomerGroup) : null;
}

function toCustomerTypes(raw: unknown): CustomerType[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is CustomerType =>
    (CUSTOMER_TYPES as readonly string[]).includes(String(v)),
  );
}

export function toCustomerNote(item: GraphListItem): CustomerNote {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    customerName: text(f.Title).trim(),
    oldCustomerNumber: text(f.OldCustomerNumber).trim(),
    sapCustomerNumber: text(f.SAPCustomerNumber).trim(),
    generalNotes: text(f.GeneralNotes),
    complianceNotes: text(f.ComplianceNotes),
    group: toCustomerGroup(f.Group),
    customerTypes: toCustomerTypes(f.CustomerType),
    csr: parsePersonField(f.CSR),
    kam: parseSinglePersonField(f.KAM),
    comments: parseCommunication(text(f.Communication)),
    hasAttachments: f.Attachments === true,
    createdAt: parseSpDate(f.Created) ?? new Date(0),
    modifiedAt: parseSpDate(f.Modified) ?? new Date(0),
  };
}

/** Create payload. CSR/KAM are handed in already resolved to lookupIds. */
export function buildCustomerNoteCreateFields(
  input: CustomerNoteInput,
  resolved: { csr: Person[]; kam: Person | null },
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.customerName.trim(),
    OldCustomerNumber: input.oldCustomerNumber.trim(),
    SAPCustomerNumber: input.sapCustomerNumber.trim(),
    ...multiPersonField("CSR", resolved.csr),
    KAMLookupId: resolved.kam?.lookupId ?? null,
  };
  if (input.group) fields.Group = input.group;
  if (input.customerTypes.length > 0) fields.CustomerType = input.customerTypes;
  return fields;
}

/** Patch for the "Details" card (name/numbers/group/type) — only what changed. */
export function customerNoteDetailsPatch(
  changed: Partial<
    Pick<
      CustomerNoteInput,
      "customerName" | "oldCustomerNumber" | "sapCustomerNumber" | "group" | "customerTypes"
    >
  >,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (changed.customerName !== undefined) fields.Title = changed.customerName.trim();
  if (changed.oldCustomerNumber !== undefined)
    fields.OldCustomerNumber = changed.oldCustomerNumber.trim();
  if (changed.sapCustomerNumber !== undefined)
    fields.SAPCustomerNumber = changed.sapCustomerNumber.trim();
  if (changed.group !== undefined) fields.Group = changed.group ?? null;
  if (changed.customerTypes !== undefined) fields.CustomerType = changed.customerTypes;
  return fields;
}

/** What to call a customer in a toast, an email subject or a page title. */
export function customerNoteLabel(note: CustomerNote): string {
  return note.customerName || `Customer #${note.id}`;
}

/** Alphabetical by name — this is a name/address book, not a work queue. */
export function compareCustomerNotes(a: CustomerNote, b: CustomerNote): number {
  return a.customerName.localeCompare(b.customerName);
}
