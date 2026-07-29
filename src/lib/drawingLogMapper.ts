import type {
  DrawingChange,
  DrawingChangeInput,
  DrawingFieldValue,
  DrawingLogEntry,
  DrawingLogInput,
  DrawingLogKind,
  GraphListItem,
} from "@/types/task";
import { DRAWING_LOG_FIELDS, writableFields, type LogField } from "./drawingLogFields";
import { parseSpDate, toSpDateOnly } from "./spDates";

// =============================================================================
// Graph item ↔ DrawingLogEntry, plus the change-log encoding.
//
// Reading and writing are both driven by the per-register field descriptors in
// drawingLogFields.ts, because the four lists share almost no column names. See
// that file for what differs.
//
// The change log is the part that needs real logic. CAD/CCC/CEC store it as
// SIXTEEN FIXED SLOTS across 48 columns:
//
//   CH_DAT01, CH_ECN01, CH_REV01,  CH_DAT02, CH_ECN02, CH_REV02,  … up to 16
//
// A spreadsheet habit carried into SharePoint, with consequences the rest of the
// app shouldn't have to think about: slots can be sparse, there's a hard ceiling
// of 16, and "add a change" means finding a free slot rather than appending. All
// of that is contained here.
// =============================================================================

/** How many change slots the SharePoint lists provide. Not negotiable — it's the schema. */
export const CHANGE_SLOTS = 16;

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

/** Read one declared field out of a Graph `fields` payload, per its type. */
function readField(fields: Record<string, unknown>, field: LogField): DrawingFieldValue {
  const raw = fields[field.column];
  switch (field.type) {
    case "date":
      return parseSpDate(raw);
    case "number":
      return toNumberOrNull(raw);
    case "text":
    default:
      return toText(raw);
  }
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
 * slot 02 is genuinely empty and usable, and skipping it would waste a slot on a
 * list that only has sixteen.
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
 * Also advances the register's own revision and revised-date columns, because
 * that's what recording a revision means — leaving them stale would make the
 * table disagree with the change log underneath it. Which columns those ARE
 * differs per register (`REV_NO`/`DATE_REV` on CCC/CEC, `NewRevision`/
 * `DateCompleted` on CAD), so they come from the descriptors.
 */
export function buildChangeWriteFields(
  kind: DrawingLogKind,
  slot: number,
  change: DrawingChangeInput,
): Record<string, unknown> {
  const rev = change.rev.trim();
  const fields: Record<string, unknown> = {
    [changeDateField(slot)]: toSpDateOnly(change.date),
    [changeEcnField(slot)]: change.ecn.trim(),
    [changeRevField(slot)]: rev,
  };

  const spec = DRAWING_LOG_FIELDS[kind];
  const revField = spec.fields.find((f) => f.key === "revNo" || f.key === "newRevision");
  if (rev && revField) fields[revField.column] = rev;

  // The register's "last touched" date: its first sort key that's a real date
  // column. On CCC/CEC that's DATE_REV; on CAD, DateCompleted.
  const dateKey = spec.sortKeys[0];
  const dateField = spec.fields.find((f) => f.key === dateKey && f.type === "date");
  if (change.date && dateField) fields[dateField.column] = toSpDateOnly(change.date);

  return fields;
}

export function toDrawingLogEntry(item: GraphListItem, kind: DrawingLogKind): DrawingLogEntry {
  const f = item.fields as Record<string, unknown>;
  const spec = DRAWING_LOG_FIELDS[kind];
  const values: Record<string, DrawingFieldValue> = {};
  for (const field of spec.fields) values[field.key] = readField(f, field);
  return {
    id: parseInt(item.id, 10),
    kind,
    values,
    // Sketches has no CH_* columns at all, so this comes back empty for it
    // without needing a special case.
    changes: spec.hasChangeLog ? parseChangeLog(f) : [],
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
  };
}

/** Domain input → SharePoint fields payload, skipping the read-only legacy ids. */
export function buildDrawingWriteFields(
  kind: DrawingLogKind,
  input: DrawingLogInput,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of writableFields(kind)) {
    const value = input[field.key];
    if (field.type === "date") {
      fields[field.column] = toSpDateOnly(value instanceof Date ? value : null);
    } else if (field.type === "number") {
      fields[field.column] = typeof value === "number" ? value : null;
    } else {
      fields[field.column] = typeof value === "string" ? value.trim() : "";
    }
  }
  return fields;
}

/** A field's value as a display string. */
export function fieldText(entry: DrawingLogEntry, key: string): string {
  const value = entry.values[key];
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * A label for toasts, confirms and row aria-labels: the register's primary
 * identifier, with its secondary one alongside when it adds something.
 */
export function drawingLogLabel(entry: DrawingLogEntry): string {
  // Tolerant of an entry whose kind isn't a known register: this runs inside
  // success toasts, where throwing would turn a completed save into an error.
  const spec = DRAWING_LOG_FIELDS[entry.kind];
  if (!spec) {
    const first = Object.values(entry.values ?? {}).find(
      (v) => typeof v === "string" && v.trim(),
    );
    return typeof first === "string" ? first : "(untitled drawing)";
  }
  const primary = fieldText(entry, spec.primaryKey).trim();
  const secondary = spec.secondaryKey ? fieldText(entry, spec.secondaryKey).trim() : "";
  if (primary && secondary && primary !== secondary) return `${primary} (${secondary})`;
  return primary || secondary || "(untitled drawing)";
}

/** The register's most meaningful date for this row — first non-null sort key. */
export function sortDate(entry: DrawingLogEntry): number | null {
  for (const key of DRAWING_LOG_FIELDS[entry.kind].sortKeys) {
    const value = entry.values[key];
    if (value instanceof Date) return value.getTime();
  }
  return null;
}

/**
 * Sort: most recent first, undated last.
 *
 * Undated rows go to the bottom rather than the top — these registers go back to
 * the 1980s and rows with no dates are gaps, not news.
 */
export function compareDrawingLogEntries(a: DrawingLogEntry, b: DrawingLogEntry): number {
  const at = sortDate(a);
  const bt = sortDate(b);
  if (at === null && bt === null) return b.id - a.id;
  if (at === null) return 1;
  if (bt === null) return -1;
  if (at !== bt) return bt - at;
  return b.id - a.id;
}

/**
 * Does this row match every search token?
 *
 * Covers every declared field plus the change log's ECNs — "which drawing did
 * ECN-0031 change?" is a question people ask, and the ECNs are otherwise buried
 * in 48 columns that never appear in the table.
 */
export function drawingLogMatches(entry: DrawingLogEntry, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const parts: string[] = [];
  for (const [, value] of Object.entries(entry.values)) {
    if (value === null || value instanceof Date) continue;
    parts.push(String(value));
  }
  for (const change of entry.changes) parts.push(change.ecn, change.rev);
  const haystack = parts.join(" ").toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}
