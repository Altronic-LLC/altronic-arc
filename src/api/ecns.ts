import { GraphError, graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_ECNS_LIST_ID, USE_MOCK } from "./config";
import type { Ecn, EcnInput, GraphListItem } from "@/types/task";
import { buildEcnCreateFields, compareEcns, toEcn } from "@/lib/ecnMapper";
import { ECN_FIELDS, ECN_SELECT, ECN_SELECT_WITH_DISTRIBUTION } from "@/lib/ecnFields";
import {
  ECN_DISTRIBUTION_COLUMNS,
  ECN_MULTI_CHOICE_COLUMNS,
  orderDistribution,
} from "@/lib/ecnDistribution";
import { annotateMultiChoiceFields } from "@/lib/graphFields";
import { parsePeopleLines } from "@/lib/peopleLines";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { MOCK_ECNS } from "@/data/ecnMockData";
import { mockDelay } from "./mockLatency";

// =============================================================================
// ECNs (Engineering Change Notices) — the record of a change to a released
// product, on the Engineering site.
//
// **Delete exists, and is ADMIN-ONLY** (Ray, 2026-09-28). An ECN is a
// controlled record, so a superseded notice is still REVISED (a new row whose
// Log# carries an `R` suffix), not deleted — delete is for a row that should
// never have existed (a duplicate, a test entry). The admin check lives in
// `useDeleteEcn`'s mutationFn, not only on the button, so a future screen
// can't reach this ungated. `ecns.test.ts` asserts exactly ONE delete export.
//
// **1,813 rows**, well under SharePoint's 5,000-item threshold, so the list is
// fetched whole and filtered in the browser — which is what makes searching
// the Detailed Description for a part number possible at all. The table caps
// what it renders; the filtering runs over everything.
//
// The read asks for `createdBy` explicitly alongside the field selection:
// `submittedBy` is Graph's item-level creator, not a column, because the list
// has no requester column to read.
//
// **The distribution columns may not exist yet** (BusinessIT#57).
// `Distribution`, `DistributedTo` and `DistributedAt` are added by
// scripts/create-ecn-distribution.ps1, which runs separately from a deploy —
// and selecting a column a list hasn't got 400s the WHOLE read, which would
// blank all 1,800 ECNs. So a read asks for them and, on a 400, retries once
// without them and remembers (the MRB Watchers arrangement). Only a 400 is
// retried: a throttle, a 401 or an outage must not read as "no distribution".
// =============================================================================

let mockStore: Ecn[] = MOCK_ECNS.map((e) => ({ ...e }));

/**
 * Does the ECN list have the distribution columns? `null` = not established
 * yet; `false` once a read asking for them was refused and the slim read
 * then succeeded.
 */
let distributionColumns: boolean | null = null;

/** Whether distribution can be read or written at all. The UI asks before offering it. */
export function ecnDistributionAvailable(): boolean {
  return USE_MOCK || distributionColumns !== false;
}

/** Test seam: mock mode mutates a module-level array, which leaks between tests. */
export function __resetEcnsForTests(): void {
  mockStore = MOCK_ECNS.map((e) => ({ ...e }));
  distributionColumns = null;
}

/**
 * Run a read, retrying without the distribution columns if asking for them
 * is refused as a bad request. Concludes they're missing only once the slim
 * read SUCCEEDS — both failing means something else is wrong.
 */
async function withDistributionFallback<T>(read: (select: string) => Promise<T>): Promise<T> {
  if (distributionColumns === false) return read(ECN_SELECT);
  try {
    const result = await read(ECN_SELECT_WITH_DISTRIBUTION);
    distributionColumns = true;
    return result;
  } catch (err) {
    if (distributionColumns !== null || !(err instanceof GraphError) || err.status !== 400) throw err;
    const result = await read(ECN_SELECT);
    distributionColumns = false;
    console.warn(
      "[ecns] The ECN list has no distribution columns yet — run scripts/create-ecn-distribution.ps1.",
    );
    return result;
  }
}

/** Refuses a write naming a distribution column while the list hasn't got them. */
function requireDistributionColumns(fields: Record<string, unknown>): void {
  if (distributionColumns !== false) return;
  if (ECN_DISTRIBUTION_COLUMNS.some((c) => c in fields)) {
    throw new Error(
      "ECN distribution isn't set up on the ECN list yet — run scripts/create-ecn-distribution.ps1.",
    );
  }
}

function requireListId(action: string): string {
  if (!SP_ECNS_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_ECNS_LIST_ID is not set.`);
  }
  return SP_ECNS_LIST_ID;
}

function itemPath(id: number): string {
  return `/sites/${SITES.engineering}/lists/${requireListId("reach the ECN")}/items/${id}`;
}

/** Item-level properties worth carrying — `createdBy` is the submitter. */
const ITEM_SELECT = "id,createdBy,createdDateTime,lastModifiedDateTime";

/** Every ECN, newest Log# first. */
export async function listEcns(): Promise<Ecn[]> {
  if (USE_MOCK) {
    return mockDelay([...mockStore].sort(compareEcns).map((e) => ({ ...e })));
  }
  const listId = requireListId("load ECNs");
  const items = await withDistributionFallback((select) =>
    graphFetchAll<GraphListItem>(
      `/sites/${SITES.engineering}/lists/${listId}/items` +
        `?$select=${ITEM_SELECT}&$expand=fields($select=${select})&$top=999`,
    ),
  );
  return items.map(toEcn).sort(compareEcns);
}

export async function getEcn(id: number): Promise<Ecn | null> {
  if (USE_MOCK) {
    const found = mockStore.find((e) => e.id === id);
    return mockDelay(found ? { ...found } : null);
  }
  try {
    const item = await withDistributionFallback((select) =>
      graphFetch<GraphListItem>(`${itemPath(id)}?$select=${ITEM_SELECT}&$expand=fields($select=${select})`),
    );
    return toEcn(item);
  } catch {
    return null;
  }
}

export async function createEcn(input: EcnInput, actor?: { displayName: string; email?: string }): Promise<Ecn> {
  if (USE_MOCK) {
    const now = new Date();
    const ecn: Ecn = {
      id: Math.max(0, ...mockStore.map((e) => e.id)) + 1,
      title: input.title.trim(),
      logNo: input.logNo.trim(),
      parentProject: input.projectLookupId
        ? { lookupId: input.projectLookupId, title: "" }
        : null,
      // Real mode gets this from Graph's createdBy; mock mode fills in the
      // signed-in user so the "comments reach the submitter" rule is
      // demonstrable against mock data.
      submittedBy: actor ? { displayName: actor.displayName, email: actor.email } : null,
      comments: [],
      hasAttachments: false,
      values: { ...input.values },
      distribution: orderDistribution(input.distribution ?? []),
      distributedTo: [],
      distributedAt: null,
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [ecn, ...mockStore];
    return mockDelay(ecn);
  }

  const listId = requireListId("create the ECN");
  const fields = buildEcnCreateFields(input);
  // The ticks can't be stored on a list without the column — the ECN is
  // still raised, rather than refused over its distribution.
  if (distributionColumns === false) delete fields.Distribution;
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items`,
    {
      method: "POST",
      body: JSON.stringify({ fields: annotateMultiChoiceFields(fields, ECN_MULTI_CHOICE_COLUMNS) }),
    },
  );
  return (await getEcn(parseInt(created.id, 10))) ?? toEcn(created);
}

/**
 * Patch columns by their SharePoint names — the detail page's inline editors
 * each own one column, and `patch` on the hook side keeps the cache in step.
 */
export async function updateEcnFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<Ecn> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`ECN ${id} not found`);
    const next: Ecn = {
      ...mockStore[idx],
      values: { ...mockStore[idx].values },
      modifiedAt: new Date(),
    };
    applyMockFields(next, fields);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return mockDelay({ ...next });
  }

  requireDistributionColumns(fields);
  // Distribution is MULTI-choice: a bare array is a bare 400 invalidRequest.
  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify(annotateMultiChoiceFields(fields, ECN_MULTI_CHOICE_COLUMNS)),
  });
  const updated = await getEcn(id);
  if (!updated) throw new Error(`ECN ${id} disappeared after update`);
  return updated;
}

/** Mock-mode equivalent of the PATCH — mirrors the real column names. */
function applyMockFields(next: Ecn, fields: Record<string, unknown>) {
  if ("Title" in fields) next.title = String(fields.Title ?? "");
  if ("field_2" in fields) next.logNo = String(fields.field_2 ?? "");
  if ("Distribution" in fields) {
    next.distribution = orderDistribution(Array.isArray(fields.Distribution) ? (fields.Distribution as string[]) : []);
  }
  if ("DistributedTo" in fields) next.distributedTo = parsePeopleLines(fields.DistributedTo);
  if ("DistributedAt" in fields) {
    next.distributedAt = typeof fields.DistributedAt === "string" ? new Date(fields.DistributedAt) : null;
  }
  if ("ProjectReferenceLookupId" in fields) {
    const lookupId = fields.ProjectReferenceLookupId;
    next.parentProject =
      typeof lookupId === "number" ? { lookupId, title: "" } : null;
  }
  for (const [column, value] of Object.entries(fields)) {
    const field = ECN_COLUMN_FIELDS[column];
    if (!field) continue;
    next.values[field.key] =
      field.kind === "boolean" ? (value === true ? "Yes" : "") : String(value ?? "");
  }
}

/** column → descriptor, for the mock branch. */
const ECN_COLUMN_FIELDS: Record<string, (typeof ECN_FIELDS)[number]> = Object.fromEntries(
  ECN_FIELDS.map((f) => [f.column, f]),
);

/** Append a comment to the ECN's Communication field. */
export async function addEcnComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<Ecn> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`ECN ${id} not found`);
    const next: Ecn = {
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
    return mockDelay({ ...next });
  }

  // Read-modify-write on one field, the same as every other comment thread —
  // the whole Communication value is rewritten, so a comment posted between
  // the read and the write would be lost. Same window the other six live with.
  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateEcnFields(id, { Communication: appendComment(existingRaw, comment) });
}

/** Edit one existing comment, matched on its timestamp + author. */
export async function editEcnComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<Ecn> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`ECN ${id} not found`);
    const next: Ecn = {
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
    return mockDelay({ ...next });
  }

  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateEcnFields(id, {
    Communication: replaceComment(existingRaw, target, newBodyHtml),
  });
}

/**
 * Delete one ECN. ADMIN-ONLY — call it through `useDeleteEcn`, which checks.
 *
 * Its ECN Checklist row (if any) is deliberately left in place: that list has
 * no delete by design, and an orphaned checklist appears on no ECN's page.
 */
export async function deleteEcn(id: number): Promise<void> {
  if (USE_MOCK) {
    const before = mockStore.length;
    mockStore = mockStore.filter((e) => e.id !== id);
    if (mockStore.length === before) throw new Error(`ECN ${id} not found`);
    await mockDelay(undefined);
    return;
  }
  await graphFetch(itemPath(id), { method: "DELETE" });
}
