import type { GraphListItem, SpecialPricingEntry, SpecialPricingInput } from "@/types/task";

// =============================================================================
// Graph item → SpecialPricingEntry, and back. Same `Customer` single-lookup
// shape as Customer Contacts — see customerContactMapper.ts.
// =============================================================================

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function toSpecialPricingEntry(item: GraphListItem): SpecialPricingEntry {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    title: text(f.Title).trim(),
    customerId: f.CustomerLookupId ? toInt(f.CustomerLookupId, 0) || null : null,
    pricingNotes: text(f.PricingNotes),
    aiPartNumber: text(f.AIPartNumber).trim(),
  };
}

export function buildSpecialPricingFields(
  input: Partial<SpecialPricingInput>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (input.title !== undefined) fields.Title = input.title.trim();
  if (input.customerId !== undefined) fields.CustomerLookupId = input.customerId;
  if (input.pricingNotes !== undefined) fields.PricingNotes = input.pricingNotes.trim();
  if (input.aiPartNumber !== undefined) fields.AIPartNumber = input.aiPartNumber.trim();
  return fields;
}

export function compareSpecialPricingEntries(
  a: SpecialPricingEntry,
  b: SpecialPricingEntry,
): number {
  return a.title.localeCompare(b.title);
}
