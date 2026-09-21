import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_MRB_LIST_ID, SP_PMO_SITE_URL, USE_MOCK } from "./config";
import { ensureLookupIds } from "./siteUsers";
import type { GraphListItem, MrbEntry, MrbEntryInput, Person } from "@/types/task";
import {
  buildMrbCreateFields,
  buildMrbFields,
  compareMrbEntries,
  toMrbEntry,
} from "@/lib/mrbMapper";
import {
  MRB_COMMUNICATIONS_COLUMN,
  MRB_WATCHERS_COLUMN,
  mrbSelect,
} from "@/lib/mrbFields";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { MOCK_MRB_ENTRIES } from "@/data/mrbMockData";

// =============================================================================
// MRB Data API — the Material Review Board register.
//
// A Supply Chain feature whose list lives on the **PMO site** (SITES.pmo),
// the same arrangement as Gray Market Requests.
//
// **The comment column is `Communications` — PLURAL.** Every other list in
// ARC calls it `Communication`. This one was added by hand on 2026-09-21 and
// named that way; `mrbFields.ts` carries the exact spelling.
//
// **There are no person columns other than Watchers**, and Watchers is a
// MULTI-value column, so none of the bare-lookupId / directory-join
// machinery the neighbouring modules need applies here.
//
// **The Watchers column may not exist yet.** It is created by
// `scripts/add-mrb-watchers-column.ps1`, which is run separately from any
// deploy — and selecting a column a list hasn't got 400s the WHOLE read. So
// the read asks for it, falls back to a slimmer `$select` on failure, and
// remembers the answer for the rest of the page session. The register works
// either side of that script running, with no ordering dependency.
//
// **There is no delete**, here or in the UI. An MRB entry is the record of
// material that was rejected and what was decided about it, and 2,863 of the
// rows are retained history from the Excel workbooks that predate the list.
// Correcting one is an edit. `mrb.test.ts` asserts this module exports
// nothing matching /delete|remove/.
//
// 2,960 rows, under SharePoint's 5,000-item threshold, so the list is fetched
// whole and filtered in the browser — which is what makes searching the
// Reason text for a failure mode possible at all.
// =============================================================================

let mockStore: MrbEntry[] = MOCK_MRB_ENTRIES.map((e) => ({ ...e }));

/**
 * Does the list have a Watchers column?
 *
 * `null` = not yet established. Set to `false` the first time a read asking
 * for it is refused, so a doomed request isn't repeated on every load — the
 * same shape as `serverFilterUnavailable` on the Teradyne log.
 */
let watchersColumnAvailable: boolean | null = null;

/** Whether watchers can be read or written at all. UI asks before offering it. */
export function mrbWatchersAvailable(): boolean {
  return USE_MOCK || watchersColumnAvailable !== false;
}

/** Test seam: mock mode mutates a module-level array, which leaks between tests. */
export function __resetMrbMockStore(): void {
  mockStore = MOCK_MRB_ENTRIES.map((e) => ({ ...e }));
  watchersColumnAvailable = null;
}

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_MRB_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_MRB_LIST_ID is not set.`);
  }
  return SP_MRB_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.pmo}/lists/${requireListId("reach the entry")}/items/${id}`;
}

/**
 * Run a read, retrying without the Watchers column if asking for it fails.
 *
 * The retry happens ONCE per page session: after a refusal
 * `watchersColumnAvailable` is false and every later read goes straight to
 * the slim select. A success leaves it true and nothing extra is paid.
 */
async function withWatchersFallback<T>(read: (select: string) => Promise<T>): Promise<T> {
  if (watchersColumnAvailable === false) return read(mrbSelect(false));
  try {
    const result = await read(mrbSelect(true));
    watchersColumnAvailable = true;
    return result;
  } catch (err) {
    // Only a missing column is worth retrying. A throttle, a 401 or a genuine
    // outage must propagate — swallowing those would turn "SharePoint is
    // down" into "nobody is watching anything", silently.
    if (watchersColumnAvailable !== null) throw err;
    const result = await read(mrbSelect(false));
    // Only conclude the column is missing once the slim read SUCCEEDS —
    // otherwise both calls failed for some unrelated reason and we would
    // wrongly disable watchers for the rest of the session.
    watchersColumnAvailable = false;
    return result;
  }
}

/** Every entry, newest MRB date first. Archive rows included — the view splits them. */
export async function listMrbEntries(): Promise<MrbEntry[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareMrbEntries).map((e) => ({ ...e })));
  }
  const listId = requireListId("load MRB entries");
  const items = await withWatchersFallback((select) =>
    graphFetchAll<GraphListItem>(
      `/sites/${SITES.pmo}/lists/${listId}/items` +
        `?$expand=fields($select=${select})&$top=999`,
    ),
  );
  return items.map(toMrbEntry).sort(compareMrbEntries);
}

export async function getMrbEntry(id: number): Promise<MrbEntry | null> {
  if (USE_MOCK) {
    const found = mockStore.find((e) => e.id === id);
    return delay(found ? { ...found } : null);
  }
  try {
    const item = await withWatchersFallback((select) =>
      graphFetch<GraphListItem>(`${itemPath(id)}?$expand=fields($select=${select})`),
    );
    return toMrbEntry(item);
  } catch {
    return null;
  }
}

export async function createMrbEntry(input: MrbEntryInput): Promise<MrbEntry> {
  if (USE_MOCK) {
    const now = new Date();
    const entry: MrbEntry = {
      id: Math.max(0, ...mockStore.map((e) => e.id)) + 1,
      sapNumber: input.sapNumber.trim(),
      mrbDate: input.mrbDate,
      oldPartNumber: input.oldPartNumber.trim(),
      quantity: input.quantity,
      description: input.description.trim(),
      reason: input.reason.trim(),
      whereCaused: input.whereCaused.trim(),
      disposition: input.disposition.trim(),
      vendorName: input.vendorName.trim(),
      pricePerUnit: input.pricePerUnit,
      pricePerIssue: input.pricePerIssue,
      notes: input.notes.trim(),
      comments: [],
      watchers: [],
      // ARC only ever creates live entries — the import owns "Legacy".
      dataFormat: "Current",
      sourceYear: input.mrbDate ? input.mrbDate.getUTCFullYear() : null,
      provenance: {},
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [entry, ...mockStore];
    return delay(entry);
  }

  const listId = requireListId("create the entry");
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.pmo}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields: buildMrbCreateFields(input) }) },
  );
  return (await getMrbEntry(parseInt(created.id, 10))) ?? toMrbEntry(created);
}

/**
 * Save an edit.
 *
 * `previous` is REQUIRED for the diff, and the diff is what keeps the 734
 * rows holding an undeclared choice value editable at all — see
 * `buildMrbFields`. Passing no previous sends every column, which on one of
 * those rows is a refused PATCH.
 */
export async function updateMrbEntry(
  id: number,
  input: MrbEntryInput,
  previous: MrbEntry,
): Promise<MrbEntry> {
  const fields = buildMrbFields(input, previous);

  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`MRB entry ${id} not found`);
    const next: MrbEntry = {
      ...mockStore[idx],
      sapNumber: input.sapNumber.trim(),
      mrbDate: input.mrbDate,
      oldPartNumber: input.oldPartNumber.trim(),
      quantity: input.quantity,
      description: input.description.trim(),
      reason: input.reason.trim(),
      whereCaused: input.whereCaused.trim(),
      disposition: input.disposition.trim(),
      vendorName: input.vendorName.trim(),
      pricePerUnit: input.pricePerUnit,
      pricePerIssue: input.pricePerIssue,
      notes: input.notes.trim(),
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  // Nothing actually changed — don't send an empty PATCH.
  if (Object.keys(fields).length === 0) {
    return (await getMrbEntry(id)) ?? previous;
  }

  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  const updated = await getMrbEntry(id);
  if (!updated) throw new Error(`MRB entry ${id} disappeared after update`);
  return updated;
}

/**
 * Patch raw columns. Used by the comment and watcher writes, which own one
 * column each and must NOT go through the diffing edit path above.
 */
async function patchMrbColumns(
  id: number,
  fields: Record<string, unknown>,
): Promise<MrbEntry> {
  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  const updated = await getMrbEntry(id);
  if (!updated) throw new Error(`MRB entry ${id} disappeared after update`);
  return updated;
}

/** Append a comment to the entry's Communications field. */
export async function addMrbComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<MrbEntry> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`MRB entry ${id} not found`);
    const next: MrbEntry = {
      ...mockStore[idx],
      comments: [
        {
          timestamp: new Date(),
          authorName: comment.authorName,
          authorEmail: comment.authorEmail,
          bodyHtml: comment.bodyHtml,
          attachments: [],
        },
        ...mockStore[idx].comments,
      ],
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  // Read-modify-write on one field, the same as every other comment thread —
  // the whole value is rewritten, so a comment posted between the read and
  // the write would be lost. Same window the other threads live with.
  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=${MRB_COMMUNICATIONS_COLUMN})`,
  );
  const existingRaw =
    (existing.fields[MRB_COMMUNICATIONS_COLUMN] as string | undefined) ?? "";
  return patchMrbColumns(id, {
    [MRB_COMMUNICATIONS_COLUMN]: appendComment(existingRaw, comment),
  });
}

/** Edit one existing comment, matched on its timestamp + author. */
export async function editMrbComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<MrbEntry> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`MRB entry ${id} not found`);
    const next: MrbEntry = {
      ...mockStore[idx],
      comments: mockStore[idx].comments.map((c) =>
        c.timestamp.getTime() === target.timestamp.getTime() &&
        (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
          ? { ...c, bodyHtml: newBodyHtml }
          : c,
      ),
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=${MRB_COMMUNICATIONS_COLUMN})`,
  );
  const existingRaw =
    (existing.fields[MRB_COMMUNICATIONS_COLUMN] as string | undefined) ?? "";
  return patchMrbColumns(id, {
    [MRB_COMMUNICATIONS_COLUMN]: replaceComment(existingRaw, target, newBodyHtml),
  });
}

/**
 * Replace the Watchers list.
 *
 * Refuses outright when the column doesn't exist rather than letting
 * SharePoint answer with something less legible — see
 * `scripts/add-mrb-watchers-column.ps1`.
 */
export async function setMrbWatchers(id: number, people: Person[]): Promise<MrbEntry> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`MRB entry ${id} not found`);
    const next: MrbEntry = { ...mockStore[idx], watchers: people, modifiedAt: new Date() };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  if (watchersColumnAvailable === false) {
    throw new Error(
      "Watchers aren't set up on the MRB list yet — run scripts/add-mrb-watchers-column.ps1.",
    );
  }

  // Re-resolved against the PMO site by ensureLookupIds: a lookupId is only
  // meaningful on the site it was resolved for, and the signed-in user's is
  // always an Engineering one. See "A lookupId is valid on ONE site".
  const ensured = await ensureLookupIds(SP_PMO_SITE_URL, people);
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.",
    );
  }
  return patchMrbColumns(id, multiPersonField(MRB_WATCHERS_COLUMN, ensured));
}
