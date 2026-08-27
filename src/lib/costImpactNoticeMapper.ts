import type {
  CostImpactNotice,
  CostImpactNoticeInput,
  CostImpactTime,
  GraphListItem,
  Person,
} from "@/types/task";
import { COST_IMPACT_TIMES } from "@/types/task";
import { parseCommunication } from "./communicationParser";
import { parseSpDate } from "./spDates";
import { toStoredRichText } from "./richText";

// =============================================================================
// Graph item → CostImpactNotice, and back.
//
// `WhereUsed` holds SharePoint rich text (the same `<div class="ExternalClass
// …">` shape as EIR's and Gray Market's field of the same name), so it's
// written through `toStoredRichText` and rendered sanitised.
//
// `OriginalCost` / `NewCost` are TEXT columns, not Currency — kept as strings
// on the way in and out rather than parsed to a number and reformatted,
// which would risk disagreeing with whatever SharePoint actually stored.
// `Delta_x0020_Cost` IS a calculated column, so it's read-only and parsed to
// a number here since SharePoint already did the subtraction.
// =============================================================================

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toTimeOfImpact(raw: unknown): CostImpactTime | null {
  const v = text(raw).trim();
  return (COST_IMPACT_TIMES as readonly string[]).includes(v) ? (v as CostImpactTime) : null;
}

function toYesNo(raw: unknown): "Yes" | "No" | null {
  const v = text(raw).trim();
  return v === "Yes" || v === "No" ? v : null;
}

function toDelta(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

/** Graph's item-level `createdBy` — the list has no requester column of its own, same as ECNs. */
function parseCreatedBy(item: GraphListItem): Person | null {
  const user = item.createdBy?.user;
  if (!user) return null;
  const displayName = user.displayName?.trim() ?? "";
  const email = user.email?.trim();
  if (!displayName && !email) return null;
  return { displayName: displayName || email || "", email };
}

export function toCostImpactNotice(item: GraphListItem): CostImpactNotice {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    title: text(f.Title).trim(),
    supplier: text(f.Supplier).trim(),
    sapNumber: text(f.SAPNumber).trim(),
    oldPartNumber: text(f.OldPartNumber).trim(),
    mpn: text(f.MPN).trim(),
    originalCost: text(f.OriginalCost).trim(),
    newCost: text(f.NewCost).trim(),
    deltaCost: toDelta(f.Delta_x0020_Cost),
    timeOfImpact: toTimeOfImpact(f.TimeofImpact),
    usedOnPanels: toYesNo(f.Panels),
    whereUsed: text(f.WhereUsed),
    eau: text(f.EAU).trim(),
    bpReference: text(f.BPReference).trim(),
    notes: text(f.Comments),
    yearIssued: text(f.Year_x0020_Issued).trim(),
    submittedBy: parseCreatedBy(item),
    comments: parseCommunication(text(f.Communication)),
    hasAttachments: f.Attachments === true,
    createdAt: parseSpDate(f.Created) ?? new Date(0),
    modifiedAt: parseSpDate(f.Modified) ?? new Date(0),
  };
}

/**
 * Create payload. Blank optional text is omitted rather than sent as ""
 * (SharePoint would rather not hear about a column than be handed an empty
 * string for it, same rule as ECN/Gray Market creates) — the four required
 * columns (Title, Original Cost, New Cost, Time of Impact, Where Used) are
 * always sent since a create is refused without them anyway.
 */
export function buildCostImpactNoticeCreateFields(
  input: CostImpactNoticeInput,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.title.trim(),
    OriginalCost: input.originalCost.trim(),
    NewCost: input.newCost.trim(),
    TimeofImpact: input.timeOfImpact,
    WhereUsed: toStoredRichText(input.whereUsed),
  };
  if (input.supplier.trim()) fields.Supplier = input.supplier.trim();
  if (input.sapNumber.trim()) fields.SAPNumber = input.sapNumber.trim();
  if (input.oldPartNumber.trim()) fields.OldPartNumber = input.oldPartNumber.trim();
  if (input.mpn.trim()) fields.MPN = input.mpn.trim();
  if (input.usedOnPanels) fields.Panels = input.usedOnPanels;
  if (input.eau.trim()) fields.EAU = input.eau.trim();
  if (input.bpReference.trim()) fields.BPReference = input.bpReference.trim();
  if (input.notes.trim()) fields.Comments = input.notes.trim();
  return fields;
}

/** What to call a notice in a toast, an email subject or a page title. */
export function costImpactNoticeLabel(notice: CostImpactNotice): string {
  if (notice.title && notice.sapNumber) return `${notice.title} (${notice.sapNumber})`;
  return notice.title || notice.sapNumber || `Cost Impact Notice #${notice.id}`;
}

/** Newest first. */
export function compareCostImpactNotices(a: CostImpactNotice, b: CostImpactNotice): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id;
}
