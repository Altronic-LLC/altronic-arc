import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_QUALITY_FIXTURE_ROLES_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import type {
  QualityFixtureRole,
  QualityFixtureRoleEntry,
  QualityFixtureRoleInput,
} from "@/types/qualityFixture";
import { parseQualityFixtureRoles, serializeQualityFixtureRoles } from "@/lib/qualityFixtureRoles";
import { MOCK_QUALITY_FIXTURE_ROLES } from "@/data/qualityFixtureMockData";

// =============================================================================
// Quality Fixture Roles — who may change the Quality Fixture Log. On
// Altronic_PMO, managed in ARC at /quality/fixtures/roles by a Fixture Log
// admin or an ARC admin.
//
// Title = email, `PersonName` (NEVER `DisplayName` — Graph silently drops a
// listItem field of that name), `Roles` (lowercase CSV: editor, admin),
// `Note`. Rows CAN be deleted: a person with no tags is nobody to this list.
// =============================================================================

let mockRoles: QualityFixtureRoleEntry[] = clone(MOCK_QUALITY_FIXTURE_ROLES);

function clone(entries: QualityFixtureRoleEntry[]): QualityFixtureRoleEntry[] {
  return entries.map((e) => ({ ...e, roles: [...e.roles] }));
}

/** For tests: put the mock store back. */
export function __resetQualityFixtureRolesMockStore(): void {
  mockRoles = clone(MOCK_QUALITY_FIXTURE_ROLES);
}

function rolesPath(): string {
  if (!SP_QUALITY_FIXTURE_ROLES_LIST_ID) {
    throw new Error(
      "Quality Fixture Roles isn't set up yet: VITE_SP_QUALITY_FIXTURE_ROLES_LIST_ID is not set.",
    );
  }
  return `/sites/${SITES.pmo}/lists/${SP_QUALITY_FIXTURE_ROLES_LIST_ID}/items`;
}

function text(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}

export function toQualityFixtureRoleEntry(item: GraphListItem): QualityFixtureRoleEntry {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    email: text(f.Title).trim().toLowerCase(),
    displayName: text(f.PersonName).trim(),
    roles: parseQualityFixtureRoles(f.Roles),
    note: text(f.Note).trim(),
  };
}

/** Everyone on the list. An unset list reads as empty — nobody edits. */
export async function listQualityFixtureRoleEntries(): Promise<QualityFixtureRoleEntry[]> {
  if (USE_MOCK) return mockDelay(clone(mockRoles));
  if (!SP_QUALITY_FIXTURE_ROLES_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${rolesPath()}?$expand=fields($select=Title,PersonName,Roles,Note)&$top=500`,
  );
  return items.map(toQualityFixtureRoleEntry);
}

export async function createQualityFixtureRoleEntry(
  input: QualityFixtureRoleInput,
): Promise<QualityFixtureRoleEntry> {
  const email = input.email.trim().toLowerCase();
  if (USE_MOCK) {
    if (mockRoles.some((e) => e.email === email)) {
      throw new Error(`${email} is already on the Quality Fixture Roles list.`);
    }
    const entry: QualityFixtureRoleEntry = {
      id: Math.max(0, ...mockRoles.map((e) => e.id)) + 1,
      email,
      displayName: input.displayName.trim(),
      roles: parseQualityFixtureRoles([...input.roles]),
      note: input.note.trim(),
    };
    mockRoles = [...mockRoles, entry];
    return mockDelay({ ...entry, roles: [...entry.roles] });
  }
  const created = await graphFetch<GraphListItem>(rolesPath(), {
    method: "POST",
    body: JSON.stringify({
      fields: {
        Title: email,
        PersonName: input.displayName.trim(),
        Roles: serializeQualityFixtureRoles(input.roles),
        Note: input.note.trim(),
      },
    }),
  });
  return toQualityFixtureRoleEntry(created);
}

/** Only the keys given are written. */
export async function updateQualityFixtureRoleEntry(input: {
  id: number;
  roles?: QualityFixtureRole[];
  note?: string;
}): Promise<void> {
  if (USE_MOCK) {
    mockRoles = mockRoles.map((e) =>
      e.id === input.id
        ? {
            ...e,
            ...(input.roles !== undefined && { roles: parseQualityFixtureRoles([...input.roles]) }),
            ...(input.note !== undefined && { note: input.note.trim() }),
          }
        : e,
    );
    await mockDelay(null);
    return;
  }
  const fields: Record<string, unknown> = {};
  if (input.roles !== undefined) fields.Roles = serializeQualityFixtureRoles(input.roles);
  if (input.note !== undefined) fields.Note = input.note.trim();
  if (Object.keys(fields).length === 0) return;
  await graphFetch(`${rolesPath()}/${input.id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
}

export async function deleteQualityFixtureRoleEntry(id: number): Promise<void> {
  if (USE_MOCK) {
    mockRoles = mockRoles.filter((e) => e.id !== id);
    await mockDelay(null);
    return;
  }
  await graphFetch(`${rolesPath()}/${id}`, { method: "DELETE" });
}
