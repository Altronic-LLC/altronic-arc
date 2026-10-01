import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANELTEAM_SITE_URL, SP_QC_TIME_TRACKING_LIST_ID, USE_MOCK } from "./config";
import { resolvePeopleLookupIds } from "./siteUsers";
import { QC_TIME_HOLD_REASONS, type GraphListItem, type QcTimeEntry, type QcTimeEntryInput } from "@/types/task";
import {
  QC_TIME_SELECT,
  buildQcTimeFields,
  compareQcTimeEntries,
  toQcTimeEntry,
} from "@/lib/qcTimeMapper";
import { MOCK_QC_TIME_ENTRIES } from "@/data/qcTimeMockData";

// =============================================================================
// QC Time Tracking — Panels, ALTRONICPANELTEAM site.
//
// A simple log of hours QC spent on a project: who did the work, when, and how
// long. No comments, no watchers, no role gating — any signed-in user can add
// or edit an entry, the same openness as Visit Reports and "Where am I?".
//
// **Delete is ADMIN-ONLY**, added 2026-09-16. This list used to have none, on
// the "a record of what happened is corrected, not removed" rule the other
// record lists follow — but two techs working one panel produce a genuine
// DUPLICATE entry, and there is nothing to correct in a row that shouldn't
// exist (Ray: "the second tech accidentally created a duplicate ARC entry.
// There's no way to remove the duplicate").
//
// Admin-only rather than open, matching the Teradyne Log: an edit leaves a
// corrected record and a delete leaves nothing, so an operator fixing their
// own typo shouldn't need an admin but removing a row should. It also matches
// what SharePoint permits — deleting an item needs more permission than
// editing one, so offering it to everyone would hand somebody a button that
// 403s (see `describeListWriteFailure`). The gate is re-checked inside the
// hook's `mutationFn`, not just in the view.
//
// `PerformedByPeople` is a multi-person column. A write resolves each person
// against the panel team site's user list (Graph-first, `ensureuser` as a
// fallback — see api/siteUsers.ts) before sending lookupIds; anyone who can't
// be resolved is simply left off rather than refusing the whole save, since
// this is a multi-value field and a partial match is still useful (unlike a
// single-person column, where a silent partial write reads as "cleared").
// =============================================================================

let mockStore: QcTimeEntry[] = MOCK_QC_TIME_ENTRIES.map((e) => ({ ...e }));

// The live "Hold Reason" column's choices, read straight off SharePoint's own
// column config rather than a hardcoded list -- so a reason someone adds in
// SharePoint shows up in the picker on the next load, with no code change or
// deploy (reported 2026-09-25: a newly-added reason "not showing in ARC").
// Cached for the session; a column's choice list changes rarely enough that
// re-reading it on every form open isn't worth the round trip.
let holdReasonChoices: string[] | null = null;

/** The live "Hold Reason" column's choices, in SharePoint's own configured order. */
export async function listQcTimeHoldReasonChoices(): Promise<string[]> {
  if (USE_MOCK) return [...QC_TIME_HOLD_REASONS];
  if (holdReasonChoices) return holdReasonChoices;
  const listId = requireListId("load the hold reason choices");
  try {
    const columns = await graphFetch<{ value: Array<{ name?: string; choice?: { choices?: string[] } }> }>(
      `/sites/${SITES.panelTeam}/lists/${listId}/columns?$select=name,choice`,
    );
    const match = (columns.value ?? []).find((c) => c.name === "HoldReason");
    holdReasonChoices = match?.choice?.choices ?? [...QC_TIME_HOLD_REASONS];
  } catch {
    // Column metadata can be refused even when items are readable -- fall
    // back to the last-known list rather than leaving the picker empty.
    holdReasonChoices = [...QC_TIME_HOLD_REASONS];
  }
  return holdReasonChoices;
}

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_QC_TIME_TRACKING_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_QC_TIME_TRACKING_LIST_ID is not set.`);
  }
  return SP_QC_TIME_TRACKING_LIST_ID;
}

/** Every QC time entry, newest week first. */
export async function listQcTimeEntries(): Promise<QcTimeEntry[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareQcTimeEntries).map((e) => ({ ...e })));
  }

  const listId = requireListId("load QC time entries");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.panelTeam}/lists/${listId}/items` +
      `?$expand=fields($select=${QC_TIME_SELECT})&$top=999`,
  );
  return items.map(toQcTimeEntry).sort(compareQcTimeEntries);
}

/** One entry by id, or null when it isn't there. */
export async function getQcTimeEntry(id: number): Promise<QcTimeEntry | null> {
  if (USE_MOCK) {
    const found = mockStore.find((e) => e.id === id);
    return delay(found ? { ...found } : null);
  }

  const listId = requireListId("load the QC time entry");
  try {
    const item = await graphFetch<GraphListItem>(
      `/sites/${SITES.panelTeam}/lists/${listId}/items/${id}` +
        `?$expand=fields($select=${QC_TIME_SELECT})`,
    );
    return toQcTimeEntry(item);
  } catch {
    return null;
  }
}

async function resolvePerformedBy(input: QcTimeEntryInput) {
  return resolvePeopleLookupIds(SITES.panelTeam, SP_PANELTEAM_SITE_URL, input.performedBy);
}

export async function createQcTimeEntry(input: QcTimeEntryInput): Promise<QcTimeEntry> {
  if (USE_MOCK) {
    const now = new Date();
    const entry: QcTimeEntry = {
      id: Math.max(0, ...mockStore.map((e) => e.id)) + 1,
      project: input.project.trim(),
      week: input.week,
      dateIntoQc: input.dateIntoQc,
      dateStarted: input.dateStarted,
      sapNo: input.sapNo.trim(),
      serialNo: input.serialNo.trim(),
      performedBy: input.performedBy,
      performedByRaw: input.performedBy.map((p) => p.displayName).join(", "),
      hoursRaw: input.hoursRaw.trim(),
      effortType: input.effortType,
      notes: input.notes.trim(),
      onHold: input.onHold,
      holdReason: input.onHold ? input.holdReason.trim() : "",
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [entry, ...mockStore];
    return delay(entry);
  }

  const listId = requireListId("add the QC time entry");
  const resolved = await resolvePerformedBy(input);
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.panelTeam}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields: buildQcTimeFields(input, resolved) }) },
  );
  // The create response doesn't expand the fields we selected, so read the
  // row back — the list view renders from the returned object.
  return (await getQcTimeEntry(parseInt(created.id, 10))) ?? toQcTimeEntry(created);
}

/**
 * Save the edit form — every field the form holds, since (unlike Visit
 * Reports' choice columns) nothing here has drifted outside a fixed choice
 * list that a full resend would get rejected by.
 */
export async function updateQcTimeEntry(
  id: number,
  input: QcTimeEntryInput,
): Promise<QcTimeEntry> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`QC time entry ${id} not found`);
    const next: QcTimeEntry = {
      ...mockStore[idx],
      project: input.project.trim(),
      week: input.week,
      dateIntoQc: input.dateIntoQc,
      dateStarted: input.dateStarted,
      sapNo: input.sapNo.trim(),
      serialNo: input.serialNo.trim(),
      performedBy: input.performedBy,
      hoursRaw: input.hoursRaw.trim(),
      effortType: input.effortType,
      notes: input.notes.trim(),
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay(next);
  }

  const listId = requireListId("save the QC time entry");
  const resolved = await resolvePerformedBy(input);
  await graphFetch(`/sites/${SITES.panelTeam}/lists/${listId}/items/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(buildQcTimeFields(input, resolved)),
  });
  const updated = await getQcTimeEntry(id);
  if (!updated) throw new Error(`QC time entry ${id} disappeared after update`);
  return updated;
}

/**
 * Delete an entry. **ADMIN-ONLY** — the gate lives in
 * `useDeleteQcTimeEntry`'s `mutationFn`, so a future screen or bulk action
 * can't reach this without it.
 *
 * For a duplicate: two techs on one panel, one of them logging it twice.
 * Everything else is corrected with an edit.
 */
export async function deleteQcTimeEntry(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((e) => e.id !== id);
    await delay(undefined);
    return;
  }
  const listId = requireListId("delete the QC time entry");
  await graphFetch(`/sites/${SITES.panelTeam}/lists/${listId}/items/${id}`, {
    method: "DELETE",
  });
}

/** Test seam — restores the mock store to the shipped fixtures. */
export function __resetQcTimeMockStore(): void {
  mockStore = MOCK_QC_TIME_ENTRIES.map((e) => ({ ...e }));
}
