import { SP_ALTRONIC_PART_LIST_ID, USE_MOCK } from "./config";
import type { AltronicPart, Person } from "@/types/task";
import { PART_DELETED_STATUS } from "@/types/task";
import { comparePartNumbers, toAltronicPart } from "@/lib/altronicPartMapper";
import { PART_FIELDS, columnsFromPatch } from "@/lib/partFields";
import { approvalRecordHtml, initialSignOff, nextSignOff, type SapResponse } from "@/lib/partsRoles";
import {
  DELETED_DESCRIPTION,
  blankColumns,
  deletionRecordHtml,
  isDeletedPart,
  partEvent,
  replacementColumns,
  reuseRecordHtml,
} from "@/lib/partLifecycle";
import { appendComment, parseCommunication } from "@/lib/communicationParser";
import { MOCK_ALTRONIC_PARTS } from "@/data/altronicPartsMockData";
import { archiveDatasheet } from "./datasheets";
import {
  COMMUNICATION_MISSING,
  PartDeleteRefusedError,
  PartNumberTakenError,
  StaleApprovalError,
  communicationAvailable,
  createItem,
  patchItem,
  readItem,
  readWholeList,
  rowsForTitle,
} from "./partsListShared";
import { mockDelay } from "./mockLatency";

// =============================================================================
// Altronic Part List API — every Altronic part number except the HCO
// components, on the Engineering site.
//
// ~14,000 rows, past SharePoint's 5,000-item threshold. An UNFILTERED,
// UNSORTED paged read works at any size (the Teradyne log reads 16,000 this
// way), so the list is fetched whole — about fifteen $top=999 pages — and
// searched in the browser. That is what makes a substring search on the
// description possible at all; SharePoint's own $filter can't do one.
//
// Title, LegacySource and SignOffStatus ARE indexed (the create script does
// it), which is what lets `partNumberTaken` ask SharePoint directly.
//
// Writes (Tim, 2026-09-28) — WHO may call them is decided in the hooks, by
// the gates in lib/partsRoles.ts; this module only talks to SharePoint:
//   - create: a new part starts at Pending SAP, re-checking the number
//     server-side first;
//   - update: a DIFFED patch, never the whole record;
//   - approve: re-reads the row, refuses if it has moved on, and writes the
//     new status and the history record in ONE PATCH.
//   - delete: BLANKS the row and marks it Deleted rather than removing it, so
//     the number can be handed out again; create REUSES that row when a new
//     part takes a deleted number (lib/partLifecycle.ts has the rules).
// =============================================================================

export const ALTRONIC_PART_SELECT =
  "Title,Description,DateAssigned,DrawingSize,DateDrawing,Manufacturer,MfgPartNumber,Notes," +
  "AssignedBy,PrototypeOrProduction,Purchased,SAPNumber,ItemValue,SignOffStatus,LegacySource,Attachments";

let mockStore: AltronicPart[] = MOCK_ALTRONIC_PARTS.map(clone);

/** Test hook: put the mock store back to its fixtures. */
export function __resetAltronicPartsMockStore() {
  mockStore = MOCK_ALTRONIC_PARTS.map(clone);
}

function clone(p: AltronicPart): AltronicPart {
  return { ...p, comments: [...p.comments] };
}

const byPartNumber = (a: AltronicPart, b: AltronicPart) =>
  comparePartNumbers(a.partNumber, b.partNumber) || a.id - b.id;

function listId(): string {
  return SP_ALTRONIC_PART_LIST_ID;
}

/** Every part on the Part List, in part-number order. */
export async function listAltronicParts(): Promise<AltronicPart[]> {
  if (USE_MOCK) return mockDelay(mockStore.map(clone).sort(byPartNumber));
  const items = await readWholeList(listId(), ALTRONIC_PART_SELECT);
  return items.map(toAltronicPart).sort(byPartNumber);
}

async function getPart(id: number): Promise<AltronicPart> {
  if (USE_MOCK) {
    const found = mockStore.find((p) => p.id === id);
    if (!found) throw new Error(`Part ${id} isn't on the Part List any more.`);
    return clone(found);
  }
  const item = await readItem(listId(), id, ALTRONIC_PART_SELECT);
  if (!item) throw new Error(`Part ${id} isn't on the Part List any more.`);
  return toAltronicPart(item);
}

/**
 * Who holds this number on the Part List, asked of SharePoint rather than the
 * cache: `taken` when a LIVE part has it, else the id of a DELETED row that
 * can be reused (the lowest, if the legacy data left two), else neither.
 */
async function numberState(partNumber: string): Promise<{ taken: boolean; deletedId: number | null }> {
  const wanted = partNumber.trim().toLowerCase();
  const rows = USE_MOCK
    ? mockStore.filter((p) => p.partNumber.toLowerCase() === wanted).map((p) => ({ id: p.id, signOffStatus: p.signOffStatus ?? "" }))
    : await rowsForTitle(listId(), partNumber);
  const deleted = rows.filter((r) => r.signOffStatus === PART_DELETED_STATUS).map((r) => r.id);
  return {
    taken: rows.some((r) => r.signOffStatus !== PART_DELETED_STATUS),
    deletedId: deleted.length > 0 ? Math.min(...deleted) : null,
  };
}

/** Is this number held by a LIVE part on the Part List? A deleted number isn't taken. */
export async function partNumberTaken(partNumber: string): Promise<boolean> {
  return (await numberState(partNumber)).taken;
}

export type NewAltronicPart = Partial<AltronicPart> & { partNumber: string };

export async function createAltronicPart(input: NewAltronicPart, actor: Person): Promise<AltronicPart> {
  const partNumber = input.partNumber.trim();
  // The cache the form checked against is up to ten minutes old, and two
  // people can pick the same "next number" — so ask the list itself.
  const state = await numberState(partNumber);
  if (state.taken) throw new PartNumberTakenError(partNumber);
  if (state.deletedId !== null) return reusePart(state.deletedId, { ...input, partNumber }, actor);
  const signOffStatus = initialSignOff(false);

  if (USE_MOCK) {
    const now = new Date();
    const created: AltronicPart = {
      ...MOCK_ALTRONIC_PARTS[0],
      dateAssigned: null,
      drawingSize: "",
      dateDrawing: null,
      manufacturer: "",
      mfgPartNumber: "",
      notes: "",
      assignedBy: "",
      prototypeOrProduction: null,
      purchased: null,
      sapNumber: "",
      itemValue: "",
      ...input,
      id: Math.max(0, ...mockStore.map((p) => p.id)) + 1,
      partNumber,
      signOffStatus,
      legacySource: "",
      comments: [],
      createdBy: { displayName: actor.displayName, email: actor.email ?? "" },
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore.push(created);
    return mockDelay(clone(created));
  }

  const fields = {
    ...columnsFromPatch(PART_FIELDS, input),
    Title: partNumber,
    SignOffStatus: signOffStatus,
  };
  const created = await createItem(listId(), fields);
  // Re-read for the item-level createdBy, which the POST's own echo may omit.
  return getPart(parseInt(created.id, 10));
}

const BLANK_PART: Omit<AltronicPart, "id" | "partNumber" | "comments" | "createdBy" | "createdAt" | "modifiedAt"> = {
  description: "",
  dateAssigned: null,
  drawingSize: "",
  dateDrawing: null,
  manufacturer: "",
  mfgPartNumber: "",
  notes: "",
  assignedBy: "",
  prototypeOrProduction: null,
  purchased: null,
  sapNumber: "",
  itemValue: "",
  signOffStatus: null,
  legacySource: "",
  hasAttachments: false,
};

/**
 * A new part taking a DELETED number: overwrite that same row — every field,
 * not a diff — and start its history afresh. Re-read first, so a row somebody
 * reused a moment ago is refused as taken rather than overwritten.
 */
async function reusePart(id: number, input: NewAltronicPart, actor: Person): Promise<AltronicPart> {
  const partNumber = input.partNumber;
  const signOffStatus = initialSignOff(false);
  const recordFor = (deleted: ReturnType<typeof partEvent>) => ({
    authorName: actor.displayName,
    authorEmail: actor.email ?? "",
    bodyHtml: reuseRecordHtml(deleted ? { by: deleted.authorName, at: deleted.timestamp } : null),
  });

  if (USE_MOCK) {
    const idx = mockStore.findIndex((p) => p.id === id);
    if (idx < 0 || !isDeletedPart(mockStore[idx])) throw new PartNumberTakenError(partNumber);
    const record = recordFor(partEvent(mockStore[idx].comments, "deleted"));
    const comments = parseCommunication(appendComment("", record));
    const now = new Date();
    mockStore[idx] = {
      ...BLANK_PART,
      ...input,
      id,
      partNumber,
      signOffStatus,
      legacySource: "",
      comments,
      createdBy: { displayName: actor.displayName, email: actor.email ?? "" },
      createdAt: comments[0]?.timestamp ?? now,
      modifiedAt: now,
    };
    return mockDelay(clone(mockStore[idx]));
  }

  const fresh = await readItem(listId(), id, ALTRONIC_PART_SELECT);
  const current = fresh ? toAltronicPart(fresh) : null;
  if (!current || !isDeletedPart(current) || current.partNumber.toLowerCase() !== partNumber.toLowerCase()) {
    throw new PartNumberTakenError(partNumber);
  }
  const fields: Record<string, unknown> = {
    ...replacementColumns(PART_FIELDS, input),
    Title: partNumber,
    SignOffStatus: signOffStatus,
    LegacySource: "",
  };
  // The reuse record is what names the new part's submitter; without the
  // column the part still saves, it just reads as the row's original creator.
  if (communicationAvailable(listId())) {
    fields.Communication = appendComment("", recordFor(partEvent(current.comments, "deleted")));
  }
  await patchItem(listId(), id, fields);
  return getPart(id);
}

/**
 * Delete a part number — the SAP admin's call (the gate is in the hook). The
 * row is NOT removed: every field is blanked, the description reads DELETED,
 * Sign-off becomes Deleted, and the history records who, when and why. The
 * number is then offered again by Next free. `expectedPartNumber` is the
 * number the SAP admin confirmed, refused if the row has changed since.
 */
export async function deleteAltronicPart(
  id: number,
  expectedPartNumber: string,
  reason: string,
  actor: Person,
): Promise<AltronicPart> {
  if (!reason.trim()) throw new PartDeleteRefusedError("Say why the part number is being deleted.");
  const record = { authorName: actor.displayName, authorEmail: actor.email ?? "", bodyHtml: deletionRecordHtml(reason) };

  if (USE_MOCK) {
    const idx = mockStore.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`Part ${id} isn't on the Part List any more.`);
    refuseDelete(mockStore[idx], expectedPartNumber);
    await archiveDatasheet(mockStore[idx].partNumber);
    const history = parseCommunication(appendComment("", record));
    mockStore[idx] = {
      ...mockStore[idx],
      ...BLANK_PART,
      description: DELETED_DESCRIPTION,
      signOffStatus: PART_DELETED_STATUS,
      legacySource: mockStore[idx].legacySource,
      comments: [...history, ...mockStore[idx].comments],
      modifiedAt: new Date(),
    };
    return mockDelay(clone(mockStore[idx]));
  }

  if (!communicationAvailable(listId())) throw new Error(COMMUNICATION_MISSING);
  const fresh = await readItem(listId(), id, ALTRONIC_PART_SELECT);
  if (!fresh) throw new Error(`Part ${id} isn't on the Part List any more.`);
  const current = toAltronicPart(fresh);
  refuseDelete(current, expectedPartNumber);
  // BEFORE the row: a reused number must never show the old part's PDF, so a
  // datasheet that can't be moved stops the delete.
  await archiveDatasheet(current.partNumber);
  const existingRaw = typeof fresh.fields.Communication === "string" ? fresh.fields.Communication : "";
  await patchItem(listId(), id, {
    ...blankColumns(PART_FIELDS),
    Description: DELETED_DESCRIPTION,
    SignOffStatus: PART_DELETED_STATUS,
    Communication: appendComment(existingRaw, record),
  });
  return getPart(id);
}

/** The reasons a delete is refused, shared by the mock and real paths. */
function refuseDelete(part: { partNumber: string; signOffStatus: string | null; hasAttachments: boolean }, expected: string) {
  if (isDeletedPart(part)) throw new PartDeleteRefusedError(`${part.partNumber} is already deleted.`);
  if (part.partNumber.trim().toLowerCase() !== expected.trim().toLowerCase()) {
    throw new PartDeleteRefusedError("This part has changed since you opened it. Refresh and try again.");
  }
  // Attachments on the list item aren't a column that can be blanked, and a
  // reused number would carry them — so they're removed by hand first.
  if (part.hasAttachments) {
    throw new PartDeleteRefusedError(
      `${part.partNumber} has files attached to its SharePoint item. Remove them in SharePoint first, so its next part doesn't inherit them.`,
    );
  }
}

/** Write ONLY the fields in `patch`, then hand back the row as it now stands. */
export async function updateAltronicPart(id: number, patch: Partial<AltronicPart>): Promise<AltronicPart> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`Part ${id} isn't on the Part List any more.`);
    mockStore[idx] = { ...mockStore[idx], ...patch, id, modifiedAt: new Date() };
    return mockDelay(clone(mockStore[idx]));
  }
  const fields = columnsFromPatch(PART_FIELDS, patch);
  if (Object.keys(fields).length > 0) await patchItem(listId(), id, fields);
  return getPart(id);
}

/**
 * Approve the step a part is waiting on. `expected` is the status the
 * approver SAW — if the row has moved since (somebody else approved it), the
 * write is refused rather than approving a step twice.
 */
export async function approveAltronicPart(
  id: number,
  expected: string,
  comment: string,
  actor: Person,
  response: SapResponse | null = null,
): Promise<AltronicPart> {
  const next = nextSignOff(expected);
  const record = {
    authorName: actor.displayName,
    authorEmail: actor.email ?? "",
    bodyHtml: approvalRecordHtml(expected, comment, response),
  };

  if (USE_MOCK) {
    const idx = mockStore.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`Part ${id} isn't on the Part List any more.`);
    if (mockStore[idx].signOffStatus !== expected || !next) {
      throw new StaleApprovalError(mockStore[idx].signOffStatus);
    }
    mockStore[idx] = {
      ...mockStore[idx],
      signOffStatus: next,
      comments: [...parseCommunication(appendComment("", record)), ...mockStore[idx].comments],
      modifiedAt: new Date(),
    };
    return mockDelay(clone(mockStore[idx]));
  }

  if (!communicationAvailable(listId())) throw new Error(COMMUNICATION_MISSING);
  // ONE fresh read: the status check and the history being appended to must
  // be the same version of the row.
  const fresh = await readItem(listId(), id, ALTRONIC_PART_SELECT);
  if (!fresh) throw new Error(`Part ${id} isn't on the Part List any more.`);
  const status = toAltronicPart(fresh).signOffStatus;
  if (status !== expected || !next) throw new StaleApprovalError(status);
  const existingRaw = typeof fresh.fields.Communication === "string" ? fresh.fields.Communication : "";
  // Status and history in ONE write, so they can never disagree.
  await patchItem(listId(), id, { SignOffStatus: next, Communication: appendComment(existingRaw, record) });
  return getPart(id);
}
