import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_FAIT_LIST_ID, SP_SITE_URL, USE_MOCK } from "./config";
import { ensureLookupIds, ensurePersonLookupId } from "./siteUsers";
import type { Fait, FaitInput, GraphListItem, Person } from "@/types/task";
import { buildFaitCreateFields, compareFaits, toFait } from "@/lib/faitMapper";
import { FAIT_FIELDS, FAIT_SELECT } from "@/lib/faitFields";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { autoWatchers } from "@/lib/people";
import { MOCK_FAITS } from "@/data/faitMockData";

// =============================================================================
// FAITs — First Article Inspection Tests.
//
// A **Supply Chain** feature whose list lives on the **Engineering** site
// (SITES.engineering), not PMO. 36 rows and growing slowly, so the list is
// fetched whole and filtered in the browser.
//
// **There is no delete.** A FAIT records an inspection that happened; a
// superseded one is closed, not removed. `faits.test.ts` asserts this module
// exports nothing matching /delete|remove/.
// =============================================================================

let mockStore: Fait[] = MOCK_FAITS.map((f) => ({ ...f }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_FAIT_LIST_ID) throw new Error(`Cannot ${action}: VITE_SP_FAIT_LIST_ID is not set.`);
  return SP_FAIT_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.engineering}/lists/${requireListId("reach the FAIT")}/items/${id}`;
}

/** Every FAIT, newest first. */
export async function listFaits(): Promise<Fait[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareFaits).map((f) => ({ ...f })));
  }
  const listId = requireListId("load FAITs");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items` +
      `?$expand=fields($select=${FAIT_SELECT})&$top=999`,
  );
  return items.map(toFait).sort(compareFaits);
}

export async function getFait(id: number): Promise<Fait | null> {
  if (USE_MOCK) {
    const found = mockStore.find((f) => f.id === id);
    return delay(found ? { ...found } : null);
  }
  try {
    const item = await graphFetch<GraphListItem>(
      `${itemPath(id)}?$expand=fields($select=${FAIT_SELECT})`,
    );
    return toFait(item);
  } catch {
    return null;
  }
}

export async function createFait(
  input: FaitInput,
  initiator?: Person | null,
): Promise<Fait> {
  if (USE_MOCK) {
    const now = new Date();
    const fait: Fait = {
      id: Math.max(0, ...mockStore.map((f) => f.id)) + 1,
      title: input.title.trim(),
      status: input.status,
      parentProject: input.projectLookupId
        ? { lookupId: input.projectLookupId, title: "" }
        : null,
      eirLookupId: null,
      testDocumentLookupId: null,
      initiator: initiator ?? null,
      assignedEngineer: null,
      kam: null,
      // Whoever raises it watches it — the house rule everywhere in ARC.
      watchers: initiator ? [initiator] : [],
      comments: [],
      hasAttachments: false,
      values: { ...input.values },
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [fait, ...mockStore];
    return delay(fait);
  }

  const listId = requireListId("create the FAIT");
  const fields = buildFaitCreateFields(input);

  const person = await ensurePersonLookupId(SP_SITE_URL, initiator ?? null);
  if (person?.lookupId) fields.InitiatorLookupId = person.lookupId;
  const watchers = await ensureLookupIds(SP_SITE_URL, initiator ? [initiator] : []);
  if (watchers.some((p) => p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", watchers));
  }

  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields }) },
  );
  return (await getFait(parseInt(created.id, 10))) ?? toFait(created);
}

/** Patch columns by their SharePoint names. */
export async function updateFaitFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<Fait> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((f) => f.id === id);
    if (idx < 0) throw new Error(`FAIT ${id} not found`);
    const next: Fait = {
      ...mockStore[idx],
      values: { ...mockStore[idx].values },
      modifiedAt: new Date(),
    };
    applyMockFields(next, fields);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  const updated = await getFait(id);
  if (!updated) throw new Error(`FAIT ${id} disappeared after update`);
  return updated;
}

/** Mock-mode equivalent of the PATCH — mirrors the real column names. */
function applyMockFields(next: Fait, fields: Record<string, unknown>) {
  if ("Title" in fields) next.title = String(fields.Title ?? "");
  if ("Status" in fields) next.status = String(fields.Status ?? "");
  if ("ProjectReferenceLookupId" in fields) {
    const id = fields.ProjectReferenceLookupId;
    next.parentProject = typeof id === "number" ? { lookupId: id, title: "" } : null;
  }
  if ("Watchers" in fields && Array.isArray(fields.Watchers)) {
    next.watchers = fields.Watchers as Person[];
  }
  if ("AssignedEngineer" in fields) {
    next.assignedEngineer = (fields.AssignedEngineer as Person | null) ?? null;
  }
  if ("KAM" in fields) {
    next.kam = (fields.KAM as Person | null) ?? null;
  }
  for (const [column, value] of Object.entries(fields)) {
    const field = FAIT_COLUMN_FIELDS[column];
    if (!field) continue;
    if (field.kind === "boolean") {
      next.values[field.key] = value === true ? "Yes" : "";
    } else if (field.kind === "date") {
      next.values[field.key] = value ? new Date(String(value)).toISOString() : "";
    } else {
      next.values[field.key] = String(value ?? "");
    }
  }
}

const FAIT_COLUMN_FIELDS: Record<string, (typeof FAIT_FIELDS)[number]> = Object.fromEntries(
  FAIT_FIELDS.map((f) => [f.column, f]),
);

/**
 * Watchers merged with one more person, for an assignment write that should
 * also subscribe them — re-reads the item first so a watcher added elsewhere
 * isn't clobbered. Returns the unchanged list when `person` is null (clearing
 * an assignment doesn't unwatch anyone — the house rule everywhere in ARC).
 */
async function faitWatchersWithPerson(id: number, person: Person | null): Promise<Person[]> {
  const current = await getFait(id);
  return autoWatchers(current?.watchers, person);
}

/**
 * Set the Assigned Engineer. There was no way to do this at all before
 * 2026-08-27 (Ray: "we cannot figure out how to assign an engineer") —
 * `AssignedEngineer` was written only as `null` on create and never touched
 * again. The engineer also becomes a watcher, same as EIR's
 * `setEirAssignedEngineers` — they're the one actively doing the work, not
 * just someone told about it once.
 */
export async function updateFaitAssignedEngineer(id: number, person: Person | null): Promise<Fait> {
  const watchers = await faitWatchersWithPerson(id, person);
  if (USE_MOCK) {
    return updateFaitFields(id, { AssignedEngineer: person, Watchers: watchers });
  }
  const ensuredPerson = await ensurePersonLookupId(SP_SITE_URL, person);
  const ensuredWatchers = await ensureLookupIds(SP_SITE_URL, watchers);
  return updateFaitFields(id, {
    AssignedEngineerLookupId: ensuredPerson?.lookupId ?? null,
    ...multiPersonField("Watchers", ensuredWatchers),
  });
}

/**
 * Set the KAM. Same gap as Assigned Engineer — never settable from ARC.
 * Clearing it back to nobody is also how a FAIT that doesn't need a KAM
 * sign-off says so: the detail page hides the KAM sign-off fields once
 * there's neither a KAM assigned nor any KAM sign-off data already on the
 * record (see `kamNeeded` in FaitDetailView.tsx).
 */
export async function updateFaitKam(id: number, person: Person | null): Promise<Fait> {
  const watchers = await faitWatchersWithPerson(id, person);
  if (USE_MOCK) {
    return updateFaitFields(id, { KAM: person, Watchers: watchers });
  }
  const ensuredPerson = await ensurePersonLookupId(SP_SITE_URL, person);
  const ensuredWatchers = await ensureLookupIds(SP_SITE_URL, watchers);
  return updateFaitFields(id, {
    KAMLookupId: ensuredPerson?.lookupId ?? null,
    ...multiPersonField("Watchers", ensuredWatchers),
  });
}

/** Replace the Watchers list. */
export async function setFaitWatchers(id: number, people: Person[]): Promise<Fait> {
  if (USE_MOCK) return updateFaitFields(id, { Watchers: people });
  const ensured = await ensureLookupIds(SP_SITE_URL, people);
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.",
    );
  }
  return updateFaitFields(id, multiPersonField("Watchers", ensured));
}

/** Append a comment to the FAIT's Communication field. */
export async function addFaitComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<Fait> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((f) => f.id === id);
    if (idx < 0) throw new Error(`FAIT ${id} not found`);
    const next: Fait = {
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

  // Read-modify-write on one field, the same as every other comment thread.
  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateFaitFields(id, { Communication: appendComment(existingRaw, comment) });
}

/** Edit one existing comment, matched on its timestamp + author. */
export async function editFaitComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<Fait> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((f) => f.id === id);
    if (idx < 0) throw new Error(`FAIT ${id} not found`);
    const next: Fait = {
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
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateFaitFields(id, {
    Communication: replaceComment(existingRaw, target, newBodyHtml),
  });
}
