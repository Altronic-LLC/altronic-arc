import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_QUOTE_ROLES_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { QuoteRole, QuoteRoleEntry } from "@/types/quote";
import {
  QUOTE_ROLE_SELECT,
  buildQuoteRoleCreateFields,
  buildQuoteRoleUpdateFields,
  toQuoteRoleEntry,
  type QuoteRoleInput,
} from "@/lib/quoteMapper";
import { parseQuoteRoles } from "@/lib/quoteRoles";
import { nextMockId, quoteMockClone, quoteMockDb } from "@/data/quoteMockData";

// =============================================================================
// Quote Roles — who may see and work the Insourcing Quotes tool (PMO site).
// The Parts Roles shape: Title = email, plus `PersonName`, `Roles` (lowercase
// CSV of viewer / quoter / manager) and `Note`.
//
// THE NAME COLUMN IS `PersonName`, NOT `DisplayName`: Graph silently drops a
// listItem field called DisplayName (accepted with a 2xx, nothing stored).
//
// UNSET LIST ID = NO ACCESS. Reads return `[]` (nobody holds a role) and every
// write refuses with the env var named, rather than pretending to succeed.
// What each tag allows lives in lib/quoteRoles.ts — this module only stores
// them. Rows CAN be deleted: a person with no tags is nobody to this list.
// =============================================================================

const NOT_SET = "the Quote Roles list isn't configured (VITE_SP_QUOTE_ROLES_LIST_ID is not set).";

function listPath(listId: string): string {
  return `/sites/${SITES.pmo}/lists/${listId}/items`;
}

/** Everyone on the list. `[]` when the list isn't configured. */
export async function listQuoteRoleEntries(): Promise<QuoteRoleEntry[]> {
  if (USE_MOCK) return mockDelay(quoteMockDb.roles.map(quoteMockClone.role));
  if (!SP_QUOTE_ROLES_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${listPath(SP_QUOTE_ROLES_LIST_ID)}?$expand=fields($select=${QUOTE_ROLE_SELECT})&$top=500`,
  );
  return items.map(toQuoteRoleEntry);
}

export async function createQuoteRoleEntry(input: QuoteRoleInput): Promise<QuoteRoleEntry> {
  if (USE_MOCK) {
    const entry: QuoteRoleEntry = {
      id: nextMockId(quoteMockDb.roles),
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      roles: parseQuoteRoles([...input.roles]),
      note: input.note.trim(),
    };
    quoteMockDb.roles.push(entry);
    return mockDelay(quoteMockClone.role(entry));
  }
  if (!SP_QUOTE_ROLES_LIST_ID) throw new Error(`Can't add that person: ${NOT_SET}`);
  const created = await graphFetch<GraphListItem>(listPath(SP_QUOTE_ROLES_LIST_ID), {
    method: "POST",
    body: JSON.stringify({ fields: buildQuoteRoleCreateFields(input) }),
  });
  return toQuoteRoleEntry(created);
}

/** Only the keys given are written. */
export async function updateQuoteRoleEntry(input: {
  id: number;
  displayName?: string;
  roles?: QuoteRole[];
  note?: string;
}): Promise<void> {
  if (USE_MOCK) {
    const entry = quoteMockDb.roles.find((e) => e.id === input.id);
    if (entry) {
      if (input.displayName !== undefined) entry.displayName = input.displayName.trim();
      if (input.roles !== undefined) entry.roles = parseQuoteRoles([...input.roles]);
      if (input.note !== undefined) entry.note = input.note.trim();
    }
    await mockDelay(null);
    return;
  }
  if (!SP_QUOTE_ROLES_LIST_ID) throw new Error(`Can't update that person: ${NOT_SET}`);
  const { id, ...changes } = input;
  const fields = buildQuoteRoleUpdateFields(changes);
  if (Object.keys(fields).length === 0) return;
  await graphFetch(`${listPath(SP_QUOTE_ROLES_LIST_ID)}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

/** Take somebody off the list. */
export async function deleteQuoteRoleEntry(id: number): Promise<void> {
  if (USE_MOCK) {
    quoteMockDb.roles = quoteMockDb.roles.filter((e) => e.id !== id);
    await mockDelay(null);
    return;
  }
  if (!SP_QUOTE_ROLES_LIST_ID) throw new Error(`Can't remove that person: ${NOT_SET}`);
  await graphFetch(`${listPath(SP_QUOTE_ROLES_LIST_ID)}/${id}`, { method: "DELETE" });
}
