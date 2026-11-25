import type { GraphListItem } from "@/types/task";
import type {
  ColdCallAuthor,
  SupplierColdCall,
  SupplierColdCallInput,
} from "@/types/supplierColdCall";
import { matchesSearch } from "./itemSearch";

// =============================================================================
// Supplier Cold Call Log — the column contract with the SharePoint list
// (scripts/create-supplier-cold-call-list.ps1) and the pure rules around it.
//
//   Title          (shown "Company")        text, required
//   Website                                 text
//   Commodity                               text — free text, not a choice
//   ContactName    (shown "Contact Name")   text
//   ContactEmail   (shown "Contact Email")  text
//   ContactPhone   (shown "Contact Phone")  text
//   Notes                                   multi-line plain text
//
// The contact is a person at ANOTHER company, so it is plain text, never a
// person column — nobody there is in this tenant's directory.
// =============================================================================

export const SUPPLIER_COLD_CALL_SELECT =
  "Title,Website,Commodity,ContactName,ContactEmail,ContactPhone,Notes";

function text(raw: unknown): string {
  return typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
}

function author(item: GraphListItem): ColdCallAuthor | null {
  const user = item.createdBy?.user;
  const displayName = user?.displayName?.trim() ?? "";
  const email = user?.email?.trim() ?? "";
  if (!displayName && !email) return null;
  return { displayName: displayName || email, email };
}

export function toSupplierColdCall(item: GraphListItem): SupplierColdCall {
  const f = (item.fields ?? {}) as Record<string, unknown>;
  return {
    id: parseInt(item.id, 10),
    company: text(f.Title).trim(),
    website: text(f.Website).trim(),
    commodity: text(f.Commodity).trim(),
    contactName: text(f.ContactName).trim(),
    contactEmail: text(f.ContactEmail).trim(),
    contactPhone: text(f.ContactPhone).trim(),
    notes: text(f.Notes).trim(),
    createdBy: author(item),
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
  };
}

function inputFields(input: SupplierColdCallInput): Record<string, string> {
  return {
    Title: input.company.trim(),
    Website: input.website.trim(),
    Commodity: input.commodity.trim(),
    ContactName: input.contactName.trim(),
    ContactEmail: input.contactEmail.trim(),
    ContactPhone: input.contactPhone.trim(),
    Notes: input.notes.trim(),
  };
}

/** The row as the form edits it. */
export function supplierColdCallInput(entry: SupplierColdCall): SupplierColdCallInput {
  return {
    company: entry.company,
    website: entry.website,
    commodity: entry.commodity,
    contactName: entry.contactName,
    contactEmail: entry.contactEmail,
    contactPhone: entry.contactPhone,
    notes: entry.notes,
  };
}

/**
 * The fields to write. With `previous` (an edit), ONLY the columns that
 * changed — an unchanged save sends nothing at all.
 */
export function buildSupplierColdCallFields(
  input: SupplierColdCallInput,
  previous?: SupplierColdCall,
): Record<string, string> {
  const next = inputFields(input);
  if (!previous) return next;
  const before = inputFields(supplierColdCallInput(previous));
  const changed: Record<string, string> = {};
  for (const [key, value] of Object.entries(next)) {
    if (before[key] !== value) changed[key] = value;
  }
  return changed;
}

/** The row with an input applied — what a write leaves behind. */
export function applySupplierColdCallInput(
  base: SupplierColdCall,
  input: SupplierColdCallInput,
): SupplierColdCall {
  const f = inputFields(input);
  return {
    ...base,
    company: f.Title,
    website: f.Website,
    commodity: f.Commodity,
    contactName: f.ContactName,
    contactEmail: f.ContactEmail,
    contactPhone: f.ContactPhone,
    notes: f.Notes,
  };
}

/** What's wrong with a draft before it is saved, or null. Company is the only must. */
export function supplierColdCallProblem(input: SupplierColdCallInput): string | null {
  if (!input.company.trim()) return "Company is required.";
  return null;
}

/** Company A–Z, then newest first. */
export function compareSupplierColdCalls(a: SupplierColdCall, b: SupplierColdCall): number {
  const byName = a.company.localeCompare(b.company, undefined, { sensitivity: "base" });
  return byName !== 0 ? byName : b.id - a.id;
}

/**
 * Every word in the search box, found anywhere in the entry — who added it
 * included. Passes the entry itself, so the haystack is cached per row.
 */
export function supplierColdCallMatches(entry: SupplierColdCall, tokens: string[]): boolean {
  return matchesSearch(entry, tokens);
}

/**
 * The address to open for a typed website, or null when it isn't one.
 *
 * People type "acme.com" far more often than "https://acme.com", so a bare
 * domain gets https:// in front. Anything with a scheme other than http(s) —
 * `javascript:`, `mailto:` — is not a website and gets no link; nor does text
 * with a space in it, or with no dot.
 */
export function websiteHref(raw: string): string | null {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * What a website link reads as: the host without "www." plus any path,
 * without the trailing slash ("https://www.avnet.com/americas/" →
 * "avnet.com/americas"). Takes what `websiteHref` returned.
 */
export function websiteLabel(href: string): string {
  try {
    const url = new URL(href);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return url.hostname.replace(/^www\./i, "") + path;
  } catch {
    return href;
  }
}
