import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_ECN_CHECKLISTS_LIST_ID, USE_MOCK } from "./config";
import { resolveCurrentUserLookupId } from "./currentUser";
import type { EcnChecklist, GraphListItem, Person } from "@/types/task";
import { multiPersonField } from "@/lib/graphFields";
import { autoWatchers } from "@/lib/people";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import {
  mergeAnswers,
  parseAnswersResult,
  progressFor,
  serialiseAnswers,
  statusFromProgress,
  type EcnChecklistAnswer,
  type EcnChecklistAnswers,
} from "@/lib/ecnChecklist";
import { ECN_CHECKLIST_TEMPLATE_REVISION } from "@/lib/ecnChecklistTemplate";
import { toEcnChecklist } from "@/lib/ecnChecklistMapper";
import { MOCK_ECN_CHECKLISTS } from "@/data/ecnChecklistMockData";

// =============================================================================
// ECN Checklists — the Cross-Functional ECN Checklist (Form# MFGFRM-038), one
// row per ECN, on the Engineering site.
//
// **The list id has no default** (see config.ts). With it unset, `list` and
// `get` return nothing rather than throwing, so the ECN detail page shows a
// "not configured" notice instead of an error — the Quick Links shape.
//
// **`EcnRef` is a SINGLE lookup**, which is the trap this repo has been caught
// by four times over (FAIT's three person columns, Supplier `BPReference`,
// the CMMS lists, Feature Requests' `RequestedBy`): Graph returns it as a bare
// `EcnRefLookupId` even when the friendly name is in the `$select`, so BOTH
// halves are selected and a write is a BARE INTEGER — never
// `multiLookupField`'s `Collection(Edm.Int32)` shape, which 400s here. None of
// that is visible from mock mode; `ecnChecklists.lookup.test.ts` forces
// `USE_MOCK: false` and asserts the request shapes.
//
// **No delete.** A checklist records the review that was done on a controlled
// change — the same call as the ECNs list it hangs off, which has no delete
// either. `ecnChecklists.test.ts` asserts this module exports nothing matching
// /delete|remove/.
// =============================================================================

let mockStore: EcnChecklist[] = MOCK_ECN_CHECKLISTS.map((c) => ({ ...c }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** True when the list has been created and its id configured. */
export function ecnChecklistsConfigured(): boolean {
  return USE_MOCK || !!SP_ECN_CHECKLISTS_LIST_ID;
}

function requireListId(action: string): string {
  if (!SP_ECN_CHECKLISTS_LIST_ID) {
    throw new Error(
      `Cannot ${action}: VITE_SP_ECN_CHECKLISTS_LIST_ID is not set. ` +
        "Run scripts/create-ecn-checklist-list.ps1, then set the repo variable and redeploy.",
    );
  }
  return SP_ECN_CHECKLISTS_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.engineering}/lists/${requireListId("reach the checklist")}/items/${id}`;
}

const ITEM_SELECT = "id,createdDateTime,lastModifiedDateTime";

/**
 * BOTH halves of every single-value lookup and person column. Selecting only
 * the friendly name returns a bare `…LookupId` and the mapper reads null —
 * which looks exactly like a checklist attached to no ECN.
 */
export const ECN_CHECKLIST_SELECT = [
  "id",
  "Title",
  "EcnRef",
  "EcnRefLookupId",
  "Status",
  "TemplateRevision",
  "Answers",
  "ItemsTotal",
  "ItemsComplete",
  "ItemsNa",
  "ItemsFlagged",
  "CompletedBy",
  "CompletedByLookupId",
  "CompletedDate",
  "Communication",
  "Watchers",
  "Attachments",
].join(",");

/** Every checklist. Small list — one row per ECN — so it is fetched whole. */
export async function listEcnChecklists(): Promise<EcnChecklist[]> {
  if (USE_MOCK) return delay(mockStore.map((c) => ({ ...c })));
  if (!SP_ECN_CHECKLISTS_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${SP_ECN_CHECKLISTS_LIST_ID}/items` +
      `?$select=${ITEM_SELECT}&$expand=fields($select=${ECN_CHECKLIST_SELECT})&$top=999`,
  );
  return items.map(toEcnChecklist);
}

/** The checklist for one ECN, or null when it hasn't got one yet. */
export async function getChecklistForEcn(ecnId: number): Promise<EcnChecklist | null> {
  const all = await listEcnChecklists();
  return all.find((c) => c.ecnId === ecnId) ?? null;
}

export async function getEcnChecklist(id: number): Promise<EcnChecklist | null> {
  if (USE_MOCK) {
    const found = mockStore.find((c) => c.id === id);
    return delay(found ? { ...found } : null);
  }
  try {
    const item = await graphFetch<GraphListItem>(
      `${itemPath(id)}?$select=${ITEM_SELECT}&$expand=fields($select=${ECN_CHECKLIST_SELECT})`,
    );
    return toEcnChecklist(item);
  } catch (err) {
    // Only a genuine 404 means "no such checklist". Swallowing everything else
    // would report a throttled or refused read as a missing row — the mistake
    // `getFait` made, which then reported the wrong cause after a write.
    if (err instanceof Error && /\b404\b/.test(err.message)) return null;
    throw err;
  }
}

/**
 * Create the checklist for an ECN.
 *
 * Called automatically after an ECN is created (Ray, 2026-09-15), and from
 * the "Create checklist" button for the 1,800+ ECNs that predate this
 * feature — auto-create can never reach those.
 *
 * Refuses when one already exists rather than writing a second: two
 * checklists on one ECN means whichever loads first wins, silently.
 */
export async function createEcnChecklist(
  ecnId: number,
  ecnLogNo: string,
  actor?: Person,
): Promise<EcnChecklist> {
  const existing = await getChecklistForEcn(ecnId);
  if (existing) return existing;

  const watchers = autoWatchers(undefined, undefined, actor);
  const empty: EcnChecklistAnswers = {
    templateRevision: ECN_CHECKLIST_TEMPLATE_REVISION,
    items: {},
  };
  const p = progressFor(empty);

  if (USE_MOCK) {
    const now = new Date();
    const checklist: EcnChecklist = {
      id: Math.max(0, ...mockStore.map((c) => c.id)) + 1,
      ecnId,
      title: ecnLogNo,
      status: statusFromProgress(p),
      templateRevision: ECN_CHECKLIST_TEMPLATE_REVISION,
      answersJson: serialiseAnswers(empty),
      itemsTotal: p.total,
      itemsComplete: p.complete,
      itemsNa: p.na,
      itemsFlagged: p.flagged,
      completedBy: null,
      completedDate: null,
      comments: [],
      watchers,
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [checklist, ...mockStore];
    return delay({ ...checklist });
  }

  const listId = requireListId("create the checklist");
  const fields: Record<string, unknown> = {
    Title: ecnLogNo,
    // BARE INTEGER — a single lookup. See the header note.
    EcnRefLookupId: ecnId,
    Status: statusFromProgress(p),
    TemplateRevision: ECN_CHECKLIST_TEMPLATE_REVISION,
    Answers: serialiseAnswers(empty),
    ItemsTotal: p.total,
    ItemsComplete: p.complete,
    ItemsNa: p.na,
    ItemsFlagged: p.flagged,
    ...multiPersonField("Watchers", watchers),
  };

  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields }) },
  );
  return toEcnChecklist(created);
}

/**
 * Apply per-item changes.
 *
 * RE-READS THE ROW FIRST and merges onto what it finds, rather than writing
 * the caller's whole picture. Every write rewrites the one `Answers` cell, so
 * without this two engineers in the same checklist would last-writer-wins over
 * all 84 answers. Only the keys in `changes` are touched, so ticking different
 * items concurrently is safe.
 *
 * REFUSES to write over a blob it could not parse: replacing data we failed to
 * read is the one outcome worse than an error message.
 */
export async function saveChecklistAnswers(
  id: number,
  changes: Record<string, EcnChecklistAnswer>,
): Promise<EcnChecklist> {
  const current = await getEcnChecklist(id);
  if (!current) throw new Error(`Checklist ${id} no longer exists.`);

  const parsed = parseAnswersResult(current.answersJson);
  if (parsed.corrupt) {
    throw new Error(
      "This checklist's stored answers could not be read, so ARC will not " +
        "overwrite them. Check the Answers column on the list item in SharePoint.",
    );
  }

  const merged = mergeAnswers(parsed.answers, changes);
  const p = progressFor(merged);
  const fields: Record<string, unknown> = {
    Answers: serialiseAnswers(merged),
    Status: statusFromProgress(p),
    ItemsTotal: p.total,
    ItemsComplete: p.complete,
    ItemsNa: p.na,
    ItemsFlagged: p.flagged,
  };

  if (USE_MOCK) {
    const next: EcnChecklist = {
      ...current,
      answersJson: fields.Answers as string,
      status: fields.Status as EcnChecklist["status"],
      itemsTotal: p.total,
      itemsComplete: p.complete,
      itemsNa: p.na,
      itemsFlagged: p.flagged,
      modifiedAt: new Date(),
    };
    mockStore = mockStore.map((c) => (c.id === id ? next : c));
    return delay({ ...next });
  }

  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  const after = await getEcnChecklist(id);
  if (!after) throw new Error(`Checklist ${id} disappeared after saving.`);
  return after;
}

/** Stamp who finished the checklist, and when. Clearing un-signs it. */
export async function setChecklistCompletedBy(
  id: number,
  person: Person | null,
): Promise<EcnChecklist> {
  const completedDate = person ? new Date().toISOString() : null;

  if (USE_MOCK) {
    const current = mockStore.find((c) => c.id === id);
    if (!current) throw new Error(`Checklist ${id} no longer exists.`);
    const next: EcnChecklist = {
      ...current,
      completedBy: person,
      completedDate: completedDate ? new Date(completedDate) : null,
      modifiedAt: new Date(),
    };
    mockStore = mockStore.map((c) => (c.id === id ? next : c));
    return delay({ ...next });
  }

  let lookupId: number | null = null;
  if (person) {
    lookupId = person.lookupId ?? null;
    if (!lookupId && person.email) lookupId = await resolveCurrentUserLookupId(person.email);
    // A single-person write that was ASKED FOR and can't be resolved is
    // refused, never sent as null — `null` clears the column, which is
    // indistinguishable from a sign-off that silently never happened.
    if (!lookupId) {
      throw new Error(
        `Could not resolve ${person.displayName} on the Engineering site, so the ` +
          "sign-off was not recorded. Try again, or sign the checklist off in SharePoint.",
      );
    }
  }

  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ CompletedByLookupId: lookupId, CompletedDate: completedDate }),
  });
  const after = await getEcnChecklist(id);
  if (!after) throw new Error(`Checklist ${id} disappeared after saving.`);
  return after;
}

/** Replace the watcher list wholesale. */
export async function setEcnChecklistWatchers(
  id: number,
  people: Person[],
): Promise<EcnChecklist> {
  if (USE_MOCK) {
    const current = mockStore.find((c) => c.id === id);
    if (!current) throw new Error(`Checklist ${id} no longer exists.`);
    const next = { ...current, watchers: people, modifiedAt: new Date() };
    mockStore = mockStore.map((c) => (c.id === id ? next : c));
    return delay({ ...next });
  }

  const resolved: Person[] = [];
  for (const p of people) {
    if (p.lookupId) {
      resolved.push(p);
      continue;
    }
    if (!p.email) continue;
    const lookupId = await resolveCurrentUserLookupId(p.email);
    if (lookupId) resolved.push({ ...p, lookupId });
  }
  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify(multiPersonField("Watchers", resolved)),
  });
  const after = await getEcnChecklist(id);
  if (!after) throw new Error(`Checklist ${id} disappeared after saving.`);
  return after;
}

/** Post a comment onto the checklist's own thread. */
export async function addEcnChecklistComment(
  id: number,
  bodyHtml: string,
  author: Person,
): Promise<EcnChecklist> {
  const current = await getEcnChecklist(id);
  if (!current) throw new Error(`Checklist ${id} no longer exists.`);

  if (USE_MOCK) {
    const next: EcnChecklist = {
      ...current,
      comments: [
        {
          timestamp: new Date(),
          authorName: author.displayName,
          authorEmail: author.email ?? "",
          bodyHtml,
        },
        ...current.comments,
      ],
      modifiedAt: new Date(),
    };
    mockStore = mockStore.map((c) => (c.id === id ? next : c));
    return delay({ ...next });
  }

  const item = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$select=id&$expand=fields($select=Communication)`,
  );
  const existing = (item.fields?.Communication as string) ?? "";
  const updated = appendComment(existing, {
    authorName: author.displayName,
    authorEmail: author.email ?? "",
    bodyHtml,
  });
  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ Communication: updated }),
  });
  const after = await getEcnChecklist(id);
  if (!after) throw new Error(`Checklist ${id} disappeared after commenting.`);
  return after;
}

/** Edit a comment already on the thread. */
export async function editEcnChecklistComment(
  id: number,
  originalTimestamp: Date,
  authorEmail: string,
  newBodyHtml: string,
): Promise<EcnChecklist> {
  const current = await getEcnChecklist(id);
  if (!current) throw new Error(`Checklist ${id} no longer exists.`);

  if (USE_MOCK) {
    const next: EcnChecklist = {
      ...current,
      comments: current.comments.map((c) =>
        c.timestamp.getTime() === originalTimestamp.getTime() && c.authorEmail === authorEmail
          ? { ...c, bodyHtml: newBodyHtml }
          : c,
      ),
      modifiedAt: new Date(),
    };
    mockStore = mockStore.map((c) => (c.id === id ? next : c));
    return delay({ ...next });
  }

  const item = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$select=id&$expand=fields($select=Communication)`,
  );
  const existing = (item.fields?.Communication as string) ?? "";
  const updated = replaceComment(
    existing,
    { timestamp: originalTimestamp, authorEmail },
    newBodyHtml,
  );
  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ Communication: updated }),
  });
  const after = await getEcnChecklist(id);
  if (!after) throw new Error(`Checklist ${id} disappeared after editing.`);
  return after;
}

/** Test seam — resets the mock store between tests. */
export function __resetEcnChecklistMockStore(): void {
  mockStore = MOCK_ECN_CHECKLISTS.map((c) => ({ ...c }));
}
