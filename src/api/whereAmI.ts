import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_WHERE_AM_I_LIST_ID, USE_MOCK } from "./config";
import type { GraphListItem, WhereAmIEntry } from "@/types/task";
import {
  buildWhereAmIFields,
  compareByDate,
  toWhereAmIEntry,
  WHERE_AM_I_SELECT,
} from "@/lib/whereAmI";
import { MOCK_WHERE_AM_I } from "@/data/whereAmIMockData";

// =============================================================================
// "Where am I?" API — Engineering's out-of-office calendar.
//
// Two columns and full control for anyone signed in (Ray, 2026-08-19): plans
// change, so unlike the record-style lists this one HAS a delete. The real
// boundary is SharePoint's own list permissions, as always.
//
// Volume: ~1,000 rows since late 2023 and growing by a few a week. The payload
// is two small columns, so the list is fetched whole (paged) and both views
// filter it in the browser — a month grid and a "what's coming" agenda want
// different slices of the same data, and neither is worth a round trip.
// =============================================================================

let mockStore: WhereAmIEntry[] = MOCK_WHERE_AM_I.map((e) => ({ ...e }));

function delay<T>(value: T, ms = 180): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_WHERE_AM_I_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_WHERE_AM_I_LIST_ID is not set.`);
  }
  return SP_WHERE_AM_I_LIST_ID;
}

/** Every entry, soonest first. */
export async function listWhereAmI(): Promise<WhereAmIEntry[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareByDate).map((e) => ({ ...e })));
  }
  const listId = requireListId("load the calendar");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items` +
      `?$expand=fields($select=${WHERE_AM_I_SELECT})&$top=999`,
  );
  return items.map(toWhereAmIEntry).sort(compareByDate);
}

export async function createWhereAmI(input: {
  title: string;
  date: Date | null;
}): Promise<WhereAmIEntry> {
  if (USE_MOCK) {
    const now = new Date();
    const entry: WhereAmIEntry = {
      id: Math.max(0, ...mockStore.map((e) => e.id)) + 1,
      title: input.title.trim(),
      date: input.date,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [...mockStore, entry];
    return delay(entry);
  }

  const listId = requireListId("add to the calendar");
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields: buildWhereAmIFields(input) }) },
  );
  // The POST response doesn't carry the expanded fields we selected, so build
  // the entry from what we sent rather than firing a second read for two
  // columns we already know.
  return {
    id: parseInt(created.id, 10),
    title: input.title.trim(),
    date: input.date,
    createdAt: new Date(),
    modifiedAt: new Date(),
  };
}

export async function updateWhereAmI(
  id: number,
  input: { title: string; date: Date | null },
): Promise<WhereAmIEntry> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`Calendar entry ${id} not found`);
    const next: WhereAmIEntry = {
      ...mockStore[idx],
      title: input.title.trim(),
      date: input.date,
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay(next);
  }

  const listId = requireListId("save the entry");
  await graphFetch(
    `/sites/${SITES.engineering}/lists/${listId}/items/${id}/fields`,
    { method: "PATCH", body: JSON.stringify(buildWhereAmIFields(input)) },
  );
  return {
    id,
    title: input.title.trim(),
    date: input.date,
    createdAt: new Date(),
    modifiedAt: new Date(),
  };
}

/**
 * Remove an entry.
 *
 * This list HAS a delete, unlike Visit Reports and Gray Market Requests: those
 * record something that happened, while this records an intention, and
 * intentions get cancelled. A trip that's off should leave the calendar.
 */
export async function deleteWhereAmI(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((e) => e.id !== id);
    await delay(null);
    return;
  }
  const listId = requireListId("remove the entry");
  await graphFetch(`/sites/${SITES.engineering}/lists/${listId}/items/${id}`, {
    method: "DELETE",
  });
}
