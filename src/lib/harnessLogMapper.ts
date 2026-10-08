import { parseSpDateOnly } from "./spDates";
import { toLookupId, toNumberOrNull } from "./teradyneMapper";
import type {
  GraphListItem,
  HarnessLogEntry,
  HarnessLogInput,
  HarnessPartNumber,
  HarnessPartNumberInput,
  TeradyneRef,
} from "@/types/task";

// =============================================================================
// Graph item ⇄ Harness Production Log / Harness Part Numbers.
//
// Column names are the ones scripts/create-harness-production-lists.ps1
// creates — readable, no `_x00xx_` escapes, because ARC made the lists.
// =============================================================================

/** The Access database went live in 2018; no harness entry is older. */
export const HARNESS_FIRST_YEAR = 2018;

function toText(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/**
 * The log's `Title`: "593027-15 / WO 1000209528".
 *
 * App-owned, like the Teradyne Log's — a real writable column nobody types,
 * recomputed on every write so it can't drift from the two fields it's built
 * from. The load script builds the identical string (Get-EntryTitle in
 * scripts/load-harness-production-log.ps1); change both together.
 */
export function buildHarnessLogTitle(
  partNumber: string | null | undefined,
  workOrder: string | null | undefined,
): string {
  const part = (partNumber ?? "").trim();
  const wo = (workOrder ?? "").trim();
  if (part && wo) return `${part} / WO ${wo}`;
  if (part) return part;
  if (wo) return `WO ${wo}`;
  return "(untitled entry)";
}

/**
 * Graph item → part number.
 *
 * **A missing `Active` reads as ACTIVE** — the Maintenance reference lists'
 * rule, for the same reason: a row created outside ARC must not vanish from
 * every picker.
 */
export function toHarnessPartNumber(item: GraphListItem): HarnessPartNumber {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  const active = f.Active;
  return {
    lookupId: parseInt(item.id, 10),
    title: toText(f.Title).trim(),
    description: toText(f.Description),
    active:
      active === undefined || active === null
        ? true
        : typeof active === "boolean"
          ? active
          : /^(true|yes|1)$/i.test(String(active).trim()),
    note: toText(f.Note),
  };
}

/** Part number input → fields. `Active` is always sent; a null reads as blank in SharePoint. */
export function buildHarnessPartFields(input: HarnessPartNumberInput): Record<string, unknown> {
  return {
    Title: input.title.trim().toUpperCase(),
    Description: (input.description ?? "").trim(),
    Active: input.active ?? true,
    Note: input.note ?? "",
  };
}

/** Part numbers by title: A–Z, numbers in numeric order (593027-9 before 593027-12). */
export function compareHarnessParts(a: HarnessPartNumber, b: HarnessPartNumber): number {
  return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Resolve the bare `PartNumberLookupId`. A lookup whose part row has gone
 * still resolves — labelled by id — so a dangling pointer is visible instead
 * of reading as "no part recorded".
 */
function resolvePart(rawId: unknown, titles: Map<number, string>): TeradyneRef | null {
  const lookupId = toLookupId(rawId);
  if (lookupId === null) return null;
  return { lookupId, title: titles.get(lookupId) ?? `(missing #${lookupId})` };
}

export function toHarnessLogEntry(item: GraphListItem, partTitles: Map<number, string>): HarnessLogEntry {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  const part = resolvePart(f.PartNumberLookupId, partTitles);
  const workOrder = toText(f.WorkOrder);
  return {
    id: parseInt(item.id, 10),
    title: toText(f.Title) || buildHarnessLogTitle(part?.title, workOrder),
    // parseSpDateOnly, not parseSpDate: ARC and the import write midday UTC,
    // but a row edited in SharePoint's own form is stored at local midnight.
    productionDate: parseSpDateOnly(f.ProductionDate),
    workOrder,
    part,
    quantity: toNumberOrNull(f.Quantity),
    reworkQuantity: toNumberOrNull(f.ReworkQuantity),
    comments: toText(f.Comments),
    builtBy: toText(f.BuiltBy),
    visualCheck: toText(f.VisualCheck),
    dataQualityNotes: toText(f.DataQualityNotes),
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
  };
}

/**
 * Newest first, by Production Date then id. Undated rows sort last — they're
 * incomplete, not current. The Teradyne rule.
 */
export function compareHarnessLogEntries(a: HarnessLogEntry, b: HarnessLogEntry): number {
  const at = a.productionDate?.getTime() ?? null;
  const bt = b.productionDate?.getTime() ?? null;
  if (at === null && bt === null) return b.id - a.id;
  if (at === null) return 1;
  if (bt === null) return -1;
  if (at !== bt) return bt - at;
  return b.id - a.id;
}

/** Distinct values, most-used first — the Built By / Visual Check suggestions. */
export function byFrequency(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const t = v.trim();
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
}

/** Codes are upper-cased on the way in, the way the import left them. */
export function cleanHarnessCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * The input's text fields, trimmed. `DataQualityNotes` and `LegacySource` are
 * NEVER part of a write — they belong to the import, and an edit must not
 * erase the record of what the import changed.
 */
export function normaliseHarnessInput(input: HarnessLogInput): HarnessLogInput {
  return {
    ...input,
    workOrder: input.workOrder.trim(),
    comments: input.comments.trim(),
    builtBy: cleanHarnessCode(input.builtBy),
    visualCheck: cleanHarnessCode(input.visualCheck),
  };
}
