import type { GraphListItem, PartsRole, PartsRoleEntry } from "@/types/task";
import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PARTS_ROLES_LIST_ID, USE_MOCK } from "./config";
import { parsePartsRoles, serializePartsRoles } from "@/lib/partsRoles";

// =============================================================================
// Parts Roles list — who may add, edit and approve parts on the Altronic Part
// and Component Lists (Tim, 2026-09-28). The EIR Roles shape: Title = email,
// plus a name, Roles (a lowercase CSV of tags) and Note. Created by
// scripts/create-altronic-parts-lists.ps1; managed at /admin/parts-roles.
//
// THE NAME COLUMN IS `PersonName`, NOT `DisplayName`. Graph silently DROPS a
// listItem field called DisplayName: the POST/PATCH is accepted with a 2xx and
// nothing is stored, and the field never comes back on a read (found live
// 2026-09-28 — and the EIR Roles list, which uses DisplayName, turned out to
// have no name saved on any of its 22 rows). The list still carries an empty
// DisplayName column from its first creation; nothing reads or writes it.
//
// What each tag allows lives in lib/partsRoles.ts — this module only stores
// them. Unset list id = the write side is OFF (see config.ts), so every write
// here refuses rather than pretending to succeed.
// =============================================================================

// Mock mode: the people the 2023 guide names, plus the demo user holding every
// tag so the whole approval chain can be walked in a demo.
let mockStore: PartsRoleEntry[] = [
  {
    id: 1,
    email: "demo.user@altronic-llc.com",
    displayName: "Demo User",
    roles: ["editor", "hco editor", "reviewing engineer", "sap admin"],
    note: "Mock-mode default user — every tag, so the demo can walk the whole approval chain",
  },
  {
    id: 2,
    email: "glenn.terry@altronic-llc.com",
    displayName: "Glenn Terry",
    roles: ["editor", "hco editor", "reviewing engineer"],
    note: "Reviewing Engineer",
  },
  {
    id: 3,
    email: "brandon.mirto@altronic-llc.com",
    displayName: "Brandon Mirto",
    roles: ["editor", "hco editor", "reviewing engineer"],
    note: "Reviewing Engineer",
  },
  {
    id: 4,
    email: "sheila.horn@altronic-llc.com",
    displayName: "Sheila Horn",
    roles: ["sap admin"],
    note: "Reviewing Admin — adds new parts to SAP",
  },
];

/** Test hook: put the mock store back to its fixtures. */
export function __resetPartsRolesMockStore(entries?: PartsRoleEntry[]) {
  mockStore = (entries ?? INITIAL_MOCK).map((e) => ({ ...e, roles: [...e.roles] }));
}
const INITIAL_MOCK = mockStore.map((e) => ({ ...e, roles: [...e.roles] }));

function delay<T>(value: T, ms = 60): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function text(f: Record<string, unknown>, key: string): string {
  const v = f[key];
  return typeof v === "string" ? v.trim() : "";
}

function toEntry(item: GraphListItem): PartsRoleEntry {
  const f = item.fields as Record<string, unknown>;
  return {
    id: parseInt(item.id, 10),
    email: text(f, "Title"),
    displayName: text(f, "PersonName"),
    roles: parsePartsRoles(f.Roles),
    note: text(f, "Note"),
  };
}

const NOT_SET = "the Parts Roles list isn't configured (VITE_SP_PARTS_ROLES_LIST_ID is not set).";

function listPath(): string {
  return `/sites/${SITES.engineering}/lists/${SP_PARTS_ROLES_LIST_ID}/items`;
}

export async function listPartsRoles(): Promise<PartsRoleEntry[]> {
  if (USE_MOCK) return delay(mockStore.map((e) => ({ ...e, roles: [...e.roles] })));
  if (!SP_PARTS_ROLES_LIST_ID) return [];
  const items = await graphFetchAll<GraphListItem>(
    `${listPath()}?$expand=fields($select=Title,PersonName,Roles,Note)&$top=200`,
  );
  return items.map(toEntry);
}

export interface PartsRoleInput {
  email: string;
  displayName: string;
  roles: PartsRole[];
  note: string;
}

export async function addPartsRole(input: PartsRoleInput): Promise<PartsRoleEntry> {
  const email = input.email.trim().toLowerCase();
  if (USE_MOCK) {
    const entry: PartsRoleEntry = {
      id: Math.max(0, ...mockStore.map((e) => e.id)) + 1,
      email,
      displayName: input.displayName.trim(),
      roles: parsePartsRoles(serializePartsRoles(input.roles)),
      note: input.note.trim(),
    };
    mockStore.push(entry);
    return delay({ ...entry, roles: [...entry.roles] });
  }
  if (!SP_PARTS_ROLES_LIST_ID) throw new Error(`Can't add that person: ${NOT_SET}`);
  const fields: Record<string, string> = { Title: email, Roles: serializePartsRoles(input.roles) };
  if (input.displayName.trim()) fields.PersonName = input.displayName.trim();
  if (input.note.trim()) fields.Note = input.note.trim();
  const created = await graphFetch<GraphListItem>(listPath(), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return toEntry(created);
}

export async function updatePartsRole(input: {
  id: number;
  displayName?: string;
  roles?: PartsRole[];
  note?: string;
}): Promise<void> {
  if (USE_MOCK) {
    const entry = mockStore.find((e) => e.id === input.id);
    if (entry) {
      if (input.displayName !== undefined) entry.displayName = input.displayName;
      if (input.roles !== undefined) entry.roles = parsePartsRoles(serializePartsRoles(input.roles));
      if (input.note !== undefined) entry.note = input.note;
    }
    await delay(null);
    return;
  }
  if (!SP_PARTS_ROLES_LIST_ID) throw new Error(`Can't update that person: ${NOT_SET}`);
  const fields: Record<string, string> = {};
  if (input.displayName !== undefined) fields.PersonName = input.displayName;
  if (input.roles !== undefined) fields.Roles = serializePartsRoles(input.roles);
  if (input.note !== undefined) fields.Note = input.note;
  await graphFetch(`${listPath()}/${input.id}/fields`, { method: "PATCH", body: JSON.stringify(fields) });
}

/**
 * Take somebody off the list. A delete, not a "no roles" row: a person with
 * no tags is nobody to this list, and leaving empty rows behind makes the
 * admin table say people hold access they don't.
 */
export async function removePartsRole(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((e) => e.id !== id);
    await delay(null);
    return;
  }
  if (!SP_PARTS_ROLES_LIST_ID) throw new Error(`Can't remove that person: ${NOT_SET}`);
  await graphFetch(`${listPath()}/${id}`, { method: "DELETE" });
}
