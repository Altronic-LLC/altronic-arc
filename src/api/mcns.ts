import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_MCNS_LIST_ID, SP_PMO_SITE_URL, USE_MOCK } from "./config";
import { listSiteUserDirectory, resolvePeopleLookupIds, resolveSiteUserLookupId } from "./siteUsers";
import { mockDelay } from "./mockLatency";
import type { GraphListItem, Person } from "@/types/task";
import type { Mcn, McnInput, McnPatch, McnStatus } from "@/types/mcn";
import { applyMcnPatch, buildMcnCreateFields, buildMcnUpdateFields, compareMcns, toMcn } from "@/lib/mcnMapper";
import { MCN_MULTI_CHOICE_COLUMNS, MCN_SELECT, serializePeopleLines } from "@/lib/mcnFields";
import { nextMcnNumber, sameMcnNumber } from "@/lib/mcnNumber";
import { MCN_TRANSITIONS, type McnAction } from "@/lib/mcnWorkflow";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { annotateMultiChoiceFields, multiPersonField } from "@/lib/graphFields";
import { fillPerson } from "@/lib/maintenanceShared";
import { autoWatchers } from "@/lib/people";
import { escapeHtml } from "@/lib/mentions";
import { isUniqueValueRejection, mockUniqueRejection } from "@/lib/quoteMapper";
import { toSpDateOnly } from "@/lib/spDates";
import { MOCK_MCNS } from "@/data/mcnMockData";

// =============================================================================
// Manufacturing Change Notices — the "Manufacturing Change Notices" list on
// Altronic_PMO (BusinessIT#38). Fetched whole: eight MCNs in six years, so it
// will stay far under the 5,000-item threshold for decades.
//
// **No delete**, in the UI or here — an MCN is a controlled record of a change
// to how product is made. A withdrawn change is Rejected; a mistake is fixed
// by reopening (the ECN / FAIT / MRB rule).
//
// PEOPLE. Originated By, Assigned Engineer and Approved By are SINGLE-person
// columns: both halves are selected, the names come from the PMO site's User
// Information List, and a write is a BARE integer. A person who can't be
// resolved on PMO REFUSES the write rather than clearing the column. Watchers
// is multi-person and goes through `multiPersonField`.
//
// THE WORKFLOW never travels as a field patch. Each step (`transitionMcn`)
// reads the row FRESH, refuses one that has moved on, and writes the new
// status, its stamps and a line in the discussion in ONE PATCH — so the
// status and the record of who moved it can't disagree.
// =============================================================================

const ITEM_SELECT = "id,createdBy,createdDateTime,lastModifiedDateTime";

let mockStore: Mcn[] = MOCK_MCNS.map(clone);

function clone(m: Mcn): Mcn {
  return {
    ...m,
    scope: m.scope.map((l) => ({ ...l })),
    items: Object.fromEntries(Object.entries(m.items).map(([k, v]) => [k, { ...v }])),
    distribution: [...m.distribution],
    distributedTo: m.distributedTo.map((p) => ({ ...p })),
    watchers: m.watchers.map((p) => ({ ...p })),
    comments: m.comments.map((c) => ({ ...c })),
  };
}

/** For tests: put the mock store back to the seed rows. */
export function __resetMcnMockStore(): void {
  mockStore = MOCK_MCNS.map(clone);
}

function listPath(): string {
  if (!SP_MCNS_LIST_ID) throw new Error("Manufacturing Change Notices aren't set up yet: VITE_SP_MCNS_LIST_ID is not set.");
  return `/sites/${SITES.pmo}/lists/${SP_MCNS_LIST_ID}/items`;
}

function itemPath(id: number): string {
  return `${listPath()}/${id}`;
}

function isNotFound(err: unknown): boolean {
  if ((err as { status?: number } | null)?.status === 404) return true;
  return /\b404\b|itemNotFound/i.test(err instanceof Error ? err.message : String(err));
}

/** An email → its PMO lookupId (Graph first, then ensureuser). For a cold-start @-mention. */
export function resolveMcnSiteUserLookupId(email: string): Promise<number> {
  return resolveSiteUserLookupId(SITES.pmo, SP_PMO_SITE_URL, email);
}

/** A single person, resolved on PMO — or a refusal naming them. Clearing (`null`) is allowed. */
async function requirePmoLookupId(person: Person | null, label: string): Promise<number | null> {
  if (!person) return null;
  const id = person.email ? await resolveMcnSiteUserLookupId(person.email) : (person.lookupId ?? 0);
  if (id) return id;
  throw new Error(
    `Couldn't set ${label} to ${person.displayName || person.email || "that person"}: SharePoint has no user ` +
      `record for them on Altronic_PMO, and one couldn't be created. Ask an admin to check your SharePoint access.`,
  );
}

function withPeople(mcn: Mcn, siteUsers: Map<number, Person>): Mcn {
  return {
    ...mcn,
    originatedBy: fillPerson(mcn.originatedBy, siteUsers),
    assignedEngineer: fillPerson(mcn.assignedEngineer, siteUsers),
    approvedBy: fillPerson(mcn.approvedBy, siteUsers),
  };
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

/** Every MCN, newest first. */
export async function listMcns(): Promise<Mcn[]> {
  if (USE_MOCK) return mockDelay([...mockStore].sort(compareMcns).map(clone));
  // The directory in parallel and best-effort: a failed read leaves the people
  // showing as "User #n", never the whole register empty.
  const [items, siteUsers] = await Promise.all([
    graphFetchAll<GraphListItem>(`${listPath()}?$select=${ITEM_SELECT}&$expand=fields($select=${MCN_SELECT})&$top=999`),
    listSiteUserDirectory(SITES.pmo),
  ]);
  return items.map((i) => withPeople(toMcn(i), siteUsers)).sort(compareMcns);
}

/**
 * One MCN. A 404 is a real answer and reads as null; anything else — a
 * throttle, a refusal — propagates (the FAIT lesson: swallowing every failure
 * is how a write that landed gets reported as "it disappeared").
 */
export async function getMcn(id: number): Promise<Mcn | null> {
  if (USE_MOCK) {
    const found = mockStore.find((m) => m.id === id);
    return mockDelay(found ? clone(found) : null);
  }
  const [item, siteUsers] = await Promise.all([
    graphFetch<GraphListItem>(`${itemPath(id)}?$select=${ITEM_SELECT}&$expand=fields($select=${MCN_SELECT})`).catch(
      (err: unknown) => {
        if (isNotFound(err)) return null;
        throw err;
      },
    ),
    listSiteUserDirectory(SITES.pmo),
  ]);
  return item ? withPeople(toMcn(item), siteUsers) : null;
}

/** Every MCN number with its id, read FRESH — the input to numbering. */
async function listMcnNumbers(): Promise<{ id: number; number: string }[]> {
  if (USE_MOCK) return mockStore.map((m) => ({ id: m.id, number: m.mcnNumber }));
  const items = await graphFetchAll<GraphListItem>(`${listPath()}?$expand=fields($select=Title)&$top=999`);
  return items.map((i) => ({ id: parseInt(i.id, 10), number: String(i.fields?.Title ?? "") }));
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

/**
 * The MCN exists, but ARC couldn't confirm its number is unique. A caller
 * must treat the create as having succeeded and say so.
 */
export class McnNumberUnconfirmedError extends Error {
  /** The MCN was created — never a "Save Failed" email. */
  readonly writeLanded = true;
  readonly mcn: Mcn;
  constructor(mcn: Mcn, cause?: unknown) {
    super(
      `${mcn.mcnNumber || `MCN ${mcn.id}`} was created, but ARC couldn't confirm its number is unique. ` +
        `Check the MCN register for another MCN with the same number.`,
    );
    this.name = "McnNumberUnconfirmedError";
    this.mcn = mcn;
    this.cause = cause;
  }
}

/**
 * Raise an MCN. The number is the next one for the year from a FRESH read of
 * every number on the list — never the form's cached copy (BusinessIT#27 on
 * EIRs). Title carries Enforce Unique Values, so two people pressing Create
 * in the same second have the second refused; that refusal re-reads and
 * renumbers ONCE. `settleMcnNumber` then covers a list where uniqueness
 * isn't enforced, the EIR way: the OLDER item keeps the number.
 *
 * The originator and the assigned engineer watch it, beside whoever the
 * caller named (the hook adds the creator).
 */
export async function createMcn(input: McnInput): Promise<Mcn> {
  const watchers = autoWatchers(input.watchers, input.originatedBy, input.assignedEngineer);

  if (USE_MOCK) {
    const number = nextMcnNumber(mockStore.map((m) => m.mcnNumber));
    if (mockStore.some((m) => sameMcnNumber(m.mcnNumber, number))) throw mockUniqueRejection("Title", number);
    const now = new Date();
    const draft = applyMcnPatch(
      {
        id: Math.max(0, ...mockStore.map((m) => m.id)) + 1,
        mcnNumber: number,
        date: null,
        process: "",
        priority: "",
        status: "Draft",
        originatedBy: input.originatedBy,
        assignedEngineer: input.assignedEngineer,
        approvedBy: null,
        approvedAt: null,
        description: "",
        scope: [],
        scopeCorrupt: false,
        items: Object.fromEntries(Object.entries(MOCK_MCNS[0].items).map(([k]) => [k, { answer: "", reference: "" }])),
        distribution: [],
        distributedTo: [],
        distributedAt: null,
        dateImplemented: null,
        affected: "",
        rejectionReason: "",
        operationsTask: null,
        legacyNote: "",
        watchers,
        comments: [],
        hasAttachments: false,
        createdBy: watchers[0] ?? null,
        createdAt: now,
        modifiedAt: now,
      },
      {
        date: input.date,
        process: input.process,
        priority: input.priority,
        description: input.description,
        scope: input.scope,
        distribution: input.distribution,
      },
    );
    mockStore = [draft, ...mockStore];
    return mockDelay(clone(draft));
  }

  const fields: Record<string, unknown> = buildMcnCreateFields(input);
  const [originatorId, engineerId, watching] = await Promise.all([
    requirePmoLookupId(input.originatedBy, "Originated By"),
    requirePmoLookupId(input.assignedEngineer, "Assigned Engineer"),
    resolvePeopleLookupIds(SITES.pmo, SP_PMO_SITE_URL, watchers),
  ]);
  if (originatorId) fields.OriginatedByLookupId = originatorId;
  if (engineerId) fields.AssignedEngineerLookupId = engineerId;
  if (watching.some((p) => p.lookupId)) Object.assign(fields, multiPersonField("Watchers", watching));
  const payload = annotateMultiChoiceFields(fields, MCN_MULTI_CHOICE_COLUMNS);

  const post = async () => {
    const number = nextMcnNumber((await listMcnNumbers()).map((n) => n.number));
    return graphFetch<GraphListItem>(listPath(), {
      method: "POST",
      body: JSON.stringify({ fields: { ...payload, Title: number } }),
    });
  };
  let created: GraphListItem;
  try {
    created = await post();
  } catch (err) {
    if (!isUniqueValueRejection(err)) throw err;
    created = await post();
  }
  const mcn = (await getMcn(parseInt(created.id, 10))) ?? toMcn(created);
  return settleMcnNumber(mcn);
}

const MAX_RENUMBER_ATTEMPTS = 3;

async function settleMcnNumber(created: Mcn): Promise<Mcn> {
  let mcn = created;
  try {
    for (let attempt = 0; attempt < MAX_RENUMBER_ATTEMPTS; attempt++) {
      const all = await listMcnNumbers();
      const taken = all.some((n) => n.id < mcn.id && sameMcnNumber(n.number, mcn.mcnNumber));
      if (!taken) return mcn;
      const next = nextMcnNumber(all.map((n) => n.number));
      await graphFetch(`${itemPath(mcn.id)}/fields`, { method: "PATCH", body: JSON.stringify({ Title: next }) });
      mcn = { ...mcn, mcnNumber: next };
    }
  } catch (err) {
    throw new McnNumberUnconfirmedError(mcn, err);
  }
  throw new McnNumberUnconfirmedError(mcn);
}

// -----------------------------------------------------------------------------
// Field edits
// -----------------------------------------------------------------------------

async function patchColumns(id: number, fields: Record<string, unknown>): Promise<Mcn> {
  await graphFetch(`${itemPath(id)}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
  const updated = await getMcn(id);
  if (!updated) throw new Error(`MCN ${id} disappeared after update`);
  return updated;
}

function replaceMock(id: number, update: (m: Mcn) => Mcn): Promise<Mcn> {
  const idx = mockStore.findIndex((m) => m.id === id);
  if (idx < 0) throw new Error(`MCN ${id} not found`);
  const next = { ...update(clone(mockStore[idx])), modifiedAt: new Date() };
  mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
  return mockDelay(clone(next));
}

/**
 * Patch content fields, DIFFED against the row the edit started from — only
 * the columns that moved travel. Nothing changed → nothing is sent. Whether
 * the edit is ALLOWED (Draft only, or the implementation card) is the hook's
 * check, made against a fresh read.
 */
export async function updateMcnFields(id: number, changes: McnPatch, previous: Mcn): Promise<Mcn> {
  const fields = buildMcnUpdateFields(changes, previous);
  if (USE_MOCK) return replaceMock(id, (m) => applyMcnPatch(m, changes));
  if (Object.keys(fields).length === 0) return previous;
  return patchColumns(id, annotateMultiChoiceFields(fields, MCN_MULTI_CHOICE_COLUMNS));
}

/**
 * Set (or clear) Originated By or the Assigned Engineer. The engineer also
 * WATCHES it, folded into Watchers in the same PATCH; nobody is ever removed
 * from Watchers here.
 */
export async function setMcnPerson(
  id: number,
  column: "originatedBy" | "assignedEngineer",
  person: Person | null,
): Promise<Mcn> {
  const label = column === "originatedBy" ? "Originated By" : "Assigned Engineer";
  if (USE_MOCK) {
    return replaceMock(id, (m) => ({
      ...m,
      [column]: person,
      watchers: column === "assignedEngineer" ? autoWatchers(m.watchers, person) : m.watchers,
    }));
  }
  const lookupId = await requirePmoLookupId(person, label);
  const spColumn = column === "originatedBy" ? "OriginatedByLookupId" : "AssignedEngineerLookupId";
  const fields: Record<string, unknown> = { [spColumn]: lookupId };
  if (column === "assignedEngineer" && person) {
    const row = await graphFetch<GraphListItem>(`${itemPath(id)}?$expand=fields($select=Watchers)`);
    const watching = await resolvePeopleLookupIds(SITES.pmo, SP_PMO_SITE_URL, [{ ...person, lookupId: lookupId ?? undefined }]);
    Object.assign(fields, multiPersonField("Watchers", autoWatchers(toMcn(row).watchers, watching)));
  }
  return patchColumns(id, fields);
}

/** Replace the Watchers list. */
export async function setMcnWatchers(id: number, people: Person[]): Promise<Mcn> {
  if (USE_MOCK) return replaceMock(id, (m) => ({ ...m, watchers: people }));
  const resolved = await resolvePeopleLookupIds(SITES.pmo, SP_PMO_SITE_URL, people);
  if (people.length > 0 && !resolved.some((p) => p.lookupId)) {
    throw new Error("Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.");
  }
  return patchColumns(id, multiPersonField("Watchers", resolved));
}

/** Link (or unlink) the Operations task — a single lookup on the same site, so a bare integer. */
export async function setMcnOperationsTask(id: number, task: { lookupId: number; title: string } | null): Promise<Mcn> {
  if (USE_MOCK) return replaceMock(id, (m) => ({ ...m, operationsTask: task ? { ...task } : null }));
  return patchColumns(id, { OperationsTaskRefLookupId: task ? task.lookupId : null });
}

// -----------------------------------------------------------------------------
// The workflow
// -----------------------------------------------------------------------------

/** The MCN moved on before this step landed — somebody else got there first. */
export class McnMovedOnError extends Error {
  readonly current: McnStatus;
  constructor(number: string, current: McnStatus) {
    super(`${number || "This MCN"} is already ${current} — somebody else moved it on. The page has been refreshed.`);
    this.name = "McnMovedOnError";
    this.current = current;
  }
}

export interface McnTransitionArgs {
  actor: Person;
  /** Reject and reopen. Goes on the record. */
  reason?: string;
  /** Approve: the final distribution list from the dialog. */
  distributedTo?: Person[];
  /** Implement. */
  dateImplemented?: Date | null;
  affected?: string;
}

function eventHtml(action: McnAction, row: Mcn, args: McnTransitionArgs): string {
  const reason = args.reason?.trim() ? ` ${escapeHtml(args.reason.trim())}` : "";
  switch (action) {
    case "submit":
      return "<p><strong>Submitted for approval.</strong></p>";
    case "approve": {
      const n = args.distributedTo?.length ?? 0;
      return `<p><strong>Approved</strong> and sent to ${n} ${n === 1 ? "person" : "people"}.</p>`;
    }
    case "reject":
      return `<p><strong>Rejected.</strong>${reason}</p>`;
    case "implement":
      return "<p><strong>Marked implemented.</strong></p>";
    case "reopen": {
      const was = row.approvedBy
        ? ` It had been approved by ${escapeHtml(row.approvedBy.displayName)}${
            row.approvedAt ? ` on ${row.approvedAt.toLocaleDateString()}` : ""
          }.`
        : "";
      return `<p><strong>Reopened to Draft.</strong>${reason}${was}</p>`;
    }
  }
}

/**
 * Move an MCN one step. The row is read FRESH and a step from a status it is
 * no longer in is refused (`McnMovedOnError`) — two approvers a minute apart
 * must not both approve. Status, its stamps and a line in the discussion go
 * in ONE PATCH.
 */
export async function transitionMcn(id: number, action: McnAction, args: McnTransitionArgs): Promise<Mcn> {
  const row = await getMcn(id);
  if (!row) throw new Error(`MCN ${id} not found`);
  const { from, to } = MCN_TRANSITIONS[action];
  if (!from.includes(row.status)) throw new McnMovedOnError(row.mcnNumber, row.status);

  const now = new Date();
  const event = { authorName: args.actor.displayName, authorEmail: args.actor.email ?? "", bodyHtml: eventHtml(action, row, args) };

  if (USE_MOCK) {
    return replaceMock(id, (m) => {
      const next: Mcn = {
        ...m,
        status: to,
        comments: [{ timestamp: now, ...event, attachments: [] }, ...m.comments],
      };
      if (action === "approve") {
        next.approvedBy = args.actor;
        next.approvedAt = now;
        next.distributedTo = args.distributedTo ?? [];
        next.distributedAt = now;
        next.rejectionReason = "";
      }
      if (action === "reject") next.rejectionReason = args.reason?.trim() ?? "";
      if (action === "implement") {
        next.dateImplemented = args.dateImplemented ?? null;
        next.affected = args.affected?.trim() ?? m.affected;
      }
      if (action === "reopen") {
        next.approvedBy = null;
        next.approvedAt = null;
        next.distributedTo = [];
        next.distributedAt = null;
      }
      return next;
    });
  }

  const fields: Record<string, unknown> = { McnStatus: to };
  if (action === "approve") {
    fields.ApprovedByLookupId = await requirePmoLookupId(args.actor, "Approved By");
    fields.ApprovedDate = now.toISOString();
    fields.DistributedTo = serializePeopleLines(args.distributedTo ?? []);
    fields.DistributedAt = now.toISOString();
    fields.RejectionReason = "";
  }
  if (action === "reject") fields.RejectionReason = args.reason?.trim() ?? "";
  if (action === "implement") {
    fields.DateImplemented = toSpDateOnly(args.dateImplemented ?? null);
    if (args.affected !== undefined) fields.AffectedCodes = args.affected.trim();
  }
  if (action === "reopen") {
    // The approval no longer applies — it is recorded in the discussion line.
    fields.ApprovedByLookupId = null;
    fields.ApprovedDate = null;
    fields.DistributedTo = "";
    fields.DistributedAt = null;
  }
  fields.Communication = appendComment(await readCommunication(id), event);
  return patchColumns(id, fields);
}

// -----------------------------------------------------------------------------
// Comments — the standard pipe-delimited Communication thread.
// -----------------------------------------------------------------------------

async function readCommunication(id: number): Promise<string> {
  const existing = await graphFetch<GraphListItem>(`${itemPath(id)}?$expand=fields($select=Communication)`);
  return (existing.fields.Communication as string | undefined) ?? "";
}

export async function addMcnComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<Mcn> {
  if (USE_MOCK) {
    return replaceMock(id, (m) => ({
      ...m,
      comments: [{ timestamp: new Date(), ...comment, attachments: [] }, ...m.comments],
    }));
  }
  return patchColumns(id, { Communication: appendComment(await readCommunication(id), comment) });
}

export async function editMcnComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<Mcn> {
  if (USE_MOCK) {
    return replaceMock(id, (m) => ({
      ...m,
      comments: m.comments.map((c) =>
        c.timestamp.getTime() === target.timestamp.getTime() &&
        (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
          ? { ...c, bodyHtml: newBodyHtml }
          : c,
      ),
    }));
  }
  const raw = await readCommunication(id);
  return patchColumns(id, { Communication: replaceComment(raw, target, newBodyHtml) });
}
