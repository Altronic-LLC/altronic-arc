import type {
  GrayMarketRequest,
  GrayMarketRequestInput,
  GraphListItem,
  Person,
} from "@/types/task";
import { GRAY_MARKET_FIELDS } from "./grayMarketFields";
import { parseCommunication } from "./communicationParser";
import { parseSpDate, parseSpDateOnly, toSpDateOnly } from "./spDates";
import { toStoredRichText } from "./richText";

// =============================================================================
// Graph item → GrayMarketRequest, and back.
//
// Both directions are driven by the descriptor table in grayMarketFields.ts, so
// a column added there is read, written, selected and rendered without touching
// this file.
//
// Two things worth knowing about the stored data:
//
//  - **Dates come back at 23:00Z** — local midnight in the site's regional
//    timezone, exactly like Visit Reports' 22:00Z rows (same tenant, one hour
//    apart because those samples were summer and these winter). `parseSpDateOnly`
//    snaps them to the day the SharePoint list view shows.
//  - **`WhereUsed` holds HTML** (`<div class="ExternalClass…">` — SharePoint's
//    rich-text wrapper). It's rendered sanitised and written through the same
//    plain-text→paragraphs conversion the EIR long fields use.
// =============================================================================

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A single person-or-group value → Person. Graph hands these back as an
 * object with LookupId / LookupValue / Email, and occasionally as an array of
 * one when the column was once multi-value.
 */
export function parseSinglePerson(raw: unknown): Person | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== "object") return null;
  const person = value as { LookupId?: number | string; LookupValue?: string; Email?: string };
  if (!person.LookupValue && !person.Email) return null;
  return {
    displayName: person.LookupValue ?? person.Email ?? "",
    email: person.Email,
    lookupId: person.LookupId === undefined ? undefined : Number(person.LookupId),
  };
}

/** A multi person-or-group value → Person[]. */
export function parsePeople(raw: unknown): Person[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((entry) => parseSinglePerson(entry))
    .filter((p): p is Person => p !== null);
}

export function toGrayMarketRequest(item: GraphListItem): GrayMarketRequest {
  const f = item.fields ?? {};
  const values: Record<string, string> = {};
  for (const field of GRAY_MARKET_FIELDS) {
    values[field.key] = text(f[field.column]).trim();
  }

  return {
    id: parseInt(item.id, 10),
    title: text(f.Title).trim(),
    logNo: text(f.LogNo_x002e_Raw).trim(),
    status: text(f.RequestStatus).trim(),
    requestDate: parseSpDateOnly(f.TodaysDate),
    dateCompleted: parseSpDateOnly(f.DateCompleted),
    testingRequired: text(f.ProductionTest).trim(),
    requestor: parseSinglePerson(f.Requestor),
    partsLocation: parseSinglePerson(f.Parts_x0020_Location),
    watchers: parsePeople(f.Watchers),
    comments: parseCommunication(text(f.Communication)),
    hasAttachments: f.Attachments === true,
    values,
    createdAt: parseSpDate(f.Created) ?? new Date(0),
    modifiedAt: parseSpDate(f.Modified) ?? new Date(0),
  };
}

/**
 * Create payload. Person and date columns are handled by the caller (the API
 * module resolves lookupIds), so this covers Title, the status pair, the date
 * and every descriptor column that was filled in.
 *
 * Blank descriptor values are omitted rather than sent as "": on a create,
 * SharePoint would rather not hear about a column at all than be handed an
 * empty string for it.
 */
export function buildGrayMarketCreateFields(
  input: GrayMarketRequestInput,
  logNo: string,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.title.trim(),
    LogNo_x002e_Raw: logNo,
    RequestStatus: input.status,
    TodaysDate: toSpDateOnly(input.requestDate),
  };
  // Testing Required is decided later in the workflow, so it may be blank on
  // create — omitted rather than sent as "", like every other blank column.
  if (input.testingRequired.trim()) fields.ProductionTest = input.testingRequired.trim();
  for (const field of GRAY_MARKET_FIELDS) {
    const value = (input.values[field.key] ?? "").trim();
    if (!value) continue;
    fields[field.column] = field.kind === "richText" ? toStoredRichText(value) : value;
  }
  return fields;
}

/**
 * One descriptor field → its SharePoint patch. Used by the detail page's
 * inline editors, which each own a single column.
 */
export function grayMarketFieldPatch(key: string, value: string): Record<string, unknown> {
  const field = GRAY_MARKET_FIELDS.find((f) => f.key === key);
  if (!field) throw new Error(`Unknown gray market field: ${key}`);
  return {
    [field.column]: field.kind === "richText" ? toStoredRichText(value) : value.trim(),
  };
}

/** Newest request first — by log number, which is chronological by design. */
export function compareGrayMarketRequests(
  a: GrayMarketRequest,
  b: GrayMarketRequest,
): number {
  const at = a.requestDate?.getTime() ?? -Infinity;
  const bt = b.requestDate?.getTime() ?? -Infinity;
  if (at !== bt) return bt - at;
  return b.id - a.id;
}

/** What to call a request in a toast, an email subject or a page title. */
export function grayMarketLabel(request: GrayMarketRequest): string {
  return request.logNo || request.title || `Request #${request.id}`;
}
