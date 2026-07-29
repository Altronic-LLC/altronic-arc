import type { CsaListing, GraphListItem } from "@/types/task";
import { parseSpDate } from "./spDates";

// =============================================================================
// Graph item → CsaListing.
//
// Column names come from live discovery against the Engineering site
// (2026-07-29). They're clean names — Product, AlsoCover, PartNoIncluded,
// History, DateCertified — with two things to remember:
//
//  1. `Title` is the FILE NUMBER, not a title. The list repurposes the built-in
//     column, so the domain object has `fileNumber` and no `title` at all.
//  2. `CSA_ID` is a legacy id from the original data. Read-only here: the app
//     never writes it, and new rows simply won't have one.
// =============================================================================

function toText(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function toCsaListing(item: GraphListItem): CsaListing {
  const f = item.fields as Record<string, unknown>;
  return {
    id: parseInt(item.id, 10),
    fileNumber: toText(f.Title),
    product: toText(f.Product),
    alsoCover: toText(f.AlsoCover),
    partNoIncluded: toText(f.PartNoIncluded),
    history: toText(f.History),
    dateCertified: parseSpDate(f.DateCertified),
    csaId: toNumberOrNull(f.CSA_ID),
    // Graph returns the Attachments column as a boolean on the fields payload.
    hasAttachments: f.Attachments === true,
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
  };
}

/**
 * A short label for a listing, for toasts and confirm dialogs.
 *
 * File number alone is the identifier people use, but it's meaningless out of
 * context, so pair it with the product when there is one.
 */
export function csaListingLabel(listing: Pick<CsaListing, "fileNumber" | "product">): string {
  const file = listing.fileNumber.trim();
  const product = listing.product.trim();
  if (file && product) return `${file} — ${product}`;
  return file || product || "(untitled listing)";
}

/**
 * Sort: newest certification first, undated last.
 *
 * Undated rows sort to the bottom rather than the top — an unrecorded date is a
 * gap to fill, and letting them head the list would bury current work.
 */
export function compareCsaListings(a: CsaListing, b: CsaListing): number {
  const at = a.dateCertified?.getTime() ?? null;
  const bt = b.dateCertified?.getTime() ?? null;
  if (at === null && bt === null) return b.id - a.id;
  if (at === null) return 1;
  if (bt === null) return -1;
  if (at !== bt) return bt - at;
  return b.id - a.id;
}

/**
 * Does this listing match every search token?
 *
 * Searches the long fields too — a part number someone is chasing is far more
 * likely to be buried in "Part No Included" than in the file number.
 */
export function csaListingMatches(listing: CsaListing, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = [
    listing.fileNumber,
    listing.product,
    listing.alsoCover,
    listing.partNoIncluded,
    listing.history,
    listing.csaId === null ? "" : String(listing.csaId),
  ]
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}
