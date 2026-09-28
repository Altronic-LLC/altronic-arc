import { SP_ALTRONIC_COMPONENT_LIST_ID, USE_MOCK } from "./config";
import type { AltronicComponent, Person } from "@/types/task";
import { PART_DELETED_STATUS } from "@/types/task";
import {
  COMPONENT_PREFIX_CATEGORY,
  comparePartNumbers,
  partPrefix,
  toAltronicComponent,
} from "@/lib/altronicPartMapper";
import { COMPONENT_FIELDS, columnsFromPatch } from "@/lib/partFields";
import { approvalRecordHtml, initialSignOff, nextSignOff } from "@/lib/partsRoles";
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
import { MOCK_ALTRONIC_COMPONENTS } from "@/data/altronicPartsMockData";
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

// =============================================================================
// Altronic Component List API — the HOC electronic components (601/611 Through
// Hole, 701/711/712 Surface Mount, 722 SIL), on the Engineering site.
//
// ~3,900 rows: under the threshold, fetched whole and searched in the browser,
// the same as the Part List for the same reason. Writes follow the Part List's
// rules (see altronicParts.ts) with two differences:
//   - a new component starts at Pending ENGINEERING REVIEW — a three-step
//     approval where the Part List has two;
//   - Category is never typed: it is decided by the part number's prefix and
//     written by this module, so it can't disagree with the list it's on.
// Delete and reuse are the Part List's too (lib/partLifecycle.ts): Category
// survives a delete, since the number still belongs to the same list.
// =============================================================================

export const ALTRONIC_COMPONENT_SELECT =
  "Title,Category,Description,MfgName,MfgNumber,RatingA,RatingB,RatingC,TempMin,TempMax," +
  "Tolerance,Footprint,Notes,HasDataSheet,SignOffStatus,LegacySource,Attachments";

let mockStore: AltronicComponent[] = MOCK_ALTRONIC_COMPONENTS.map(clone);

/** Test hook: put the mock store back to its fixtures. */
export function __resetAltronicComponentsMockStore() {
  mockStore = MOCK_ALTRONIC_COMPONENTS.map(clone);
}

function clone(c: AltronicComponent): AltronicComponent {
  return { ...c, comments: [...c.comments] };
}

function delay<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const byPartNumber = (a: AltronicComponent, b: AltronicComponent) =>
  comparePartNumbers(a.partNumber, b.partNumber) || a.id - b.id;

function listId(): string {
  return SP_ALTRONIC_COMPONENT_LIST_ID;
}

/** Every component, in part-number order. */
export async function listAltronicComponents(): Promise<AltronicComponent[]> {
  if (USE_MOCK) return delay(mockStore.map(clone).sort(byPartNumber));
  const items = await readWholeList(listId(), ALTRONIC_COMPONENT_SELECT);
  return items.map(toAltronicComponent).sort(byPartNumber);
}

async function getComponent(id: number): Promise<AltronicComponent> {
  if (USE_MOCK) {
    const found = mockStore.find((c) => c.id === id);
    if (!found) throw new Error(`Component ${id} isn't on the Component List any more.`);
    return clone(found);
  }
  const item = await readItem(listId(), id, ALTRONIC_COMPONENT_SELECT);
  if (!item) throw new Error(`Component ${id} isn't on the Component List any more.`);
  return toAltronicComponent(item);
}

/** Live holder of the number → taken; else a deleted row to reuse — see altronicParts.ts. */
async function numberState(partNumber: string): Promise<{ taken: boolean; deletedId: number | null }> {
  const wanted = partNumber.trim().toLowerCase();
  const rows = USE_MOCK
    ? mockStore.filter((c) => c.partNumber.toLowerCase() === wanted).map((c) => ({ id: c.id, signOffStatus: c.signOffStatus ?? "" }))
    : await rowsForTitle(listId(), partNumber);
  const deleted = rows.filter((r) => r.signOffStatus === PART_DELETED_STATUS).map((r) => r.id);
  return {
    taken: rows.some((r) => r.signOffStatus !== PART_DELETED_STATUS),
    deletedId: deleted.length > 0 ? Math.min(...deleted) : null,
  };
}

/** Is this number held by a LIVE component? A deleted number isn't taken. Asked of SharePoint. */
export async function componentNumberTaken(partNumber: string): Promise<boolean> {
  return (await numberState(partNumber)).taken;
}

export type NewAltronicComponent = Partial<AltronicComponent> & { partNumber: string };

/** The category a component number belongs to, or throws — it isn't an HOC number. */
export function categoryForNumber(partNumber: string): string {
  const category = COMPONENT_PREFIX_CATEGORY[partPrefix(partNumber) ?? ""];
  if (!category) throw new Error(`${partNumber} isn't an HOC component number (601/611/701/711/712/722).`);
  return category;
}

export async function createAltronicComponent(
  input: NewAltronicComponent,
  actor: Person,
): Promise<AltronicComponent> {
  const partNumber = input.partNumber.trim();
  const category = categoryForNumber(partNumber);
  const state = await numberState(partNumber);
  if (state.taken) throw new PartNumberTakenError(partNumber);
  if (state.deletedId !== null) return reuseComponent(state.deletedId, { ...input, partNumber }, category, actor);
  const signOffStatus = initialSignOff(true);

  if (USE_MOCK) {
    const now = new Date();
    const created: AltronicComponent = {
      mfgName: "",
      mfgNumber: "",
      ratingA: "",
      ratingB: "",
      ratingC: "",
      tempMin: "",
      tempMax: "",
      tolerance: "",
      footprint: "",
      notes: "",
      hasDataSheet: false,
      description: "",
      ...input,
      id: Math.max(0, ...mockStore.map((c) => c.id)) + 1,
      partNumber,
      category,
      signOffStatus,
      legacySource: "",
      comments: [],
      createdBy: { displayName: actor.displayName, email: actor.email ?? "" },
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore.push(created);
    return delay(clone(created));
  }

  const fields = {
    ...columnsFromPatch(COMPONENT_FIELDS, input),
    Title: partNumber,
    Category: category,
    SignOffStatus: signOffStatus,
  };
  const created = await createItem(listId(), fields);
  return getComponent(parseInt(created.id, 10));
}

const BLANK_COMPONENT: Omit<
  AltronicComponent,
  "id" | "partNumber" | "category" | "comments" | "createdBy" | "createdAt" | "modifiedAt"
> = {
  description: "",
  mfgName: "",
  mfgNumber: "",
  ratingA: "",
  ratingB: "",
  ratingC: "",
  tempMin: "",
  tempMax: "",
  tolerance: "",
  footprint: "",
  notes: "",
  hasDataSheet: false,
  signOffStatus: null,
  legacySource: "",
  hasAttachments: false,
};

/** A new component taking a DELETED number — see reusePart in altronicParts.ts. */
async function reuseComponent(
  id: number,
  input: NewAltronicComponent,
  category: string,
  actor: Person,
): Promise<AltronicComponent> {
  const partNumber = input.partNumber;
  const signOffStatus = initialSignOff(true);
  const recordFor = (deleted: ReturnType<typeof partEvent>) => ({
    authorName: actor.displayName,
    authorEmail: actor.email ?? "",
    bodyHtml: reuseRecordHtml(deleted ? { by: deleted.authorName, at: deleted.timestamp } : null),
  });

  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0 || !isDeletedPart(mockStore[idx])) throw new PartNumberTakenError(partNumber);
    const comments = parseCommunication(appendComment("", recordFor(partEvent(mockStore[idx].comments, "deleted"))));
    const now = new Date();
    mockStore[idx] = {
      ...BLANK_COMPONENT,
      ...input,
      id,
      partNumber,
      category,
      signOffStatus,
      legacySource: "",
      comments,
      createdBy: { displayName: actor.displayName, email: actor.email ?? "" },
      createdAt: comments[0]?.timestamp ?? now,
      modifiedAt: now,
    };
    return delay(clone(mockStore[idx]));
  }

  const fresh = await readItem(listId(), id, ALTRONIC_COMPONENT_SELECT);
  const current = fresh ? toAltronicComponent(fresh) : null;
  if (!current || !isDeletedPart(current) || current.partNumber.toLowerCase() !== partNumber.toLowerCase()) {
    throw new PartNumberTakenError(partNumber);
  }
  const fields: Record<string, unknown> = {
    ...replacementColumns(COMPONENT_FIELDS, input),
    Title: partNumber,
    Category: category,
    SignOffStatus: signOffStatus,
    LegacySource: "",
  };
  if (communicationAvailable(listId())) {
    fields.Communication = appendComment("", recordFor(partEvent(current.comments, "deleted")));
  }
  await patchItem(listId(), id, fields);
  return getComponent(id);
}

/** Delete a component's part number — see deleteAltronicPart in altronicParts.ts. */
export async function deleteAltronicComponent(
  id: number,
  expectedPartNumber: string,
  reason: string,
  actor: Person,
): Promise<AltronicComponent> {
  if (!reason.trim()) throw new PartDeleteRefusedError("Say why the part number is being deleted.");
  const record = { authorName: actor.displayName, authorEmail: actor.email ?? "", bodyHtml: deletionRecordHtml(reason) };

  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Component ${id} isn't on the Component List any more.`);
    refuseDelete(mockStore[idx], expectedPartNumber);
    await archiveDatasheet(mockStore[idx].partNumber);
    const history = parseCommunication(appendComment("", record));
    mockStore[idx] = {
      ...mockStore[idx],
      ...BLANK_COMPONENT,
      description: DELETED_DESCRIPTION,
      signOffStatus: PART_DELETED_STATUS,
      legacySource: mockStore[idx].legacySource,
      comments: [...history, ...mockStore[idx].comments],
      modifiedAt: new Date(),
    };
    return delay(clone(mockStore[idx]));
  }

  if (!communicationAvailable(listId())) throw new Error(COMMUNICATION_MISSING);
  const fresh = await readItem(listId(), id, ALTRONIC_COMPONENT_SELECT);
  if (!fresh) throw new Error(`Component ${id} isn't on the Component List any more.`);
  const current = toAltronicComponent(fresh);
  refuseDelete(current, expectedPartNumber);
  await archiveDatasheet(current.partNumber);
  const existingRaw = typeof fresh.fields.Communication === "string" ? fresh.fields.Communication : "";
  await patchItem(listId(), id, {
    ...blankColumns(COMPONENT_FIELDS),
    Description: DELETED_DESCRIPTION,
    SignOffStatus: PART_DELETED_STATUS,
    Communication: appendComment(existingRaw, record),
  });
  return getComponent(id);
}

function refuseDelete(c: { partNumber: string; signOffStatus: string | null; hasAttachments: boolean }, expected: string) {
  if (isDeletedPart(c)) throw new PartDeleteRefusedError(`${c.partNumber} is already deleted.`);
  if (c.partNumber.trim().toLowerCase() !== expected.trim().toLowerCase()) {
    throw new PartDeleteRefusedError("This component has changed since you opened it. Refresh and try again.");
  }
  if (c.hasAttachments) {
    throw new PartDeleteRefusedError(
      `${c.partNumber} has files attached to its SharePoint item. Remove them in SharePoint first, so its next part doesn't inherit them.`,
    );
  }
}

/** Write ONLY the fields in `patch`, then hand back the row as it now stands. */
export async function updateAltronicComponent(
  id: number,
  patch: Partial<AltronicComponent>,
): Promise<AltronicComponent> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Component ${id} isn't on the Component List any more.`);
    mockStore[idx] = { ...mockStore[idx], ...patch, id, modifiedAt: new Date() };
    return delay(clone(mockStore[idx]));
  }
  const fields = columnsFromPatch(COMPONENT_FIELDS, patch);
  if (Object.keys(fields).length > 0) await patchItem(listId(), id, fields);
  return getComponent(id);
}

/** Approve the step a component is waiting on — see approveAltronicPart. */
export async function approveAltronicComponent(
  id: number,
  expected: string,
  comment: string,
  actor: Person,
): Promise<AltronicComponent> {
  const next = nextSignOff(expected);
  const record = {
    authorName: actor.displayName,
    authorEmail: actor.email ?? "",
    bodyHtml: approvalRecordHtml(expected, comment),
  };

  if (USE_MOCK) {
    const idx = mockStore.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Component ${id} isn't on the Component List any more.`);
    if (mockStore[idx].signOffStatus !== expected || !next) {
      throw new StaleApprovalError(mockStore[idx].signOffStatus);
    }
    mockStore[idx] = {
      ...mockStore[idx],
      signOffStatus: next,
      comments: [...parseCommunication(appendComment("", record)), ...mockStore[idx].comments],
      modifiedAt: new Date(),
    };
    return delay(clone(mockStore[idx]));
  }

  if (!communicationAvailable(listId())) throw new Error(COMMUNICATION_MISSING);
  const fresh = await readItem(listId(), id, ALTRONIC_COMPONENT_SELECT);
  if (!fresh) throw new Error(`Component ${id} isn't on the Component List any more.`);
  const status = toAltronicComponent(fresh).signOffStatus;
  if (status !== expected || !next) throw new StaleApprovalError(status);
  const existingRaw = typeof fresh.fields.Communication === "string" ? fresh.fields.Communication : "";
  await patchItem(listId(), id, { SignOffStatus: next, Communication: appendComment(existingRaw, record) });
  return getComponent(id);
}
