import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_SCNS_LIST_ID, SP_SCN_SITE_URL, USE_MOCK } from "./config";
import { resolvePeopleLookupIds, resolveSiteUserLookupId } from "./siteUsers";
import type { GraphListItem, Person, Scn, ScnInput, ScnPatch } from "@/types/task";
import {
  applyScnPatch,
  buildScnCreateFields,
  buildScnUpdateFields,
  compareScns,
  toScn,
} from "@/lib/scnMapper";
import { SCN_COLUMN_KEYS, SCN_MULTI_CHOICE_COLUMNS, SCN_SELECT, scnField } from "@/lib/scnFields";
import { nextScnNumber, scnYearOf } from "@/lib/scnNumber";
import { appendComment, parseCommunication, replaceComment } from "@/lib/communicationParser";
import { annotateMultiChoiceFields, multiPersonField } from "@/lib/graphFields";
import { autoWatchers } from "@/lib/people";
import { parseSpDateOnly } from "@/lib/spDates";
import { MOCK_SCNS } from "@/data/scnMockData";
import { mockDelay } from "./mockLatency";

// =============================================================================
// SCNs API — Supply Chain Notices, the "SCN Dashboard" list on the SCN subsite
// of ALTRONICSALESTEAM (SITES.scn).
//
// A Supply Chain feature on a Sales-site list (Ray, 2026-10-07), the same
// arrangement as Cost Impact Notices on salesTeam and Gray Market Requests on
// PMO: that's where the list has always been, and the Sales Team collection's
// grant already covers the subsite.
//
// **There is no delete**, in the UI or here — an SCN is a controlled notice,
// the same call as Gray Market, FAIT and Cost Impact. A superseded one is
// Cancelled or CLOSED.
//
// 142 rows and growing slowly, so the list is fetched whole and filtered in
// the browser.
//
// PEOPLE. All three person columns are MULTI-value, so Graph expands them on
// read and no directory lookup is needed to show a name. WRITES resolve
// lookupIds Graph-first (`resolvePeopleLookupIds`), never bare `ensureuser`:
//
//   - the directory read goes to **SITES.salesTeam, the site collection's
//     ROOT web**, not SITES.scn. A lookupId is per site COLLECTION and the
//     hidden User Information List lives on the collection's root web — a
//     subsite has no list of its own to read. (customerNotes.ts, on the
//     OrderEntry subsite, never reads a directory at all; this is the same
//     collection, so its ids are the same ids.)
//   - the `ensureuser` fallback, for somebody genuinely new to the collection,
//     goes to the SCN subsite's own REST root (SP_SCN_SITE_URL) — exactly what
//     customerNotes.ts does with SP_SALES_ORDERENTRY_SITE_URL. A subweb's
//     ensureuser returns the collection-level id.
// =============================================================================

/** Where the User Information List for this site collection lives. See the header. */
const SCN_DIRECTORY_SITE = SITES.salesTeam;

/** Item-level properties worth carrying — `createdBy` is "Raised by". */
const ITEM_SELECT = "id,createdBy,createdDateTime,lastModifiedDateTime";

let mockStore: Scn[] = MOCK_SCNS.map(clone);

function clone(scn: Scn): Scn {
  return {
    ...scn,
    assignedTo: [...scn.assignedTo],
    owner: [...scn.owner],
    watchers: [...scn.watchers],
    comments: scn.comments.map((c) => ({ ...c })),
    values: { ...scn.values },
    checks: Object.fromEntries(Object.entries(scn.checks).map(([k, v]) => [k, [...v]])),
    dates: { ...scn.dates },
    taskList: scn.taskList ? { ...scn.taskList } : null,
  };
}

/** For tests: put the mock store back to the seed rows. */
export function __resetScnMockStore(): void {
  mockStore = MOCK_SCNS.map(clone);
}

function requireListId(action: string): string {
  if (!SP_SCNS_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_SCNS_LIST_ID is not set.`);
  }
  return SP_SCNS_LIST_ID;
}

function listPath(): string {
  return `/sites/${SITES.scn}/lists/${requireListId("reach the SCN list")}/items`;
}

function itemPath(id: number): string {
  return `${listPath()}/${id}`;
}

/** Whether a Graph failure means "no such item" rather than "something broke". */
function isNotFound(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === 404) return true;
  return /\b404\b|itemNotFound/i.test(err instanceof Error ? err.message : String(err));
}

/** Resolve people against THIS site collection — see the header on which site is which. */
function resolveScnPeople(people: Person[]): Promise<Person[]> {
  return resolvePeopleLookupIds(SCN_DIRECTORY_SITE, SP_SCN_SITE_URL, people);
}

/**
 * An email → this site collection's lookupId, for a cold-start @-mention
 * auto-watch. Graph first (the collection root's User Information List), then
 * `ensureuser` on the SCN subsite. The `resolveLookupId` every comment thread
 * has to name — see api/autoWatch.ts.
 */
export function resolveScnSiteUserLookupId(email: string): Promise<number> {
  return resolveSiteUserLookupId(SCN_DIRECTORY_SITE, SP_SCN_SITE_URL, email);
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

/** Every SCN, newest SCN# first. */
export async function listScns(): Promise<Scn[]> {
  if (USE_MOCK) {
    return mockDelay([...mockStore].sort(compareScns).map(clone));
  }
  const items = await graphFetchAll<GraphListItem>(
    `${listPath()}?$select=${ITEM_SELECT}&$expand=fields($select=${SCN_SELECT})&$top=999`,
  );
  return items.map(toScn).sort(compareScns);
}

/**
 * One SCN. A 404 is a real answer ("it isn't there") and reads as null;
 * anything else — a throttle, a refused read, a dead session — propagates.
 * Swallowing every failure into null is how a successful write gets reported
 * as "the SCN disappeared" (the FAIT lesson, 2026-08-27).
 */
export async function getScn(id: number): Promise<Scn | null> {
  if (USE_MOCK) {
    const found = mockStore.find((s) => s.id === id);
    return mockDelay(found ? clone(found) : null);
  }
  const item = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$select=${ITEM_SELECT}&$expand=fields($select=${SCN_SELECT})`,
  ).catch((err: unknown) => {
    if (isNotFound(err)) return null;
    throw err;
  });
  return item ? toScn(item) : null;
}

/** Every Title on the list — the input to the numbering rule. A FRESH read, not the cache. */
async function listScnTitles(): Promise<string[]> {
  if (USE_MOCK) return mockStore.map((s) => s.scnNumber);
  const items = await graphFetchAll<GraphListItem>(
    `${listPath()}?$expand=fields($select=Title)&$top=999`,
  );
  return items.map((item) => String(item.fields?.Title ?? ""));
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

/**
 * Raise an SCN. Title is the next SCN# from a fresh read of every title on
 * the list (two people in the same second can still collide — the window
 * every app-generated number in ARC lives with), YEAR is its prefix, Status
 * defaults to WIP, and the assignees and owners watch it alongside whoever
 * the caller already named (the hook adds the creator).
 *
 * Never carries `Task_x0020_List` — a Hyperlink column 400s at create — nor
 * `Communication`, which starts empty.
 */
export async function createScn(input: ScnInput): Promise<Scn> {
  const scnNumber = nextScnNumber(await listScnTitles());
  const watchers = autoWatchers(input.watchers, input.assignedTo, input.owner);

  if (USE_MOCK) {
    const now = new Date();
    const values: Record<string, string> = {};
    const checks: Record<string, string[]> = {};
    const dates: Record<string, Date | null> = {};
    for (const field of Object.values(SCN_COLUMN_KEYS).map((k) => scnField(k)!)) {
      if (field.kind === "multiChoice") checks[field.key] = [];
      else if (field.kind === "date") dates[field.key] = null;
      else if (!field.named && field.kind !== "person" && field.kind !== "link") {
        values[field.key] = (input.values[field.key] ?? "").trim();
      }
    }
    const scn: Scn = {
      id: Math.max(0, ...mockStore.map((s) => s.id)) + 1,
      scnNumber,
      year: scnYearOf(scnNumber),
      product: input.product.trim(),
      category: input.category.trim(),
      status: (input.status ?? "").trim() || "WIP",
      approvalStatus: input.approvalStatus.trim(),
      assignedTo: [...input.assignedTo],
      owner: [...input.owner],
      watchers,
      comments: [],
      hasAttachments: false,
      values,
      checks,
      dates,
      taskList: null,
      createdBy: watchers[0] ?? null,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [scn, ...mockStore];
    return mockDelay(clone(scn));
  }

  const fields = buildScnCreateFields(input, scnNumber);
  const [assignedTo, owner, watching] = await Promise.all([
    resolveScnPeople(input.assignedTo),
    resolveScnPeople(input.owner),
    resolveScnPeople(watchers),
  ]);
  // A column with nobody resolved is left out of the create rather than sent
  // as an annotated empty array — SharePoint would rather not hear about it.
  if (assignedTo.some((p) => p.lookupId)) Object.assign(fields, multiPersonField("AssignedTo", assignedTo));
  if (owner.some((p) => p.lookupId)) Object.assign(fields, multiPersonField("Owner", owner));
  if (watching.some((p) => p.lookupId)) Object.assign(fields, multiPersonField("Watchers", watching));

  const created = await graphFetch<GraphListItem>(listPath(), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return (await getScn(parseInt(created.id, 10))) ?? toScn(created);
}

// -----------------------------------------------------------------------------
// Updates
// -----------------------------------------------------------------------------

/**
 * Patch descriptor fields, by key, DIFFED against the row the edit started
 * from — only the columns that actually changed travel. Multi-choice arrays
 * get the `Collection(Edm.String)` annotation here, at the write site; a
 * cleared checklist is an annotated `[]`. `Title` is never in a PATCH (the
 * SCN# is not editable), and `Task_x0020_List` is refused by the mapper.
 *
 * Nothing changed → nothing is sent, and the previous row comes back as-is.
 */
export async function updateScnFields(id: number, changes: ScnPatch, previous: Scn): Promise<Scn> {
  const fields = buildScnUpdateFields(changes, previous);

  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`SCN ${id} not found`);
    const next = { ...applyScnPatch(mockStore[idx], changes), modifiedAt: new Date() };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay(clone(next));
  }

  if (Object.keys(fields).length === 0) return previous;
  return patchColumns(id, annotateMultiChoiceFields(fields, SCN_MULTI_CHOICE_COLUMNS));
}

/**
 * Write raw columns (person envelopes, Communication) and hand back the row
 * as SharePoint now holds it. Private: every public write builds its payload
 * through the mapper or a graphFields helper first.
 */
async function patchColumns(id: number, fields: Record<string, unknown>): Promise<Scn> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`SCN ${id} not found`);
    const next = clone(mockStore[idx]);
    applyMockColumns(next, fields);
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay(clone(next));
  }

  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  const updated = await getScn(id);
  if (!updated) throw new Error(`SCN ${id} disappeared after update`);
  return updated;
}

/** Mock-mode equivalent of a raw column PATCH — person columns arrive as Person[] here. */
function applyMockColumns(next: Scn, fields: Record<string, unknown>): void {
  if (Array.isArray(fields.Watchers)) next.watchers = fields.Watchers as Person[];
  if (Array.isArray(fields.AssignedTo)) next.assignedTo = fields.AssignedTo as Person[];
  if (Array.isArray(fields.Owner)) next.owner = fields.Owner as Person[];
  if ("Communication" in fields) next.comments = parseCommunication(String(fields.Communication ?? ""));
  if ("SCNStatus" in fields) next.status = String(fields.SCNStatus ?? "");
  if ("ApprovalStatus" in fields) next.approvalStatus = String(fields.ApprovalStatus ?? "");
  if ("Progress" in fields) next.product = String(fields.Progress ?? "");
  if ("Priority" in fields) next.category = String(fields.Priority ?? "");
  for (const [column, value] of Object.entries(fields)) {
    const key = SCN_COLUMN_KEYS[column];
    const field = key ? scnField(key) : undefined;
    if (!field || field.named) continue;
    if (field.kind === "multiChoice") next.checks[key] = Array.isArray(value) ? [...(value as string[])] : [];
    else if (field.kind === "date") next.dates[key] = parseSpDateOnly(value);
    else if (field.kind === "text" || field.kind === "multiline" || field.kind === "choice") {
      next.values[key] = String(value ?? "");
    }
  }
}

/** Replace the Watchers list. */
export async function setScnWatchers(id: number, people: Person[]): Promise<Scn> {
  if (USE_MOCK) return patchColumns(id, { Watchers: people });
  const resolved = await resolveScnPeople(people);
  if (people.length > 0 && !resolved.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.",
    );
  }
  return patchColumns(id, multiPersonField("Watchers", resolved));
}

/**
 * Replace a person column AND fold its people into Watchers in the SAME
 * PATCH — whoever an SCN is assigned to (or owned by) watches it, and two
 * writes could leave the columns disagreeing. Nobody is ever REMOVED from
 * Watchers here; Unwatch is the deliberate way off.
 *
 * The current watchers are re-read from the row rather than trusted from the
 * caller's cache, so a watcher added elsewhere a moment ago isn't clobbered.
 * They keep the lookupIds they were read with — those came off THIS list and
 * are already this collection's — and only the newly named people resolve.
 */
async function setScnPeople(id: number, column: "AssignedTo" | "Owner", people: Person[]): Promise<Scn> {
  if (USE_MOCK) {
    const current = mockStore.find((s) => s.id === id);
    if (!current) throw new Error(`SCN ${id} not found`);
    return patchColumns(id, { [column]: people, Watchers: autoWatchers(current.watchers, people) });
  }
  const [resolved, row] = await Promise.all([
    resolveScnPeople(people),
    graphFetch<GraphListItem>(`${itemPath(id)}?$expand=fields($select=Watchers)`),
  ]);
  if (people.length > 0 && !resolved.some((p) => p.lookupId)) {
    throw new Error(
      `Cannot update ${column === "AssignedTo" ? "Assigned to" : "Owner"}: couldn't resolve a SharePoint user for any of the selected people.`,
    );
  }
  const currentWatchers = toScn(row).watchers;
  return patchColumns(id, {
    ...multiPersonField(column, resolved),
    ...multiPersonField("Watchers", autoWatchers(currentWatchers, resolved)),
  });
}

/** Replace Assigned to; the assignees also watch. */
export function setScnAssigned(id: number, people: Person[]): Promise<Scn> {
  return setScnPeople(id, "AssignedTo", people);
}

/** Replace Owner; the owners also watch. */
export function setScnOwner(id: number, people: Person[]): Promise<Scn> {
  return setScnPeople(id, "Owner", people);
}

// -----------------------------------------------------------------------------
// Comments — the standard pipe-delimited Communication thread.
// -----------------------------------------------------------------------------

/** Read the raw Communication value for a read-modify-write. */
async function readCommunication(id: number): Promise<string> {
  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  return (existing.fields.Communication as string | undefined) ?? "";
}

/** Append a comment to the SCN's Communication field. */
export async function addScnComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<Scn> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`SCN ${id} not found`);
    const next: Scn = {
      ...clone(mockStore[idx]),
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
    return mockDelay(clone(next));
  }

  // Read-modify-write on one field, the same as every other comment thread —
  // the whole Communication value is rewritten, so a comment posted between
  // the read and the write would be lost. Same window the others live with.
  const existingRaw = await readCommunication(id);
  return patchColumns(id, { Communication: appendComment(existingRaw, comment) });
}

/** Edit one existing comment, matched on its timestamp + author. */
export async function editScnComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<Scn> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`SCN ${id} not found`);
    const next: Scn = {
      ...clone(mockStore[idx]),
      comments: mockStore[idx].comments.map((c) =>
        c.timestamp.getTime() === target.timestamp.getTime() &&
        (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
          ? { ...c, bodyHtml: newBodyHtml }
          : c,
      ),
      modifiedAt: new Date(),
    };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay(clone(next));
  }

  const existingRaw = await readCommunication(id);
  return patchColumns(id, { Communication: replaceComment(existingRaw, target, newBodyHtml) });
}
