import type { AltronicComponent, AltronicPart, Comment, ComponentCategory, GraphListItem, ItemAuthor } from "@/types/task";
import { parseSpDateOnly } from "./spDates";
import { parseCommunication } from "./communicationParser";
import { partEvent } from "./partLifecycle";

// =============================================================================
// Graph item → AltronicPart / AltronicComponent, plus the part-number rules
// both lists share.
//
// The columns were CREATED by scripts/create-altronic-parts-lists.ps1, so
// their internal names are the readable ones in that script — no field_N, no
// _x0020_. Two things still worth knowing:
//
//  1. `Title` is the Altronic Part #, on both lists. Nothing here is a "title".
//  2. The first three digits of a part number are its "parts list" — the name
//     of the legacy SharePoint list it came from, and how people navigate
//     (the old app's 100–900 Parts Book tiles). That is a rule about the NUMBER,
//     not a column, which is why it lives here rather than being stored.
//
// Date columns go through `parseSpDateOnly`: the loaded rows sit at 12:00Z,
// but a row edited in SharePoint's own UI is stored at local midnight in the
// site's timezone, and the midday pivot reads both as the day people see.
// =============================================================================

/**
 * Which HCO prefixes live in the Component List, and their category. Every
 * other prefix is in the Part List. Mirrored from the load script's
 * `$CategoryByPrefix` — the two must agree, or a part is looked for on the
 * wrong list.
 */
export const COMPONENT_PREFIX_CATEGORY: Readonly<Record<string, ComponentCategory>> = {
  "601": "Through Hole",
  "611": "Through Hole",
  "701": "Surface Mount",
  "711": "Surface Mount",
  "712": "Surface Mount",
  "722": "SIL",
};

function toText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function toChoice(raw: unknown): string | null {
  const s = toText(raw);
  return s ? s : null;
}

/** Graph's item-level createdBy, or null when it came back without a user. */
export function toItemAuthor(item: GraphListItem): ItemAuthor | null {
  const user = item.createdBy?.user;
  if (!user?.displayName && !user?.email) return null;
  return { displayName: user.displayName ?? user.email ?? "", email: (user.email ?? "").toLowerCase() };
}

/**
 * Who raised the part and when. For a REUSED number that is the reuse record's
 * author and time, not the row's: the row was created for the part the number
 * used to be (lib/partLifecycle.ts).
 */
function origin(item: GraphListItem, comments: Comment[]): { createdBy: ItemAuthor | null; createdAt: Date } {
  const reused = partEvent(comments, "reused");
  if (reused) {
    return {
      createdBy: { displayName: reused.authorName, email: reused.authorEmail.toLowerCase() },
      createdAt: reused.timestamp,
    };
  }
  return { createdBy: toItemAuthor(item), createdAt: new Date(item.createdDateTime) };
}

function communication(f: Record<string, unknown>): Comment[] {
  return parseCommunication(typeof f.Communication === "string" ? f.Communication : "");
}

export function toAltronicPart(item: GraphListItem): AltronicPart {
  const f = item.fields as Record<string, unknown>;
  const comments = communication(f);
  return {
    id: parseInt(item.id, 10),
    partNumber: toText(f.Title),
    description: toText(f.Description),
    dateAssigned: parseSpDateOnly(f.DateAssigned),
    drawingSize: toText(f.DrawingSize),
    dateDrawing: parseSpDateOnly(f.DateDrawing),
    manufacturer: toText(f.Manufacturer),
    mfgPartNumber: toText(f.MfgPartNumber),
    notes: toText(f.Notes),
    assignedBy: toText(f.AssignedBy),
    prototypeOrProduction: toChoice(f.PrototypeOrProduction),
    purchased: toChoice(f.Purchased),
    sapNumber: toText(f.SAPNumber),
    itemValue: toText(f.ItemValue),
    signOffStatus: toChoice(f.SignOffStatus),
    legacySource: toText(f.LegacySource),
    comments,
    ...origin(item, comments),
    hasAttachments: f.Attachments === true,
    modifiedAt: new Date(item.lastModifiedDateTime),
  };
}

export function toAltronicComponent(item: GraphListItem): AltronicComponent {
  const f = item.fields as Record<string, unknown>;
  const comments = communication(f);
  return {
    id: parseInt(item.id, 10),
    partNumber: toText(f.Title),
    category: toChoice(f.Category),
    description: toText(f.Description),
    mfgName: toText(f.MfgName),
    mfgNumber: toText(f.MfgNumber),
    ratingA: toText(f.RatingA),
    ratingB: toText(f.RatingB),
    ratingC: toText(f.RatingC),
    tempMin: toText(f.TempMin),
    tempMax: toText(f.TempMax),
    tolerance: toText(f.Tolerance),
    footprint: toText(f.Footprint),
    notes: toText(f.Notes),
    hasDataSheet: f.HasDataSheet === true,
    signOffStatus: toChoice(f.SignOffStatus),
    legacySource: toText(f.LegacySource),
    comments,
    ...origin(item, comments),
    hasAttachments: f.Attachments === true,
    modifiedAt: new Date(item.lastModifiedDateTime),
  };
}

/**
 * The parts list a part number belongs to — its first three digits — or null
 * when it doesn't start with three digits. A suffix is allowed and ignored:
 * `601427HT` is in list 601.
 */
export function partPrefix(partNumber: string): string | null {
  const m = /^(\d{3})/.exec(partNumber.trim());
  return m ? m[1] : null;
}

/** The parts book (1–9) — the first digit — or null. */
export function partBook(partNumber: string): number | null {
  const prefix = partPrefix(partNumber);
  return prefix ? Number(prefix[0]) : null;
}

/** Is this three-digit list one of the HCO component lists? */
export function isComponentPrefix(prefix: string): boolean {
  return Object.prototype.hasOwnProperty.call(COMPONENT_PREFIX_CATEGORY, prefix);
}

/**
 * The HCO lists a search on `prefix` covers: every prefix in the same
 * category, in order — 601/611 (Through Hole), 701/711/712 (Surface Mount),
 * 722 alone (SIL). The old app kept each category as ONE list ("Through Hole
 * Parts", "Surface Mount Parts"), so searching from 711 found a 701 part, and
 * ARC does the same (Tim, 2026-10-02). Empty for a Part List prefix.
 */
export function componentSearchPrefixes(prefix: string): string[] {
  const category = isComponentPrefix(prefix) ? COMPONENT_PREFIX_CATEGORY[prefix] : null;
  if (!category) return [];
  return Object.keys(COMPONENT_PREFIX_CATEGORY)
    .filter((p) => COMPONENT_PREFIX_CATEGORY[p] === category)
    .sort();
}

/**
 * Part numbers in the order people expect: numerically, so `601099` comes
 * before `601100`, with a suffixed number (`601427HT`) right after its base.
 */
export function comparePartNumbers(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** A part's label for headings and toasts — never empty. */
export function altronicPartLabel(part: { partNumber: string; description: string }): string {
  const pn = part.partNumber.trim();
  const desc = part.description.trim();
  if (pn && desc) return `${pn} — ${desc}`;
  return pn || desc || "(no part number)";
}
