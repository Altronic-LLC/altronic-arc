import type { Ecn, EcnInput, GraphListItem, Person, ProjectReference } from "@/types/task";
import { ECN_FIELDS, ECN_FIELD_BY_KEY } from "./ecnFields";
import { parseCommunication } from "./communicationParser";
import { parseSpDate } from "./spDates";
import { toStoredRichText } from "./richText";

// =============================================================================
// Graph item → Ecn, and back.
//
// Both directions run off the descriptor table in ecnFields.ts, so a column
// added there is read, written, selected and rendered without touching this
// file.
//
// Three things about this list's stored data:
//
//  - **The long fields hold SharePoint rich text** — `<div
//    class="ExternalClass…">…</div>`, with `&#58;` and `&#160;` entities. They
//    render sanitised and are written back through `toStoredRichText`, the
//    same conversion the EIR long fields use.
//  - **Two columns are real booleans** (`field_8`, `field_9`). They're carried
//    in `values` as "Yes" / "" so the record stays one shape, and turned back
//    into `true` / `false` on write. A checkbox is the only thing that edits
//    them, so there's no third state to lose.
//  - **The project is a SINGLE lookup**, added to the list on 2026-08-19.
//    Graph returns it as `ProjectReferenceLookupId` with no title attached, so
//    the title is joined client-side against the loaded Projects list. Writing
//    it is a BARE INTEGER — `multiLookupField`'s Collection(Edm.Int32) shape is
//    for multi-value lookups and 400s here.
//  - **`submittedBy` is Graph's `createdBy`, not a column.** The list has no
//    requester column at all. For the rows that arrived with the 2026-08-12
//    migration that's the migration account — accurate about who put the row
//    in SharePoint, which is all the data supports.
// =============================================================================

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Graph's createdBy identity → Person, or null when Graph didn't send one. */
export function parseCreatedBy(item: GraphListItem): Person | null {
  const user = item.createdBy?.user;
  if (!user) return null;
  const displayName = user.displayName?.trim() ?? "";
  const email = user.email?.trim();
  if (!displayName && !email) return null;
  return { displayName: displayName || email || "", email };
}

/** `ProjectReferenceLookupId` → a title-less ProjectReference, or null. */
export function parseProjectLookup(raw: unknown): ProjectReference | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const lookupId = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(lookupId) || lookupId <= 0) return null;
  return { lookupId, title: "" };
}

export function toEcn(item: GraphListItem): Ecn {
  const f = item.fields ?? {};
  const values: Record<string, string> = {};
  for (const field of ECN_FIELDS) {
    const raw = f[field.column];
    values[field.key] =
      field.kind === "boolean" ? (raw === true ? "Yes" : "") : text(raw).trim();
  }

  return {
    id: parseInt(item.id, 10),
    title: text(f.Title).trim(),
    logNo: text(f.field_2).trim(),
    parentProject: parseProjectLookup(f.ProjectReferenceLookupId),
    submittedBy: parseCreatedBy(item),
    comments: parseCommunication(text(f.Communication)),
    hasAttachments: f.Attachments === true,
    values,
    createdAt: parseSpDate(f.Created) ?? new Date(0),
    modifiedAt: parseSpDate(f.Modified) ?? new Date(0),
  };
}

/** One descriptor value → what SharePoint should be sent for that column. */
function columnValue(key: string, value: string): unknown {
  const field = ECN_FIELD_BY_KEY[key];
  if (!field) throw new Error(`Unknown ECN field: ${key}`);
  if (field.kind === "boolean") return value === "Yes";
  if (field.kind === "richText") return toStoredRichText(value);
  return value.trim();
}

/**
 * Create payload — Title, the Log#, and every descriptor column that was
 * filled in.
 *
 * Blank text values are omitted rather than sent as "": on a create,
 * SharePoint would rather not hear about a column than be handed an empty
 * string for it. Booleans are always sent, because "unticked" is a real
 * answer to "Field Returns Impacted" and leaving the column null makes the
 * SharePoint views read it as blank rather than No.
 */
export function buildEcnCreateFields(input: EcnInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.title.trim(),
    field_2: input.logNo.trim(),
    ...projectPatch(input.projectLookupId),
  };
  for (const field of ECN_FIELDS) {
    const value = (input.values[field.key] ?? "").trim();
    if (field.kind === "boolean") {
      fields[field.column] = value === "Yes";
      continue;
    }
    if (!value) continue;
    fields[field.column] = columnValue(field.key, value);
  }
  return fields;
}

/**
 * The project lookup's patch. A single-value lookup takes a BARE INTEGER;
 * null clears it. Sending `Collection(Edm.Int32)` here — the shape multi-value
 * person and lookup columns need — is a 400.
 */
export function projectPatch(lookupId: number | null): Record<string, unknown> {
  return { ProjectReferenceLookupId: lookupId ?? null };
}

/**
 * One descriptor field → its SharePoint patch. Used by the detail page's
 * inline editors, which each own a single column.
 */
export function ecnFieldPatch(key: string, value: string): Record<string, unknown> {
  const field = ECN_FIELD_BY_KEY[key];
  if (!field) throw new Error(`Unknown ECN field: ${key}`);
  return { [field.column]: columnValue(key, value) };
}

/**
 * Newest first, by Log#.
 *
 * The number is chronological by construction (`YY####`), so it sorts better
 * than Created does — every migrated row shares one creation timestamp, and
 * sorting on that would shuffle 1,800 notices into import order.
 */
export function compareEcns(a: Ecn, b: Ecn): number {
  const rank = ecnSortKey(b) - ecnSortKey(a);
  if (rank !== 0) return rank;
  return b.id - a.id;
}

/** `260059R1` → 2600590001, so a revision sorts just above its base notice. */
function ecnSortKey(ecn: Ecn): number {
  const parsed = parseEcnLogNo(ecn.logNo);
  if (!parsed) return -Infinity;
  return parsed.year * 1e8 + parsed.sequence * 1e4 + parsed.revision;
}

/** Split a Log# into its parts, or null when it isn't one. */
export function parseEcnLogNo(
  logNo: string,
): { year: number; sequence: number; revision: number } | null {
  const match = /^(\d{2})(\d{4})(?:R(\d+))?$/i.exec((logNo ?? "").trim());
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    sequence: parseInt(match[2], 10),
    revision: match[3] ? parseInt(match[3], 10) : 0,
  };
}

/** What to call an ECN in a toast, an email subject or a page title. */
export function ecnLabel(ecn: Ecn): string {
  if (ecn.logNo && ecn.title) return `ECN ${ecn.logNo} — ${ecn.title}`;
  if (ecn.logNo) return `ECN ${ecn.logNo}`;
  return ecn.title || `ECN #${ecn.id}`;
}

/** True when the notice is flagged On Hold. */
export function isEcnOnHold(ecn: Ecn): boolean {
  return (ecn.values.onHold ?? "").trim().toLowerCase() === "yes";
}
