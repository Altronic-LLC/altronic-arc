import type { GraphListItem, Person, Scn, ScnInput, ScnLink, ScnPatch } from "@/types/task";
import { SCN_FIELDS, scnField, type ScnField } from "./scnFields";
import { parseCommunication } from "./communicationParser";
import { parsePersonField } from "./taskMapper";
import { parseSpDate, parseSpDateOnly, toSpDateOnly } from "./spDates";
import { scnYearOf } from "./scnNumber";

// =============================================================================
// Graph item → Scn, and back.
//
// Both directions are driven by the descriptor table in scnFields.ts, so a
// column added there is read, written, selected and rendered without touching
// this file.
//
// Three things worth knowing about the stored data:
//
//  - **Dates come back at 22:00Z / 23:00Z** — local midnight in the site's
//    regional timezone, the same tenant quirk as Visit Reports and Gray
//    Market. `parseSpDateOnly`'s midday pivot snaps them to the day the
//    SharePoint view shows; `toSpDateOnly` writes midday UTC.
//  - **All three person columns are MULTI-value**, so Graph expands them in
//    full (`LookupId` / `LookupValue` / `Email`) — no bare-lookupId two-step
//    is needed, unlike a single-value column.
//  - **`Task_x0020_List` is a Hyperlink column** (`{ Url, Description }`). It
//    is read and never written: a Hyperlink value 400s at item creation
//    (CLAUDE.md, "Hyperlink columns"), and nobody asked to edit Planner links
//    from ARC.
// =============================================================================

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A multi-choice column: an array on the live rows, occasionally a lone string. */
function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

/** `{ Url, Description }` → ScnLink, or null for an empty column. */
export function parseScnLink(value: unknown): ScnLink | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { Url?: unknown; Description?: unknown };
  const url = text(raw.Url).trim();
  if (!url) return null;
  return { url, description: text(raw.Description).trim() || url };
}

/** Graph's createdBy identity → Person, or null when Graph didn't send one. */
function parseCreatedBy(item: GraphListItem): Person | null {
  const user = item.createdBy?.user;
  if (!user?.displayName && !user?.email) return null;
  return { displayName: user.displayName ?? user.email ?? "", email: user.email };
}

export function toScn(item: GraphListItem): Scn {
  const f = item.fields ?? {};
  const values: Record<string, string> = {};
  const checks: Record<string, string[]> = {};
  const dates: Record<string, Date | null> = {};
  const named: Record<string, string> = {};

  for (const field of SCN_FIELDS) {
    switch (field.kind) {
      case "text":
      case "multiline":
      case "choice":
        if (field.named) named[field.key] = text(f[field.column]).trim();
        else values[field.key] = text(f[field.column]).trim();
        break;
      case "multiChoice":
        checks[field.key] = strings(f[field.column]);
        break;
      case "date":
        dates[field.key] = parseSpDateOnly(f[field.column]);
        break;
      default:
        // person / link — named below
        break;
    }
  }

  return {
    id: parseInt(item.id, 10),
    scnNumber: text(f.Title).trim(),
    year: text(f.YEAR).trim(),
    product: named.product ?? "",
    category: named.category ?? "",
    status: named.status ?? "",
    approvalStatus: named.approvalStatus ?? "",
    assignedTo: parsePersonField(f.AssignedTo),
    owner: parsePersonField(f.Owner),
    watchers: parsePersonField(f.Watchers),
    comments: parseCommunication(text(f.Communication)),
    hasAttachments: f.Attachments === true,
    values,
    checks,
    dates,
    taskList: parseScnLink(f.Task_x0020_List),
    createdBy: parseCreatedBy(item),
    createdAt:
      parseSpDate(item.createdDateTime) ?? parseSpDate(f.Created) ?? new Date(0),
    modifiedAt:
      parseSpDate(item.lastModifiedDateTime) ?? parseSpDate(f.Modified) ?? new Date(0),
  };
}

/** The domain value behind a descriptor key, whichever slot it lives in. */
export function scnValue(scn: Scn, key: string): string | string[] | Date | null {
  const field = scnField(key);
  if (!field) throw new Error(`Unknown SCN field: ${key}`);
  switch (field.kind) {
    case "multiChoice":
      return scn.checks[key] ?? [];
    case "date":
      return scn.dates[key] ?? null;
    case "person":
      throw new Error(`SCN field ${key} is a person column — read scn.${key} directly`);
    case "link":
      return scn.taskList?.url ?? null;
    default:
      return field.named ? (scn[key as "product" | "category" | "status" | "approvalStatus"] ?? "") : (scn.values[key] ?? "");
  }
}

/** Fields a patch may carry: everything except the person columns and the read-only link. */
function writableField(key: string): ScnField {
  const field = scnField(key);
  if (!field) throw new Error(`Unknown SCN field: ${key}`);
  if (field.readOnly) {
    throw new Error(`SCN field ${key} (${field.column}) is read-only and is never written`);
  }
  if (field.kind === "person") {
    throw new Error(`SCN field ${key} is a person column — use setScnAssigned / setScnOwner`);
  }
  return field;
}

/** One descriptor value → its SharePoint column value. */
function columnValue(field: ScnField, value: ScnPatch[string]): unknown {
  switch (field.kind) {
    case "multiChoice":
      // The annotation is added at the write site (annotateMultiChoiceFields).
      // Clearing is an annotated `[]`, never null.
      return Array.isArray(value) ? value : [];
    case "date":
      return value instanceof Date ? toSpDateOnly(value) : null;
    default:
      return typeof value === "string" ? value.trim() : "";
  }
}

function sameValue(field: ScnField, a: ScnPatch[string], b: ScnPatch[string]): boolean {
  switch (field.kind) {
    case "multiChoice": {
      const x = Array.isArray(a) ? a : [];
      const y = Array.isArray(b) ? b : [];
      return x.length === y.length && x.every((v, i) => v === y[i]);
    }
    case "date": {
      const x = a instanceof Date ? a.getTime() : null;
      const y = b instanceof Date ? b.getTime() : null;
      return x === y;
    }
    default:
      return (typeof a === "string" ? a.trim() : "") === (typeof b === "string" ? b.trim() : "");
  }
}

/**
 * Create payload: Title, YEAR, the status pair and every descriptor column
 * that was filled in. Person columns are the caller's (the API module resolves
 * lookupIds against the site); `Task_x0020_List` and `Communication` are
 * never in a create.
 *
 * Blank descriptor values are omitted rather than sent as "": on a create,
 * SharePoint would rather not hear about a column at all than be handed an
 * empty string for it.
 */
export function buildScnCreateFields(input: ScnInput, scnNumber: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: scnNumber,
    YEAR: scnYearOf(scnNumber),
    SCNStatus: (input.status ?? "").trim() || "WIP",
    ApprovalStatus: input.approvalStatus.trim(),
  };
  if (input.product.trim()) fields.Progress = input.product.trim();
  if (input.category.trim()) fields.Priority = input.category.trim();
  for (const field of SCN_FIELDS) {
    const isString = field.kind === "text" || field.kind === "multiline" || field.kind === "choice";
    if (field.named || !isString) continue;
    const value = (input.values[field.key] ?? "").trim();
    if (value) fields[field.column] = value;
  }
  return fields;
}

/**
 * Update payload — ONLY the columns that actually changed against the row the
 * edit started from. A card re-saved unchanged sends nothing, and a column
 * the caller didn't touch never travels (the same reason Visit Reports and
 * MRB diff their writes: re-sending a stored value the column no longer
 * declares makes SharePoint refuse the whole PATCH).
 *
 * Multi-choice arrays come back PLAIN; `api/scns.ts` adds the
 * `Collection(Edm.String)` annotation at the write site.
 */
export function buildScnUpdateFields(changes: ScnPatch, previous: Scn): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    const field = writableField(key);
    if (sameValue(field, value, scnValue(previous, key))) continue;
    fields[field.column] = columnValue(field, value);
  }
  return fields;
}

/** The row as it will read once a patch lands — for the optimistic cache and the mock store. */
export function applyScnPatch(scn: Scn, changes: ScnPatch): Scn {
  const next: Scn = {
    ...scn,
    values: { ...scn.values },
    checks: { ...scn.checks },
    dates: { ...scn.dates },
  };
  for (const [key, value] of Object.entries(changes)) {
    const field = writableField(key);
    switch (field.kind) {
      case "multiChoice":
        next.checks[key] = Array.isArray(value) ? [...value] : [];
        break;
      case "date":
        next.dates[key] = value instanceof Date ? value : null;
        break;
      default: {
        const str = typeof value === "string" ? value.trim() : "";
        if (field.named) {
          (next as unknown as Record<string, unknown>)[key] = str;
        } else {
          next.values[key] = str;
        }
      }
    }
  }
  return next;
}

/** Newest SCN first — the SCN# is chronological by construction; ties on id. */
export function compareScns(a: Scn, b: Scn): number {
  if (a.scnNumber !== b.scnNumber) return a.scnNumber < b.scnNumber ? 1 : -1;
  return b.id - a.id;
}

/** What to call an SCN in a toast, an email subject or a page title. */
export function scnLabel(scn: Scn): string {
  const number = scn.scnNumber || `SCN #${scn.id}`;
  return scn.product ? `${number} — ${scn.product}` : number;
}
