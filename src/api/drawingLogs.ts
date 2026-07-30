import { graphFetch, graphFetchAll } from "./graph";
import {
  SITES,
  SP_CAD_DRAWINGS_LIST_ID,
  SP_CCC_DRAWINGS_LIST_ID,
  SP_CEC_DRAWINGS_LIST_ID,
  SP_ENGINEERING_SKETCHES_LIST_ID,
  USE_MOCK,
} from "./config";
import type {
  DrawingChangeInput,
  DrawingLogEntry,
  DrawingLogInput,
  DrawingLogKind,
  GraphListItem,
} from "@/types/task";
import { DRAWING_LOG_KINDS } from "@/types/task";
import {
  DRAWING_LOG_FIELDS,
  selectColumns,
  type DrawingLogFieldSpec,
} from "@/lib/drawingLogFields";
import {
  buildChangeUpdateFields,
  buildChangeWriteFields,
  buildDrawingWriteFields,
  compareDrawingLogEntries,
  nextFreeChangeSlot,
  parseChangeLog,
  toDrawingLogEntry,
} from "@/lib/drawingLogMapper";
import { MOCK_DRAWING_LOGS } from "@/data/drawingLogMockData";

// =============================================================================
// Drawing File Logs API — the four Engineering drawing registers behind one
// screen: CAD, CCC, CEC Drawings and Engineering Sketches.
//
// One parametrised module rather than four, but NOT because the lists are alike —
// they mostly aren't (see src/lib/drawingLogFields.ts for what differs). What
// they share is the shape of the WORK: list, create, update, delete, and append a
// change. The per-register columns are data, declared once in the field
// descriptors and used here to build both the `$select` and the write payloads.
//
// A log with no configured list id is UNAVAILABLE: callers ask
// `availableDrawingLogs()` rather than assuming all four are live. All four are
// configured today, but that tolerance is what let the screen ship useful while
// CAD's list id was still unknown.
// =============================================================================

const LIST_IDS: Record<DrawingLogKind, string | undefined> = {
  cad: SP_CAD_DRAWINGS_LIST_ID,
  ccc: SP_CCC_DRAWINGS_LIST_ID,
  cec: SP_CEC_DRAWINGS_LIST_ID,
  sketches: SP_ENGINEERING_SKETCHES_LIST_ID,
};

export interface DrawingLogSpec extends DrawingLogFieldSpec {
  kind: DrawingLogKind;
  listId: string | undefined;
}

export const DRAWING_LOGS: Record<DrawingLogKind, DrawingLogSpec> = Object.fromEntries(
  DRAWING_LOG_KINDS.map((kind) => [
    kind,
    { ...DRAWING_LOG_FIELDS[kind], kind, listId: LIST_IDS[kind] },
  ]),
) as Record<DrawingLogKind, DrawingLogSpec>;

/** The logs that actually have a list configured. */
export function availableDrawingLogs(): DrawingLogSpec[] {
  return DRAWING_LOG_KINDS.map((k) => DRAWING_LOGS[k]).filter(
    (spec) => USE_MOCK || Boolean(spec.listId),
  );
}

export function isDrawingLogAvailable(kind: DrawingLogKind): boolean {
  return USE_MOCK || Boolean(DRAWING_LOGS[kind].listId);
}

export const CHANGE_LOG_FULL =
  "This drawing's change log is full — all 16 slots on the SharePoint list are used. " +
  "Record the change in SharePoint, or ask IT to add more CH_ columns.";

// -----------------------------------------------------------------------------
// Mock store
// -----------------------------------------------------------------------------

let mockStore: DrawingLogEntry[] = MOCK_DRAWING_LOGS.map((e) => ({
  ...e,
  values: { ...e.values },
  changes: e.changes.map((c) => ({ ...c })),
}));

function delay<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function clone(entry: DrawingLogEntry): DrawingLogEntry {
  return { ...entry, values: { ...entry.values }, changes: entry.changes.map((c) => ({ ...c })) };
}

function requireListId(kind: DrawingLogKind): string {
  const id = DRAWING_LOGS[kind].listId;
  if (!id) {
    throw new Error(
      `The ${DRAWING_LOGS[kind].label} list isn't configured yet — its SharePoint list id is unknown.`,
    );
  }
  return id;
}

function itemsPath(kind: DrawingLogKind): string {
  return `/sites/${SITES.engineering}/lists/${requireListId(kind)}/items`;
}

/** Every row of one register, most recent first. */
export async function listDrawingLog(kind: DrawingLogKind): Promise<DrawingLogEntry[]> {
  if (USE_MOCK) {
    return delay(
      mockStore.filter((e) => e.kind === kind).sort(compareDrawingLogEntries).map(clone),
    );
  }

  // $top=999 is Graph's max page size; CAD and Sketches are both 1,000+ rows, so
  // that's two requests rather than five. graphFetchAll walks the rest.
  const items = await graphFetchAll<GraphListItem>(
    `${itemsPath(kind)}?$expand=fields($select=${selectColumns(kind)})&$top=999`,
  );
  return items.map((item) => toDrawingLogEntry(item, kind)).sort(compareDrawingLogEntries);
}

function applyInput(base: DrawingLogEntry, input: DrawingLogInput): DrawingLogEntry {
  const values = { ...base.values };
  for (const field of DRAWING_LOGS[base.kind].fields) {
    if (field.readOnly) continue;
    const value = input[field.key];
    values[field.key] =
      field.type === "text" ? (typeof value === "string" ? value.trim() : "") : (value ?? null);
  }
  return { ...base, values, modifiedAt: new Date() };
}

function emptyEntry(kind: DrawingLogKind, id: number): DrawingLogEntry {
  const values: DrawingLogEntry["values"] = {};
  for (const field of DRAWING_LOGS[kind].fields) {
    values[field.key] = field.type === "text" ? "" : null;
  }
  return { id, kind, values, changes: [], createdAt: new Date(), modifiedAt: new Date() };
}

export async function createDrawingLogEntry(
  kind: DrawingLogKind,
  input: DrawingLogInput,
): Promise<DrawingLogEntry> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((e) => e.id)) + 1;
    const created = applyInput(emptyEntry(kind, nextId), input);
    mockStore = [...mockStore, created];
    return delay(clone(created));
  }

  const created = await graphFetch<GraphListItem>(itemsPath(kind), {
    method: "POST",
    body: JSON.stringify({ fields: buildDrawingWriteFields(kind, input) }),
  });
  return toDrawingLogEntry(created, kind);
}

export async function updateDrawingLogEntry(
  kind: DrawingLogKind,
  id: number,
  input: DrawingLogInput,
): Promise<DrawingLogEntry> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id && e.kind === kind);
    if (idx < 0) throw new Error(`Drawing ${id} not found in ${DRAWING_LOGS[kind].label}`);
    const next = applyInput(mockStore[idx], input);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay(clone(next));
  }

  await graphFetch(`${itemsPath(kind)}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(buildDrawingWriteFields(kind, input)),
  });
  return applyInput(emptyEntry(kind, id), input);
}

/**
 * Append a change to the next free slot.
 *
 * Throws when all 16 are used — the schema has no room for a 17th, and silently
 * dropping the change or overwriting slot 16 would both lose history.
 */
export async function appendDrawingChange(
  kind: DrawingLogKind,
  id: number,
  change: DrawingChangeInput,
): Promise<DrawingLogEntry> {
  const spec = DRAWING_LOGS[kind];
  if (!spec.hasChangeLog) {
    throw new Error(`${spec.label} doesn't have a change log.`);
  }

  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id && e.kind === kind);
    if (idx < 0) throw new Error(`Drawing ${id} not found in ${spec.label}`);
    const existing = mockStore[idx];
    const slot = nextFreeChangeSlot(existing.changes);
    if (slot === null) throw new Error(CHANGE_LOG_FULL);

    // Mirror what the real write does: recording a revision makes it the
    // register's current revision, and stamps its "last touched" date.
    const values = { ...existing.values };
    const rev = change.rev.trim();
    const revField = spec.fields.find((f) => f.key === "revNo" || f.key === "newRevision");
    if (rev && revField) values[revField.key] = rev;
    const dateKey = spec.sortKeys[0];
    if (change.date && spec.fields.some((f) => f.key === dateKey && f.type === "date")) {
      values[dateKey] = change.date;
    }

    const next: DrawingLogEntry = {
      ...existing,
      values,
      changes: [...existing.changes, { slot, date: change.date, ecn: change.ecn.trim(), rev }].sort(
        (a, b) => a.slot - b.slot,
      ),
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay(clone(next));
  }

  // Re-read first: the free slot depends on what's there NOW, and two people
  // recording a revision minutes apart would otherwise target the same slot and
  // one would overwrite the other.
  const current = await graphFetch<GraphListItem>(
    `${itemsPath(kind)}/${id}?$expand=fields($select=${selectColumns(kind)})`,
  );
  const slot = nextFreeChangeSlot(parseChangeLog(current.fields as Record<string, unknown>));
  if (slot === null) throw new Error(CHANGE_LOG_FULL);

  await graphFetch(`${itemsPath(kind)}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(buildChangeWriteFields(kind, slot, change)),
  });

  const refreshed = await graphFetch<GraphListItem>(
    `${itemsPath(kind)}/${id}?$expand=fields($select=${selectColumns(kind)})`,
  );
  return toDrawingLogEntry(refreshed, kind);
}

/**
 * Correct an existing change-log entry, in place.
 *
 * Writes only that slot. Clearing all three values empties the slot, which frees
 * it for reuse — the only way to undo a change recorded by mistake, since the log
 * is a fixed sixteen slots and there's no "remove a row".
 */
export async function updateDrawingChange(
  kind: DrawingLogKind,
  id: number,
  slot: number,
  change: DrawingChangeInput,
): Promise<DrawingLogEntry> {
  const spec = DRAWING_LOGS[kind];
  if (!spec.hasChangeLog) {
    throw new Error(`${spec.label} doesn't have a change log.`);
  }

  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id && e.kind === kind);
    if (idx < 0) throw new Error(`Drawing ${id} not found in ${spec.label}`);
    const existing = mockStore[idx];
    const ecn = change.ecn.trim();
    const rev = change.rev.trim();
    const emptied = change.date === null && !ecn && !rev;
    const next: DrawingLogEntry = {
      ...existing,
      changes: emptied
        ? existing.changes.filter((c) => c.slot !== slot)
        : existing.changes.map((c) =>
            c.slot === slot ? { slot, date: change.date, ecn, rev } : c,
          ),
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay(clone(next));
  }

  await graphFetch(`${itemsPath(kind)}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(buildChangeUpdateFields(slot, change)),
  });

  const refreshed = await graphFetch<GraphListItem>(
    `${itemsPath(kind)}/${id}?$expand=fields($select=${selectColumns(kind)})`,
  );
  return toDrawingLogEntry(refreshed, kind);
}

export async function deleteDrawingLogEntry(kind: DrawingLogKind, id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((e) => !(e.id === id && e.kind === kind));
    await delay(null);
    return;
  }
  await graphFetch(`${itemsPath(kind)}/${id}`, { method: "DELETE" });
}
