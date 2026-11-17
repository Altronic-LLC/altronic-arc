import { GraphError, graphFetch, graphFetchAll } from "./graph";
import { HR_SITE_ID, SP_NEW_HIRES_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem, Person } from "@/types/task";
import type { NewHire, NewHireInput, NewHirePatch, NewHireStep } from "@/types/hr";
import { displayNameFor, inputOf, newHireStatus } from "@/lib/newHire";
import {
  NEW_HIRE_COLUMNS,
  NEW_HIRE_SELECT,
  newHireInputFields,
  personToLine,
  stepFields,
  toNewHire,
} from "@/lib/newHireMapper";
import { mockNewHires } from "@/data/hrMockData";

// =============================================================================
// New Hires — HR's form that kicks off SAP and the IT ticket for somebody
// starting. On the HR site (not created yet — see the HR block in config.ts),
// so real mode reads nothing until it exists; the demo runs on hrMockData.ts.
//
// Every write returns the row as it now stands. A step or a cancellation is
// written after a FRESH read, so two people a minute apart can't stamp the same
// step twice or overwrite each other's ticks. **No delete** — a new hire who
// doesn't start is Cancelled with a reason, which keeps the record of who was
// told what.
// =============================================================================

let mockStore: NewHire[] = mockNewHires();

/** For tests: put the mock store back. */
export function __resetNewHireMockStore(): void {
  mockStore = mockNewHires();
}

function itemsPath(): string {
  if (!HR_SITE_ID || !SP_NEW_HIRES_LIST_ID) {
    throw new Error("New Hires isn't set up yet: VITE_SP_HR_SITE_ID / VITE_SP_NEW_HIRES_LIST_ID is not set.");
  }
  return `/sites/${HR_SITE_ID}/lists/${SP_NEW_HIRES_LIST_ID}/items`;
}

const EXPAND = `$expand=fields($select=${NEW_HIRE_SELECT})`;

function clone(h: NewHire): NewHire {
  return { ...h, steps: { ...h.steps }, manager: h.manager ? { ...h.manager } : null };
}

/** Every new hire. Unset list = none. */
export async function listNewHires(): Promise<NewHire[]> {
  if (USE_MOCK) return mockDelay(mockStore.map(clone));
  if (!HR_SITE_ID || !SP_NEW_HIRES_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(`${itemsPath()}?${EXPAND}&$top=999`);
  return items.map(toNewHire);
}

/** One new hire, read fresh. Only a 404 is "not found"; anything else propagates. */
export async function getNewHire(id: number): Promise<NewHire | null> {
  if (USE_MOCK) {
    const found = mockStore.find((h) => h.id === id);
    return mockDelay(found ? clone(found) : null);
  }
  try {
    return toNewHire(await graphFetch<GraphListItem>(`${itemsPath()}/${id}?${EXPAND}`));
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return null;
    throw err;
  }
}

async function requireHire(id: number): Promise<NewHire> {
  const hire = await getNewHire(id);
  if (!hire) throw new Error("That new hire no longer exists.");
  return hire;
}

export async function createNewHire(input: NewHireInput, actor: Person): Promise<NewHire> {
  if (USE_MOCK) {
    const now = new Date();
    const created: NewHire = {
      ...input,
      id: Math.max(0, ...mockStore.map((h) => h.id)) + 1,
      displayName: displayNameFor(input),
      steps: { addedToSap: null, itTicketRaised: null, itAccountCreated: null, computerSetUp: null },
      cancelled: null,
      status: "Submitted",
      submittedBy: actor,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [...mockStore, created];
    return mockDelay(clone(created));
  }
  const fields = {
    ...newHireInputFields(input, input),
    [NEW_HIRE_COLUMNS.displayName]: displayNameFor(input),
    [NEW_HIRE_COLUMNS.status]: "Submitted",
  };
  const created = await graphFetch<GraphListItem>(itemsPath(), { method: "POST", body: JSON.stringify({ fields }) });
  return toNewHire(created);
}

/**
 * Write the fields given — and the derived Status, which a change to
 * "computer needed" can move. Returns the row re-read.
 */
export async function updateNewHire(id: number, patch: NewHirePatch, previous: NewHire): Promise<NewHire> {
  const mergedInput = { ...inputOf(previous), ...patch };
  const merged = { ...previous, ...patch };
  const status = newHireStatus(merged);
  if (USE_MOCK) {
    const next: NewHire = { ...merged, displayName: displayNameFor(mergedInput), status, modifiedAt: new Date() };
    mockStore = mockStore.map((h) => (h.id === id ? next : h));
    return mockDelay(clone(next));
  }
  const fields = { ...newHireInputFields(patch, mergedInput), [NEW_HIRE_COLUMNS.status]: status };
  await graphFetch(`${itemsPath()}/${id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  return requireHire(id);
}

/**
 * Tick or untick a kick-off step, after a FRESH read. Ticking a step that is
 * already ticked keeps the original stamp — whoever did it first did it.
 */
export async function setNewHireStep(id: number, step: NewHireStep, done: boolean, actor: Person): Promise<NewHire> {
  const fresh = await requireHire(id);
  if (fresh.cancelled) throw new Error("This new hire was cancelled. Reopen it before ticking steps.");
  if ((fresh.steps[step] !== null) === done) return fresh;
  const value = done ? { at: new Date(), by: actor } : null;
  const steps = { ...fresh.steps, [step]: value };
  const status = newHireStatus({ ...fresh, steps });
  if (USE_MOCK) {
    const next: NewHire = { ...fresh, steps, status, modifiedAt: new Date() };
    mockStore = mockStore.map((h) => (h.id === id ? next : h));
    return mockDelay(clone(next));
  }
  await graphFetch(`${itemsPath()}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ ...stepFields(step, value), [NEW_HIRE_COLUMNS.status]: status }),
  });
  return requireHire(id);
}

/** Cancel (with a reason) or reopen (`reason === null`), after a fresh read. */
export async function setNewHireCancelled(id: number, reason: string | null, actor: Person): Promise<NewHire> {
  const fresh = await requireHire(id);
  if (reason !== null && !reason.trim()) throw new Error("Say why the new hire is cancelled.");
  const cancelled = reason === null ? null : { at: new Date(), by: actor, reason: reason.trim() };
  const status = newHireStatus({ ...fresh, cancelled });
  if (USE_MOCK) {
    const next: NewHire = { ...fresh, cancelled, status, modifiedAt: new Date() };
    mockStore = mockStore.map((h) => (h.id === id ? next : h));
    return mockDelay(clone(next));
  }
  const c = NEW_HIRE_COLUMNS;
  await graphFetch(`${itemsPath()}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({
      [c.cancelledAt]: cancelled ? cancelled.at.toISOString() : null,
      [c.cancelledBy]: cancelled ? personToLine(actor) : "",
      [c.cancelReason]: cancelled ? cancelled.reason : "",
      [c.status]: status,
    }),
  });
  return requireHire(id);
}
