import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PRICING_ROLES_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type { PricingRole, PricingRoleEntry } from "@/types/pricing";
import {
  PRICING_ROLE_SELECT,
  buildPricingRoleFields,
  toPricingRoleEntry,
  type PricingRoleInput,
} from "@/lib/pricingMapper";
import { parsePricingRoles } from "@/lib/pricingRoles";
import { nextPricingMockId, pricingMockClone, pricingMockDb } from "@/data/pricingMockData";

// =============================================================================
// Pricing Roles — who may use Sales Pricing (ALTRONICSALESTEAM). Title =
// email, plus `PersonName`, `Roles` (lowercase CSV of requester / manager /
// admin) and `Note`. The Quote Roles shape exactly.
//
// The name column is `PersonName`, NOT `DisplayName` — Graph silently drops a
// listItem field called DisplayName. What each tag allows lives in
// lib/pricingRoles.ts; this module only stores them. Rows CAN be deleted: a
// person with no tags is nobody to this list.
// =============================================================================

function listPath(): string {
  return `/sites/${SITES.salesTeam}/lists/${SP_PRICING_ROLES_LIST_ID}/items`;
}

/** Everyone on the list. */
export async function listPricingRoleEntries(): Promise<PricingRoleEntry[]> {
  if (USE_MOCK) return mockDelay(pricingMockClone(pricingMockDb.roles));
  const items = await graphFetchAll<GraphListItem>(
    `${listPath()}?$expand=fields($select=${PRICING_ROLE_SELECT})&$top=500`,
  );
  return items.map(toPricingRoleEntry);
}

export async function createPricingRoleEntry(input: PricingRoleInput): Promise<PricingRoleEntry> {
  if (USE_MOCK) {
    const entry: PricingRoleEntry = {
      id: nextPricingMockId(pricingMockDb.roles),
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      roles: parsePricingRoles([...input.roles]),
      note: input.note.trim(),
    };
    pricingMockDb.roles.push(entry);
    return mockDelay(pricingMockClone(entry));
  }
  const created = await graphFetch<GraphListItem>(listPath(), {
    method: "POST",
    body: JSON.stringify({ fields: buildPricingRoleFields(input) }),
  });
  return toPricingRoleEntry(created);
}

/** Only the keys given are written. */
export async function updatePricingRoleEntry(input: {
  id: number;
  displayName?: string;
  roles?: PricingRole[];
  note?: string;
}): Promise<void> {
  if (USE_MOCK) {
    const entry = pricingMockDb.roles.find((e) => e.id === input.id);
    if (entry) {
      if (input.displayName !== undefined) entry.displayName = input.displayName.trim();
      if (input.roles !== undefined) entry.roles = parsePricingRoles([...input.roles]);
      if (input.note !== undefined) entry.note = input.note.trim();
    }
    await mockDelay(null);
    return;
  }
  const { id, ...changes } = input;
  const fields = buildPricingRoleFields(changes);
  if (Object.keys(fields).length === 0) return;
  await graphFetch(`${listPath()}/${id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
}

/** Take somebody off the list. */
export async function deletePricingRoleEntry(id: number): Promise<void> {
  if (USE_MOCK) {
    pricingMockDb.roles = pricingMockDb.roles.filter((e) => e.id !== id);
    await mockDelay(null);
    return;
  }
  await graphFetch(`${listPath()}/${id}`, { method: "DELETE" });
}
