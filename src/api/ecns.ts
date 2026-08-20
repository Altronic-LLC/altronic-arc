import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_ECNS_LIST_ID, USE_MOCK } from "./config";
import type { Ecn, EcnInput, GraphListItem } from "@/types/task";
import { buildEcnCreateFields, compareEcns, toEcn } from "@/lib/ecnMapper";
import { ECN_FIELDS, ECN_SELECT } from "@/lib/ecnFields";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { MOCK_ECNS } from "@/data/ecnMockData";

// =============================================================================
// ECNs (Engineering Change Notices) — the record of a change to a released
// product, on the Engineering site.
//
// **There is no delete**, in the UI or here — an ECN is a controlled record of
// a change that was made, and a superseded notice is revised (a new row whose
// Log# carries an `R` suffix), never removed. `ecns.test.ts` asserts this
// module exports nothing matching /delete|remove/.
//
// **1,813 rows**, well under SharePoint's 5,000-item threshold, so the list is
// fetched whole and filtered in the browser — which is what makes searching
// the Detailed Description for a part number possible at all. The table caps
// what it renders; the filtering runs over everything.
//
// The read asks for `createdBy` explicitly alongside the field selection:
// `submittedBy` is Graph's item-level creator, not a column, because the list
// has no requester column to read.
// =============================================================================

let mockStore: Ecn[] = MOCK_ECNS.map((e) => ({ ...e }));

function delay<T>(value: T, ms = 200): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
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
    return delay([...mockStore].sort(compareEcns).map((e) => ({ ...e })));
  }
  const listId = requireListId("load ECNs");
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items` +
      `?$select=${ITEM_SELECT}&$expand=fields($select=${ECN_SELECT})&$top=999`,
  );
  return items.map(toEcn).sort(compareEcns);
}

export async function getEcn(id: number): Promise<Ecn | null> {
  if (USE_MOCK) {
    const found = mockStore.find((e) => e.id === id);
    return delay(found ? { ...found } : null);
  }
  try {
    const item = await graphFetch<GraphListItem>(
      `${itemPath(id)}?$select=${ITEM_SELECT}&$expand=fields($select=${ECN_SELECT})`,
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
      createdAt: now,
      modifiedAt: now,
    };
    mockStore = [ecn, ...mockStore];
    return delay(ecn);
  }

  const listId = requireListId("create the ECN");
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items`,
    { method: "POST", body: JSON.stringify({ fields: buildEcnCreateFields(input) }) },
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
    return delay({ ...next });
  }

  await graphFetch(`${itemPath(id)}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  const updated = await getEcn(id);
  if (!updated) throw new Error(`ECN ${id} disappeared after update`);
  return updated;
}

/** Mock-mode equivalent of the PATCH — mirrors the real column names. */
function applyMockFields(next: Ecn, fields: Record<string, unknown>) {
  if ("Title" in fields) next.title = String(fields.Title ?? "");
  if ("field_2" in fields) next.logNo = String(fields.field_2 ?? "");
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
    return delay({ ...next });
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
    return delay({ ...next });
  }

  const existing = await graphFetch<GraphListItem>(
    `${itemPath(id)}?$expand=fields($select=Communication)`,
  );
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  return updateEcnFields(id, {
    Communication: replaceComment(existingRaw, target, newBodyHtml),
  });
}
