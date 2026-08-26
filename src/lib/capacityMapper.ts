import type { CapacityEntry, CapacityInput, GraphListItem } from "@/types/task";

// =============================================================================
// Graph item → CapacityEntry, and back. Same `Customer` single-lookup shape as
// Customer Contacts. `Customer: Old Customer Number` / `Customer: SAP Customer
// Number` are read-only PROJECTED columns off the same lookup and aren't
// written — see customerId's resolved customer for those instead.
// =============================================================================

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

export function toCapacityEntry(item: GraphListItem): CapacityEntry {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    partNumber: text(f.Title).trim(),
    customerId: f.CustomerLookupId ? toInt(f.CustomerLookupId, 0) || null : null,
    description: text(f.Description).trim(),
    weeklyMax: toNumberOrNull(f.WeeklyMax),
    notes: text(f.Notes),
    customerPartNumber: text(f.CustomerP_x002f_N).trim(),
  };
}

export function buildCapacityFields(input: Partial<CapacityInput>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (input.partNumber !== undefined) fields.Title = input.partNumber.trim();
  if (input.customerId !== undefined) fields.CustomerLookupId = input.customerId;
  if (input.description !== undefined) fields.Description = input.description.trim();
  if (input.weeklyMax !== undefined) fields.WeeklyMax = input.weeklyMax;
  if (input.notes !== undefined) fields.Notes = input.notes.trim();
  if (input.customerPartNumber !== undefined)
    fields.CustomerP_x002f_N = input.customerPartNumber.trim();
  return fields;
}

export function compareCapacityEntries(a: CapacityEntry, b: CapacityEntry): number {
  return a.partNumber.localeCompare(b.partNumber);
}
