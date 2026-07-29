import type {
  DrawingChange,
  DrawingChangeInput,
  DrawingLogEntry,
  DrawingLogKind,
  GraphListItem,
} from "@/types/task";
import { parseSpDate, toSpDateOnly } from "./spDates";

// =============================================================================
// Graph item → DrawingLogEntry, and the change-log encoding.
//
// The change log is the whole reason this module exists. CAD/CCC/CEC store it as
// SIXTEEN FIXED SLOTS across 48 columns:
//
//   CH_DAT01, CH_ECN01, CH_REV01,  CH_DAT02, CH_ECN02, CH_REV02,  … up to 16
//
// That's a spreadsheet habit carried into SharePoint, and it has consequences
// the rest of the app shouldn't have to think about: slots can be sparse (a row
// might fill 01 and 03), there's a hard ceiling of 16, and "add a change" means
// finding the next free slot rather than appending to a list. All of that is
// contained here — everything above this layer sees a `changes` array.
//
// Sketches has none of these columns; its change log is always empty.
// =============================================================================

/** How many change slots the SharePoint lists provide. Not negotiable — it's the schema. */
export const CHANGE_SLOTS = 16;

/** Two-digit slot suffix, as the column names use it. */
function slotSuffix(slot: number): string {
  return String(slot).padStart(2, "0");
}

export function changeDateField(slot: number): string {
  return `CH_DAT${slotSuffix(slot)}`;
}
export function changeEcnField(slot: number): string {
  return `CH_ECN${slotSuffix(slot)}`;
}
export function changeRevField(slot: number): string {
  return `CH_REV${slotSuffix(slot)}`;
}

function toText(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fold the 48 CH_* columns into a change list, oldest slot first.
 *
 * A slot counts as used if ANY of its three columns has a value — a change with
 * an ECN but no date recorded is still a change, and dropping it because one
 * cell is blank would quietly lose history.
 */
export function parseChangeLog(fields: Record<string, unknown>): DrawingChange[] {
  const changes: DrawingChange[] = [];
  for (let slot = 1; slot <= CHANGE_SLOTS; slot += 1) {
    const date = parseSpDate(fields[changeDateField(slot)]);
    const ecn = toText(fields[changeEcnField(slot)]).trim();
    const rev = toText(fields[changeRevField(slot)]).trim();
    if (date === null && !ecn && !rev) continue;
    changes.push({ slot, date, ecn, rev });
  }
  return changes;
}

/**
 * The next free slot for a new change, or null when all 16 are used.
 *
 * Deliberately "first gap", not "highest + 1": if a row has 01 and 03 filled,
 * slot 02 is genuinely empty and usable, and skipping it would waste a slot on
 * a list that only has sixteen.
 */
export function nextFreeChangeSlot(changes: DrawingChange[]): number | null {
  const used = new Set(changes.map((c) => c.slot));
  for (let slot = 1; slot <= CHANGE_SLOTS; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

/**
 * SharePoint fields for writing one change into a specific slot.
 *
 * Also advances the drawing's own `REV_NO` and `DATE_REV` to match, because
 * that's what recording a revision means — leaving them stale would make the
 * table disagree with the change log underneath it. A change with no revision
 * letter leaves REV_NO alone.
 */
export function buildChangeWriteFields(
  slot: number,
  change: DrawingChangeInput,
): Record<string, unknown> {
  const rev = change.rev.trim();
  const fields: Record<string, unknown> = {
    [changeDateField(slot)]: toSpDateOnly(change.date),
    [changeEcnField(slot)]: change.ecn.trim(),
    [changeRevField(slot)]: rev,
  };
  if (rev) fields.REV_NO = rev;
  if (change.date) fields.DATE_REV = toSpDateOnly(change.date);
  return fields;
}

/** The legacy id column for each log — different name per list, same meaning. */
export function legacyIdField(kind: DrawingLogKind): string {
  switch (kind) {
    case "ccc":
      return "CCC_ID";
    case "cec":
      return "CEC_ID";
    case "sketches":
      return "SK_ID";
    case "cad":
    default:
      // CAD's own id column follows the same pattern; confirmed when the list
      // is wired up. Falling back to CAD_ID keeps the mapper honest either way:
      // an absent column simply reads as null.
      return "CAD_ID";
  }
}

export function toDrawingLogEntry(item: GraphListItem, kind: DrawingLogKind): DrawingLogEntry {
  const f = item.fields as Record<string, unknown>;
  return {
    id: parseInt(item.id, 10),
    kind,
    title: toText(f.Title),
    partNo: toText(f.PARTNO),
    description: toText(f.DESCR),
    dateStarted: parseSpDate(f.DATE_ST),
    dateRevised: parseSpDate(f.DATE_REV),
    size: toText(f.DWG_SIZE),
    revNo: toText(f.REV_NO),
    // Sketches has no CH_* columns at all, so this comes back empty for it
    // without needing a special case.
    changes: parseChangeLog(f),
    legacyId: toNumberOrNull(f[legacyIdField(kind)]),
    sketchNumber: toNumberOrNull(f.SK_Num),
    vCode: toNumberOrNull(f.V_CODE),
    ventura: toText(f.VENTURA),
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
  };
}

/** A label for toasts and confirm dialogs. */
export function drawingLogLabel(entry: Pick<DrawingLogEntry, "title" | "partNo">): string {
  const title = entry.title.trim();
  const part = entry.partNo.trim();
  if (title && part && title !== part) return `${title} (${part})`;
  return title || part || "(untitled drawing)";
}

/**
 * Sort: most recently revised first, falling back to the start date, then id.
 *
 * Undated rows sort last rather than first — the register goes back to the
 * 1980s and rows with no dates are gaps, not news.
 */
export function compareDrawingLogEntries(a: DrawingLogEntry, b: DrawingLogEntry): number {
  const at = (a.dateRevised ?? a.dateStarted)?.getTime() ?? null;
  const bt = (b.dateRevised ?? b.dateStarted)?.getTime() ?? null;
  if (at === null && bt === null) return b.id - a.id;
  if (at === null) return 1;
  if (bt === null) return -1;
  if (at !== bt) return bt - at;
  return b.id - a.id;
}

/**
 * Does this row match every search token?
 *
 * Includes the change log's ECNs — "which drawing did ECN 12345 change?" is a
 * question people actually ask, and the answer is otherwise unfindable.
 */
export function drawingLogMatches(entry: DrawingLogEntry, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = [
    entry.title,
    entry.partNo,
    entry.description,
    entry.size,
    entry.revNo,
    entry.ventura,
    entry.sketchNumber === null ? "" : String(entry.sketchNumber),
    entry.legacyId === null ? "" : String(entry.legacyId),
    ...entry.changes.map((c) => `${c.ecn} ${c.rev}`),
  ]
    .join(" ")
    .toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}
