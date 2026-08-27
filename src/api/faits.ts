import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_FAIT_LIST_ID, SP_SITE_URL, USE_MOCK } from "./config";
import {
  listSiteUserDirectory,
  resolvePeopleLookupIds,
  resolvePersonLookupId,
} from "./siteUsers";
import type { Fait, FaitInput, GraphListItem, Person } from "@/types/task";
import {
  attachFaitPeople,
  buildFaitCreateFields,
  compareFaits,
  faitLabel,
  toFait,
} from "@/lib/faitMapper";
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

/**
 * Resolve (creating on the site if needed) a person's lookupId for the
 * Engineering site — Graph's User Information List first, classic
 * `ensureuser` only for somebody the site has never seen.
 *
 * Both wrappers exist so no FAIT write reaches for `ensureLookupIds`
 * directly: that path is SP-REST-only, and when the classic SharePoint scope
 * isn't granted it returns nobody — which the assignment writes then sent as
 * `null`, silently clearing the column they were asked to set (2026-08-27).
 */
function resolveFaitPerson(person: Person | null): Promise<Person | null> {
  return resolvePersonLookupId(SITES.engineering, SP_SITE_URL, person);
}

function resolveFaitPeople(people: Person[]): Promise<Person[]> {
  return resolvePeopleLookupIds(SITES.engineering, SP_SITE_URL, people);
}

/**
 * A person column write that was ASKED for and can't be made.
 *
 * Refusing is the only honest answer: the alternative — what this module used
 * to do — is to PATCH `null`, which SharePoint accepts, so the picker snapped
 * back to "Not set" with no error anywhere and the assignment looked like it
 * simply didn't stick.
 */
function requireResolved(person: Person | null, resolved: Person | null, label: string): void {
  if (!person) return;
  if (resolved?.lookupId) return;
  throw new Error(
    `Couldn't set ${label} to ${person.displayName || person.email || "that person"}: ` +
      `SharePoint has no user record for them on the Engineering site, and one couldn't be created. ` +
      `Ask an admin to check your SharePoint access, then try again.`,
  );
}

/** Every FAIT, newest first. */
export async function listFaits(): Promise<Fait[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareFaits).map((f) => ({ ...f })));
  }
  const listId = requireListId("load FAITs");
  // The site-user directory in parallel: the three single-person columns come
  // back as bare lookupIds, so without it Initiator / Assigned Engineer / KAM
  // read as nobody on every row. Best-effort — a failure leaves the ids
  // showing as "User #n" rather than emptying the page.
  const [items, siteUsers] = await Promise.all([
    graphFetchAll<GraphListItem>(
      `/sites/${SITES.engineering}/lists/${listId}/items` +
        `?$expand=fields($select=${FAIT_SELECT})&$top=999`,
    ),
    listSiteUserDirectory(SITES.engineering),
  ]);
  const faits = items.map(toFait);
  attachFaitPeople(faits, siteUsers);
  return faits.sort(compareFaits);
}

export async function getFait(id: number): Promise<Fait | null> {
  if (USE_MOCK) {
    const found = mockStore.find((f) => f.id === id);
    return delay(found ? { ...found } : null);
  }
  // A 404 is a real answer ("it isn't there"); anything else is a fault and
  // must propagate. This used to swallow EVERY failure into `null`, which
  // `updateFaitFields` then reported as "FAIT n disappeared after update" —
  // so a throttle or a refused read on the re-read after a SUCCESSFUL write
  // rolled the change back on screen and hid the reason (2026-08-27).
  const item = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=${FAIT_SELECT})`,
  ).catch((err: unknown) => {
    if (isNotFound(err)) return null;
    throw err;
  });
  if (!item) return null;
  const fait = toFait(item);
  attachFaitPeople([fait], await listSiteUserDirectory(SITES.engineering));
  return fait;
}

/** Whether a Graph failure means "no such item" rather than "something broke". */
function isNotFound(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === 404) return true;
  return /\b404\b|itemNotFound/i.test(err instanceof Error ? err.message : String(err));
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

  // Initiator is the person raising it — never typed, never a picker. It's
  // resolved Graph-first (see resolveFaitPerson): the old SP-REST-only path
  // returned nobody whenever the classic SharePoint scope was missing, so the
  // column was quietly omitted and every FAIT raised from ARC had a blank
  // Initiator (2026-08-27).
  const person = await resolveFaitPerson(initiator ?? null);
  if (person?.lookupId) fields.InitiatorLookupId = person.lookupId;
  const watchers = await resolveFaitPeople(initiator ? [initiator] : []);
  if (watchers.some((p) => p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", watchers));
  }

  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields }) },
  );
  const fait = (await getFait(parseInt(created.id, 10))) ?? toFait(created);
  // The FAIT is real either way — a create is not worth failing over one
  // column — but an Initiator that silently didn't land is exactly what went
  // unnoticed before, so the caller is told and can warn (see useCreateFait).
  if (initiator && !fait.initiator) {
    throw new FaitInitiatorNotSetError(fait, initiator);
  }
  return fait;
}

/**
 * The FAIT was created, but its Initiator column couldn't be set.
 *
 * Carries the created FAIT so the caller completes the creation — toast,
 * cache seed, intake alert, navigation — and warns about the one thing that
 * didn't save, rather than reporting a failed create that in fact succeeded.
 * Same shape as `TaskFollowUpWriteError` on the EIR→task promotion path.
 */
export class FaitInitiatorNotSetError extends Error {
  constructor(
    readonly fait: Fait,
    readonly initiator: Person,
  ) {
    super(
      `${faitLabel(fait)} was raised, but the Initiator couldn't be set to ` +
        `${initiator.displayName || initiator.email || "you"} — SharePoint has no user record ` +
        `for that account on the Engineering site. Set it on the FAIT, or ask an admin to check ` +
        `your SharePoint access.`,
    );
    this.name = "FaitInitiatorNotSetError";
  }
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

  // Past this line the write HAS landed, so a failure re-reading the item is
  // not a failed save and must not be reported as one. It used to be: any
  // read failure came back as "FAIT n disappeared after update", the hook
  // rolled the change off the screen, and the change was in SharePoint all
  // along — indistinguishable from a column that genuinely won't save.
  let updated: Fait | null;
  try {
    updated = await getFait(id);
  } catch (err) {
    throw new FaitReadBackError(id, err);
  }
  if (!updated) throw new FaitReadBackError(id, new Error("the item is no longer in the list"));
  return updated;
}

/**
 * The PATCH succeeded; reading the item back afterwards didn't.
 *
 * Its own type so the mutation hook can tell "your change didn't save" from
 * "your change saved and the screen is behind" — those need opposite
 * handling, and one wrong message here is what made a working write look
 * broken (2026-08-27).
 */
export class FaitReadBackError extends Error {
  constructor(
    readonly faitId: number,
    readonly cause: unknown,
  ) {
    super(
      `Your change to FAIT ${faitId} was saved, but ARC couldn't read the FAIT back ` +
        `afterwards — refresh to see the current state. ` +
        `(${cause instanceof Error ? cause.message : String(cause)})`,
    );
    this.name = "FaitReadBackError";
  }
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
  const resolved = await resolveFaitPerson(person);
  requireResolved(person, resolved, "Assigned Engineer");
  const resolvedWatchers = await resolveFaitPeople(watchers);
  return updateFaitFields(id, {
    AssignedEngineerLookupId: resolved?.lookupId ?? null,
    ...multiPersonField("Watchers", resolvedWatchers),
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
  const resolved = await resolveFaitPerson(person);
  requireResolved(person, resolved, "KAM");
  const resolvedWatchers = await resolveFaitPeople(watchers);
  return updateFaitFields(id, {
    KAMLookupId: resolved?.lookupId ?? null,
    ...multiPersonField("Watchers", resolvedWatchers),
  });
}

/** Replace the Watchers list. */
export async function setFaitWatchers(id: number, people: Person[]): Promise<Fait> {
  if (USE_MOCK) return updateFaitFields(id, { Watchers: people });
  const ensured = await resolveFaitPeople(people);
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
