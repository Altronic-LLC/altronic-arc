import type { Ecn, EcnInput, GraphListItem, Person, ProjectReference } from "@/types/task";
import { ECN_FIELDS, ECN_FIELD_BY_KEY } from "./ecnFields";
import { parseCommunication } from "./communicationParser";
import { parseSpDate } from "./spDates";
import { toStoredRichText } from "./richText";
import { htmlToPlainText } from "./htmlText";
import { orderDistribution, parseEcnDistribution } from "./ecnDistribution";
import { parsePeopleLines, serializePeopleLines } from "./peopleLines";

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
    // Absent until scripts/create-ecn-distribution.ps1 has run — and absent
    // from a read that fell back without them (api/ecns.ts). Both read as
    // "nothing ticked, nothing sent".
    distribution: parseEcnDistribution(f.Distribution),
    distributedTo: parsePeopleLines(f.DistributedTo),
    distributedAt: parseSpDate(f.DistributedAt) ?? null,
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
  // Only when something is ticked, so a create never names the column on a
  // list that hasn't got it yet. A plain array here — the write site adds the
  // Collection(Edm.String) annotation (ECN_MULTI_CHOICE_COLUMNS).
  const distribution = orderDistribution(input.distribution ?? []);
  if (distribution.length > 0) fields.Distribution = distribution;
  return fields;
}

/** The ticked roles' patch. An empty array CLEARS it (annotated at the write site). */
export function ecnDistributionPatch(roles: readonly string[]): Record<string, unknown> {
  return { Distribution: orderDistribution(roles) };
}

/** Record who an ECN's distribution went to, and when. */
export function ecnDistributedPatch(people: Person[], at: Date): Record<string, unknown> {
  return { DistributedTo: serializePeopleLines(people), DistributedAt: at.toISOString() };
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

/**
 * A request for serial numbers, typed into the Serial Numbers field as a
 * placeholder — "Please provide serial numbers", "PLEASE INCLUDE SERIAL
 * NUMBER.", "Please provide starting serial number.", or a bare "enter serial
 * numbers".
 */
const SERIAL_REQUEST = /^(please\s+)?(provide|include|add|enter|list)\b.*\bserial/i;

/**
 * Text after a request that shows it was answered: a "Response:", an "s/n"
 * written in, or a pointer to another ECN ("see ECN 160055R1").
 */
const SERIAL_ANSWER = /\bresponse\b|\bs\s*\/\s*n\b|\bsee\s+ecn\b/i;

/**
 * Has nobody recorded serial numbers on this ECN yet? (BusinessIT#61.)
 *
 * True when the Serial Numbers field (`field_6`) is blank, OR it holds only a
 * request for them. The request is how an open ECN usually looks: on the live
 * list (checked 2026-11-04, 1,829 rows) 90 held some spelling of "Please
 * provide serial numbers". Counting blanks alone would miss them.
 *
 * A request counts only while it is ONE line and carries no answer
 * (`SERIAL_ANSWER`). Live, two requests were answered in the same field:
 * "… Response: please see ECN 160055R1", and a request followed by a line of
 * s/n per part. Anything that isn't a request — "N/A", "Not a serialized
 * product", "See R1" — counts as recorded.
 *
 * This is about the FIELD only. Whether the ECN needs serial numbers at all
 * is `ecnStockNeedsSerialNumbers`; the list's Waiting filter asks both
 * (`isEcnWaitingForSerialNumbers`).
 */
export function isEcnSerialNumbersMissing(ecn: Ecn): boolean {
  const lines = htmlToPlainText(ecn.values.serialNumbers ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return true;
  if (lines.length > 1) return false;
  return SERIAL_REQUEST.test(lines[0]) && !SERIAL_ANSWER.test(lines[0]);
}

/** "Engineering - Do NOT modify stock", however it is spelled or cased. */
const DO_NOT_MODIFY = /\bdo\s*n[o']?t\s+modify\b/i;

/**
 * Does this ECN's stock disposition mean serial numbers get recorded? (Tim,
 * 2026-11-04.) Only an ECN whose In House Stock is set to something other
 * than "Do NOT modify" does — "Engineering - Modify stock (see pg 2 of ECN)"
 * or "Operations - Stock modified". A blank disposition and Do NOT modify
 * don't: most ECNs never need a serial number logged, and counting them made
 * the Waiting filter useless (1,409 of 1,829 live rows, against 65 with this
 * rule).
 */
export function ecnStockNeedsSerialNumbers(ecn: Ecn): boolean {
  const stock = (ecn.values.inHouseStock ?? "").trim();
  return stock !== "" && !DO_NOT_MODIFY.test(stock);
}

/** "Please provide serial numbers" (or "…number"), anywhere in the text, any case. */
const PROVIDE_SERIAL_NUMBERS = /\bplease\s+provide\s+serial\s+numbers?\b/i;

/**
 * Does the Serial Numbers field say "Please provide serial numbers"? (Tim,
 * 2026-11-05.) Literally that wording, anywhere in the field — the ECN's
 * author asking for them is reason enough to list it as Waiting, whatever its
 * stock disposition and whatever else the field holds.
 */
export function ecnAsksForSerialNumbers(ecn: Ecn): boolean {
  return PROVIDE_SERIAL_NUMBERS.test(htmlToPlainText(ecn.values.serialNumbers ?? ""));
}

/**
 * The ECN list's "Waiting" serial-numbers filter. Either:
 *  - the field says "Please provide serial numbers" — ANY ECN, even one whose
 *    stock disposition is blank or Do NOT modify, and even one with an answer
 *    written after the request (Tim, 2026-11-05: "any and all"); or
 *  - the stock disposition says serial numbers are needed, and none are
 *    recorded yet.
 */
export function isEcnWaitingForSerialNumbers(ecn: Ecn): boolean {
  if (ecnAsksForSerialNumbers(ecn)) return true;
  return ecnStockNeedsSerialNumbers(ecn) && isEcnSerialNumbersMissing(ecn);
}

/**
 * The "Recorded" filter: serial numbers are on file and the ECN isn't Waiting.
 * Waiting wins, so the two filters never list the same ECN — an answered
 * "Please provide serial numbers" is Waiting, not Recorded.
 */
export function isEcnSerialNumbersRecorded(ecn: Ecn): boolean {
  return !isEcnSerialNumbersMissing(ecn) && !isEcnWaitingForSerialNumbers(ecn);
}
