import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_ECN_DISTRIBUTION_GROUPS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { EcnDistributionGroup, GraphListItem, Person } from "@/types/task";
import { parsePeopleLines, serializePeopleLines } from "@/lib/peopleLines";
import { MOCK_ECN_DISTRIBUTION_GROUPS } from "@/data/ecnMockData";

// =============================================================================
// ECN Distribution Groups (BusinessIT#57) — one row per role on the ECN form's
// DISTRIBUTION block, and who receives an ECN for it. Engineering site, beside
// the ECNs list. The MCN Distribution Groups shape exactly, but its OWN list:
// re-pointing who gets an ECN must never re-point who gets an MCN.
//
// Title = the role, `Members` (one "Name <email>" per line — lib/peopleLines.ts
// says why not a person column), `SortOrder`. The ten rows are seeded by
// scripts/create-ecn-distribution.ps1; ARC edits their members and never adds
// or deletes a group. ARC admins manage it (the hook asks).
// =============================================================================

let mockGroups: EcnDistributionGroup[] = cloneGroups(MOCK_ECN_DISTRIBUTION_GROUPS);

function cloneGroups(groups: EcnDistributionGroup[]): EcnDistributionGroup[] {
  return groups.map((g) => ({ ...g, members: g.members.map((p) => ({ ...p })) }));
}

/** For tests: put the mock store back. */
export function __resetEcnDistributionGroupsMockStore(): void {
  mockGroups = cloneGroups(MOCK_ECN_DISTRIBUTION_GROUPS);
}

/** Whether the list is configured — mock mode always is. */
export function ecnDistributionGroupsConfigured(): boolean {
  return USE_MOCK || !!SP_ECN_DISTRIBUTION_GROUPS_LIST_ID;
}

function groupsPath(): string {
  if (!SP_ECN_DISTRIBUTION_GROUPS_LIST_ID) {
    throw new Error(
      "ECN Distribution Groups isn't set up yet: VITE_SP_ECN_DISTRIBUTION_GROUPS_LIST_ID is not set.",
    );
  }
  return `/sites/${SITES.engineering}/lists/${SP_ECN_DISTRIBUTION_GROUPS_LIST_ID}/items`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function toEcnDistributionGroup(item: GraphListItem): EcnDistributionGroup {
  const f = item.fields ?? {};
  const order = typeof f.SortOrder === "number" ? f.SortOrder : parseFloat(text(f.SortOrder));
  return {
    id: parseInt(item.id, 10),
    role: text(f.Title).trim(),
    members: parsePeopleLines(f.Members),
    sortOrder: Number.isFinite(order) ? order : 999,
  };
}

/** Every group, in the form's order. An unset list reads as empty — nobody is set up. */
export async function listEcnDistributionGroups(): Promise<EcnDistributionGroup[]> {
  if (USE_MOCK) return mockDelay(cloneGroups(mockGroups));
  if (!SP_ECN_DISTRIBUTION_GROUPS_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${groupsPath()}?$expand=fields($select=Title,Members,SortOrder)&$top=100`,
  );
  return items.map(toEcnDistributionGroup).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Replace a group's members. */
export async function setEcnDistributionGroupMembers(id: number, members: Person[]): Promise<void> {
  if (USE_MOCK) {
    if (!mockGroups.some((g) => g.id === id)) throw new Error(`Distribution group ${id} not found`);
    mockGroups = mockGroups.map((g) =>
      g.id === id ? { ...g, members: parsePeopleLines(serializePeopleLines(members)) } : g,
    );
    await mockDelay(null);
    return;
  }
  await graphFetch(`${groupsPath()}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ Members: serializePeopleLines(members) }),
  });
}
