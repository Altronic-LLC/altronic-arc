import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANELTEAM_SITE_URL, SP_QC_TIME_TRACKING_LIST_ID, USE_MOCK } from "./config";
import { resolvePeopleLookupIds } from "./siteUsers";
import type { GraphListItem, QcTimeEntry, QcTimeEntryInput } from "@/types/task";
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
// **There is no delete**, same call as Visit Reports and the other
// record-of-what-happened lists in this app: an entry is a record that QC
// spent time on something, and a mistake is corrected with an edit, not a
// removal.
//
// `PerformedByPeople` is a multi-person column. A write resolves each person
// against the panel team site's user list (Graph-first, `ensureuser` as a
// fallback — see api/siteUsers.ts) before sending lookupIds; anyone who can't
// be resolved is simply left off rather than refusing the whole save, since
// this is a multi-value field and a partial match is still useful (unlike a
// single-person column, where a silent partial write reads as "cleared").
// =============================================================================

let mockStore: QcTimeEntry[] = MOCK_QC_TIME_ENTRIES.map((e) => ({ ...e }));

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
