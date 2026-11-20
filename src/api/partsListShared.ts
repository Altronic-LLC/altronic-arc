import { graphFetch, graphFetchAll, GraphError } from "./graph";
import { SITES } from "./config";
import type { GraphListItem } from "@/types/task";
import { odataString } from "@/lib/odata";

// =============================================================================
// Shared plumbing for the two Parts List modules (altronicParts.ts and
// altronicComponents.ts) — the reads and writes are identical in shape; only
// the list id and the columns differ.
//
// THE COMMUNICATION FALLBACK. The approval history lives in a `Communication`
// column added by re-running scripts/create-altronic-parts-lists.ps1 — which
// runs separately from any deploy. Selecting a column a list hasn't got 400s
// the WHOLE read, so a deploy landing before the script would blank the entire
// Parts List. So the read asks for Communication, retries ONCE without it on a
// 400, and remembers per list for the rest of the session — the MRB Watchers
// arrangement. Only a 400 counts: a throttle or an outage must not quietly
// read as "the column is missing". An approval while the column is missing is
// refused, naming the script, rather than failing with a bare 400.
// =============================================================================

/** Item-level properties every read asks for — `createdBy` is the submitter. */
export const ITEM_SELECT = "id,createdBy,createdDateTime,lastModifiedDateTime";

const missingCommunication = new Set<string>();

/** Test hook. */
export function __resetPartsListShared() {
  missingCommunication.clear();
}

export function communicationAvailable(listId: string): boolean {
  return !missingCommunication.has(listId);
}

export const COMMUNICATION_MISSING =
  "This list has no Communication column yet, so the approval can't be recorded. " +
  "Run scripts/create-altronic-parts-lists.ps1 to add it, then try again.";

function itemsPath(listId: string): string {
  return `/sites/${SITES.engineering}/lists/${listId}/items`;
}

function selectFor(listId: string, baseSelect: string): string {
  return communicationAvailable(listId) ? `${baseSelect},Communication` : baseSelect;
}

/**
 * Run a read that selects Communication; on a 400, retry ONCE without it and
 * remember the list hasn't got the column. `read` builds its URL from
 * `selectFor`, so the retry asks without it.
 */
async function withCommunicationFallback<T>(listId: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (communicationAvailable(listId) && err instanceof GraphError && err.status === 400) {
      missingCommunication.add(listId);
      try {
        return await read();
      } catch (retryErr) {
        // Both failing means something else is wrong, not that the column is
        // missing — put the flag back and report the original fault.
        missingCommunication.delete(listId);
        throw retryErr;
      }
    }
    throw err;
  }
}

/** Every row on a list, with the Communication fallback. */
export async function readWholeList(listId: string, baseSelect: string): Promise<GraphListItem[]> {
  return withCommunicationFallback(listId, () =>
    graphFetchAll<GraphListItem>(
      `${itemsPath(listId)}?$select=${ITEM_SELECT}&$expand=fields($select=${selectFor(listId, baseSelect)})&$top=999`,
    ),
  );
}

/**
 * Every row whose part number starts with one of these three-digit lists —
 * what a single list's screen needs, instead of the whole list. Filtered by
 * SharePoint on the INDEXED Title column, which it allows past 5,000 rows
 * (list 309 of ~14,000 came back in one ~0.4 s request, 2026-10-26, against
 * ~11 s for the whole Part List). One request per list, in parallel; each
 * still pages, in case a list ever passes 999 parts.
 */
export async function readByPrefixes(listId: string, baseSelect: string, prefixes: string[]): Promise<GraphListItem[]> {
  const pages = await Promise.all(
    prefixes.map((prefix) =>
      withCommunicationFallback(listId, () =>
        graphFetchAll<GraphListItem>(
          `${itemsPath(listId)}?$select=${ITEM_SELECT}&$expand=fields($select=${selectFor(listId, baseSelect)})` +
            `&$filter=startswith(fields/Title,${odataString(prefix)})&$top=999`,
        ),
      ),
    ),
  );
  const seen = new Set<string>();
  return pages.flat().filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

/**
 * Does SharePoint hand this caller ANY row of the list? One row, ids only.
 * A single list coming back empty may simply be empty; the whole list coming
 * back empty is how SharePoint answers an item-level permission problem.
 */
export async function listHasRows(listId: string): Promise<boolean> {
  const res = await graphFetch<{ value: GraphListItem[] }>(`${itemsPath(listId)}?$select=id&$top=1`);
  return (res.value ?? []).length > 0;
}

/** One row, fresh. Null for a 404 — anything else propagates. */
export async function readItem(listId: string, id: number, baseSelect: string): Promise<GraphListItem | null> {
  try {
    return await withCommunicationFallback(listId, () =>
      graphFetch<GraphListItem>(
        `${itemsPath(listId)}/${id}?$select=${ITEM_SELECT}&$expand=fields($select=${selectFor(listId, baseSelect)})`,
      ),
    );
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return null;
    throw err;
  }
}

export async function createItem(listId: string, fields: Record<string, unknown>): Promise<GraphListItem> {
  return graphFetch<GraphListItem>(itemsPath(listId), { method: "POST", body: JSON.stringify({ fields }) });
}

export async function patchItem(listId: string, id: number, fields: Record<string, unknown>): Promise<void> {
  await graphFetch(`${itemsPath(listId)}/${id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
}

/**
 * Is this part number already on the list? Asked of SharePoint itself, on the
 * INDEXED Title column (the create script indexes it) — a filter on an
 * unindexed column is refused past 5,000 rows, and the Part List is ~14,000.
 * Case-insensitive, like SharePoint's own text comparison.
 */
export async function titleExists(listId: string, partNumber: string): Promise<boolean> {
  const res = await graphFetch<{ value: GraphListItem[] }>(
    `${itemsPath(listId)}?$select=id&$filter=fields/Title eq ${odataString(partNumber.trim())}&$top=1`,
  );
  return (res.value ?? []).length > 0;
}

/**
 * Every row holding this part number, with its sign-off — so a create can
 * tell "a live part has this number" (taken) from "a DELETED row holds it"
 * (reuse that row). Same indexed Title filter as `titleExists`.
 */
export async function rowsForTitle(listId: string, partNumber: string): Promise<{ id: number; signOffStatus: string }[]> {
  const res = await graphFetch<{ value: GraphListItem[] }>(
    `${itemsPath(listId)}?$select=id&$expand=fields($select=Title,SignOffStatus)&$filter=fields/Title eq ${odataString(partNumber.trim())}`,
  );
  return (res.value ?? []).map((item) => ({
    id: parseInt(item.id, 10),
    signOffStatus: typeof item.fields?.SignOffStatus === "string" ? item.fields.SignOffStatus : "",
  }));
}

/** Thrown when a delete is asked for something it can't do (already deleted, has attachments…). */
export class PartDeleteRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartDeleteRefusedError";
  }
}

/** Thrown when a new part's number is already taken. */
export class PartNumberTakenError extends Error {
  constructor(public partNumber: string) {
    super(`${partNumber} is already on the parts list.`);
    this.name = "PartNumberTakenError";
  }
}

/** Thrown when an approval finds the part no longer waiting on that step. */
export class StaleApprovalError extends Error {
  constructor(public current: string | null) {
    super(
      current
        ? `This part has already moved on — it's now ${current}. Refresh to see the latest.`
        : "This part isn't waiting on an approval.",
    );
    this.name = "StaleApprovalError";
  }
}
