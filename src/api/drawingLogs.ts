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
import {
  buildChangeWriteFields,
  compareDrawingLogEntries,
  nextFreeChangeSlot,
  parseChangeLog,
  toDrawingLogEntry,
} from "@/lib/drawingLogMapper";
import { toSpDateOnly } from "@/lib/spDates";
import { MOCK_DRAWING_LOGS } from "@/data/drawingLogMockData";

// =============================================================================
// Drawing File Logs API — the four Engineering drawing registers behind one
// screen: CAD, CCC, CEC Drawings and Engineering Sketches.
//
// One parametrised module, not four: three of the lists are column-for-column
// identical and the fourth (Sketches) differs only in which columns exist, so
// four modules would be four places to fix every bug. The per-log variation
// lives in DRAWING_LOGS below.
//
// A log with no configured list id is simply UNAVAILABLE (`listId: undefined`):
// callers ask `availableDrawingLogs()` rather than assuming all four are live.
// All four are configured today, but the tolerance costs nothing and meant the
// screen shipped useful while CAD's id was still unknown.
// =============================================================================

interface DrawingLogSpec {
  kind: DrawingLogKind;
  /** Tab label. */
  label: string;
  /** One line explaining what the register holds. */
  blurb: string;
  listId: string | undefined;
  /** Whether the list carries the 16-slot CH_* change log. */
  hasChangeLog: boolean;
  /** Whether the list carries the Sketches-only columns. */
  hasSketchFields: boolean;
  /**
   * Columns to `$select`, or undefined to fetch ALL fields.
   *
   * Naming a column a list doesn't have is a Graph 400, so a narrow select is
   * only safe on a list whose columns we've actually captured.
   */
  select: string | undefined;
}

/** The CH_DAT/CH_ECN/CH_REV column names, all 48 of them. */
const CHANGE_COLUMNS = Array.from({ length: 16 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return `CH_DAT${n},CH_ECN${n},CH_REV${n}`;
}).join(",");

const DRAWING_CORE = "Title,PARTNO,DESCR,DATE_ST,DATE_REV,DWG_SIZE,REV_NO";

export const DRAWING_LOGS: Record<DrawingLogKind, DrawingLogSpec> = {
  cad: {
    kind: "cad",
    label: "CAD Drawings",
    blurb: "The main CAD drawing register.",
    listId: SP_CAD_DRAWINGS_LIST_ID,
    hasChangeLog: true,
    hasSketchFields: false,
    // No $select on purpose: CAD's columns haven't been captured, only its id.
    // CCC and CEC were almost certainly cloned from this list (their Title still
    // displays as "CAD_DWG"), so the same shape is expected — but expecting
    // isn't knowing, and a $select naming a missing column would 400 the whole
    // tab. Fetching all fields always works; the mapper picks out what it
    // recognises. Tighten this to a narrow select once the columns are confirmed.
    select: undefined,
  },
  ccc: {
    kind: "ccc",
    label: "CCC Drawings",
    blurb: "Cooper Compression Controls drawings.",
    listId: SP_CCC_DRAWINGS_LIST_ID,
    hasChangeLog: true,
    hasSketchFields: false,
    select: `${DRAWING_CORE},CCC_ID,${CHANGE_COLUMNS}`,
  },
  cec: {
    kind: "cec",
    label: "CEC Drawings",
    blurb: "Cooper Energy Controls drawings.",
    listId: SP_CEC_DRAWINGS_LIST_ID,
    hasChangeLog: true,
    hasSketchFields: false,
    select: `${DRAWING_CORE},CEC_ID,${CHANGE_COLUMNS}`,
  },
  sketches: {
    kind: "sketches",
    label: "Engineering Sketches",
    // Worth saying out loud in the UI: this register works differently.
    blurb: "Sketch register — no change log; sketches carry a sketch number instead.",
    listId: SP_ENGINEERING_SKETCHES_LIST_ID,
    hasChangeLog: false,
    hasSketchFields: true,
    select: "Title,DATE_ST,DATE_REV,DWG_SIZE,SK_ID,SK_Num,V_CODE,VENTURA",
  },
};

/** The logs that actually have a list configured — CAD drops out until it's known. */
export function availableDrawingLogs(): DrawingLogSpec[] {
  return Object.values(DRAWING_LOGS).filter((spec) => USE_MOCK || Boolean(spec.listId));
}

export function isDrawingLogAvailable(kind: DrawingLogKind): boolean {
  return USE_MOCK || Boolean(DRAWING_LOGS[kind].listId);
}

// -----------------------------------------------------------------------------
// Mock store — keyed by log so each tab behaves independently in the demo.
// -----------------------------------------------------------------------------

let mockStore: DrawingLogEntry[] = MOCK_DRAWING_LOGS.map((e) => ({
  ...e,
  changes: e.changes.map((c) => ({ ...c })),
}));

function delay<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
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

/**
 * The `$expand` clause for a log — a narrow field select where we've captured the
 * columns, or all fields where we haven't (see the CAD note above).
 */
function fieldsExpand(kind: DrawingLogKind): string {
  const select = DRAWING_LOGS[kind].select;
  return select ? `fields($select=${select})` : "fields";
}

/** Every row of one log, most recently revised first. */
export async function listDrawingLog(kind: DrawingLogKind): Promise<DrawingLogEntry[]> {
  if (USE_MOCK) {
    return delay(
      mockStore
        .filter((e) => e.kind === kind)
        .sort(compareDrawingLogEntries)
        .map((e) => ({ ...e, changes: e.changes.map((c) => ({ ...c })) })),
    );
  }

  // $top=999 is Graph's max page size; Sketches is 1,000+ rows so this is two
  // requests rather than five. graphFetchAll walks the rest.
  const items = await graphFetchAll<GraphListItem>(
    `${itemsPath(kind)}?$expand=${fieldsExpand(kind)}&$top=999`,
  );
  return items.map((item) => toDrawingLogEntry(item, kind)).sort(compareDrawingLogEntries);
}

/**
 * Core-field write payload. The change log is NOT written here — appending a
 * change goes through `appendDrawingChange`, which has to find a free slot.
 */
export function buildDrawingWriteFields(
  kind: DrawingLogKind,
  input: DrawingLogInput,
): Record<string, unknown> {
  const spec = DRAWING_LOGS[kind];
  const fields: Record<string, unknown> = {
    Title: input.title.trim(),
    DATE_ST: toSpDateOnly(input.dateStarted),
    DATE_REV: toSpDateOnly(input.dateRevised),
    DWG_SIZE: input.size.trim(),
  };
  // Sketches has no PARTNO/DESCR/REV_NO columns — writing them would 400.
  if (!spec.hasSketchFields) {
    fields.PARTNO = input.partNo.trim();
    fields.DESCR = input.description.trim();
    fields.REV_NO = input.revNo.trim();
  } else {
    fields.SK_Num = input.sketchNumber;
    fields.V_CODE = input.vCode;
    fields.VENTURA = input.ventura.trim();
  }
  return fields;
}

function applyInput(base: DrawingLogEntry, input: DrawingLogInput): DrawingLogEntry {
  const spec = DRAWING_LOGS[base.kind];
  return {
    ...base,
    title: input.title.trim(),
    partNo: spec.hasSketchFields ? "" : input.partNo.trim(),
    description: spec.hasSketchFields ? "" : input.description.trim(),
    dateStarted: input.dateStarted,
    dateRevised: input.dateRevised,
    size: input.size.trim(),
    revNo: spec.hasSketchFields ? "" : input.revNo.trim(),
    sketchNumber: spec.hasSketchFields ? input.sketchNumber : null,
    vCode: spec.hasSketchFields ? input.vCode : null,
    ventura: spec.hasSketchFields ? input.ventura.trim() : "",
    modifiedAt: new Date(),
  };
}

function emptyEntry(kind: DrawingLogKind, id: number): DrawingLogEntry {
  return {
    id,
    kind,
    title: "",
    partNo: "",
    description: "",
    dateStarted: null,
    dateRevised: null,
    size: "",
    revNo: "",
    changes: [],
    legacyId: null,
    sketchNumber: null,
    vCode: null,
    ventura: "",
    createdAt: new Date(),
    modifiedAt: new Date(),
  };
}

export async function createDrawingLogEntry(
  kind: DrawingLogKind,
  input: DrawingLogInput,
): Promise<DrawingLogEntry> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((e) => e.id)) + 1;
    const created = applyInput(emptyEntry(kind, nextId), input);
    mockStore = [...mockStore, created];
    return delay({ ...created });
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
    return delay({ ...next });
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
 * Throws when all 16 slots are used — the schema has no room for a 17th, and
 * silently dropping the change or overwriting slot 16 would both lose history.
 * The caller surfaces the message.
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
    const next: DrawingLogEntry = {
      ...existing,
      changes: [
        ...existing.changes,
        { slot, date: change.date, ecn: change.ecn.trim(), rev: change.rev.trim() },
      ].sort((a, b) => a.slot - b.slot),
      revNo: change.rev.trim() || existing.revNo,
      dateRevised: change.date ?? existing.dateRevised,
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  // Re-read the row first: the free slot depends on what's there NOW, and two
  // people recording a revision minutes apart would otherwise both target the
  // same slot and one would overwrite the other.
  const current = await graphFetch<GraphListItem>(
    `${itemsPath(kind)}/${id}?$expand=${fieldsExpand(kind)}`,
  );
  const slot = nextFreeChangeSlot(parseChangeLog(current.fields as Record<string, unknown>));
  if (slot === null) throw new Error(CHANGE_LOG_FULL);

  await graphFetch(`${itemsPath(kind)}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(buildChangeWriteFields(slot, change)),
  });

  const refreshed = await graphFetch<GraphListItem>(
    `${itemsPath(kind)}/${id}?$expand=${fieldsExpand(kind)}`,
  );
  return toDrawingLogEntry(refreshed, kind);
}

export const CHANGE_LOG_FULL =
  "This drawing's change log is full — all 16 slots on the SharePoint list are used. " +
  "Record the change in SharePoint, or ask IT to add more CH_ columns.";

export async function deleteDrawingLogEntry(
  kind: DrawingLogKind,
  id: number,
): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((e) => !(e.id === id && e.kind === kind));
    await delay(null);
    return;
  }
  await graphFetch(`${itemsPath(kind)}/${id}`, { method: "DELETE" });
}
