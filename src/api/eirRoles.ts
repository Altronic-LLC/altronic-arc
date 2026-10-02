import type { EirRole, EirRoleEntry, GraphListItem } from "@/types/task";
import { EIR_ROLES } from "@/types/task";
import { graphFetch, graphFetchAll } from "./graph";
import { SP_EIR_ROLES_LIST_ID, SP_SITE_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";

// =============================================================================
// EIR Roles list. One row per user controlling which EIR fields they may edit
// (Engineering Response = "engineer", Buyer Code = "supply chain"). Mirrors
// the Admins list pattern (src/api/admins.ts) — every call branches on
// USE_MOCK so the mock/real boundary stays in one file.
//
// Setup (one-time, by hand in SharePoint):
//   1. Create a list on the Altronic_Engineering site called "EIR Roles".
//   2. Use the default Title column for the user's email address.
//   3. Add single-line text columns: `DisplayName`, `Note`, and `Roles`.
//      `Roles` stores a lowercase CSV of role tags, e.g. "engineer,supply chain".
//   4. Set VITE_SP_EIR_ROLES_LIST_ID to the list id.
// =============================================================================

// In-memory store for mock mode. The demo user holds BOTH roles so the demo
// can edit both gated fields; the other rows give the admin table something
// to show and exercise single-role gating.
const MOCK_STORE: EirRoleEntry[] = [
  {
    id: 1,
    email: "demo.user@altronic-llc.com",
    displayName: "Demo User",
    roles: ["engineer", "supply chain"],
    note: "Mock-mode default user — both roles so the demo is fully editable",
  },
  {
    id: 2,
    email: "sarah.shaffer@altronic-llc.com",
    displayName: "Sarah Shaffer",
    roles: ["engineer"],
    note: "",
  },
  {
    id: 3,
    email: "adele.riffle@altronic-llc.com",
    displayName: "Adele Riffle",
    roles: ["supply chain"],
    note: "Buyer",
  },
];

/**
 * Parse the stored Roles CSV into a validated, de-duplicated EirRole[].
 * Unknown tokens are dropped so a typo in SharePoint can't break the UI.
 */
export function parseRoles(raw: string): EirRole[] {
  const known = new Set<string>(EIR_ROLES);
  const seen = new Set<EirRole>();
  for (const part of raw.split(",")) {
    const tag = part.trim().toLowerCase();
    if (known.has(tag)) seen.add(tag as EirRole);
  }
  // Return in the canonical EIR_ROLES order for stable rendering.
  return EIR_ROLES.filter((r) => seen.has(r));
}

/** Serialize roles back to the canonical lowercase CSV stored in SharePoint. */
export function serializeRoles(roles: EirRole[]): string {
  const set = new Set(roles);
  return EIR_ROLES.filter((r) => set.has(r)).join(",");
}

function pickString(f: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = f[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export async function listEirRoles(): Promise<EirRoleEntry[]> {
  if (USE_MOCK) {
    return mockDelay(MOCK_STORE.map((e) => ({ ...e, roles: [...e.roles] })));
  }
  if (!SP_EIR_ROLES_LIST_ID) return [];

  const path =
    `/sites/${SP_SITE_ID}/lists/${SP_EIR_ROLES_LIST_ID}` +
    `/items?$expand=fields&$top=200`;
  const items = await graphFetchAll<GraphListItem>(path);

  return items.map((it) => {
    const f = it.fields as Record<string, unknown>;
    return {
      id: parseInt(it.id, 10),
      email: pickString(f, ["Title"]),
      displayName: pickString(f, [
        "DisplayName",
        "Display_x0020_Name",
        "OData_DisplayName",
        "displayName",
      ]),
      roles: parseRoles(pickString(f, ["Roles", "OData_Roles"])),
      note: pickString(f, ["Note", "Notes", "OData_Note"]),
    };
  });
}

export async function addEirRole(input: {
  email: string;
  displayName: string;
  roles: EirRole[];
  note: string;
}): Promise<EirRoleEntry> {
  if (USE_MOCK) {
    const nextId = (MOCK_STORE[MOCK_STORE.length - 1]?.id ?? 0) + 1;
    const entry: EirRoleEntry = {
      id: nextId,
      email: input.email,
      displayName: input.displayName,
      roles: parseRoles(serializeRoles(input.roles)),
      note: input.note,
    };
    MOCK_STORE.push(entry);
    return mockDelay({ ...entry, roles: [...entry.roles] });
  }
  if (!SP_EIR_ROLES_LIST_ID) {
    throw new Error("Cannot add EIR role: VITE_SP_EIR_ROLES_LIST_ID is not set.");
  }
  const fields: Record<string, string> = {
    Title: input.email,
    Roles: serializeRoles(input.roles),
  };
  if (input.displayName) fields.DisplayName = input.displayName;
  if (input.note) fields.Note = input.note;
  const created = await graphFetch<GraphListItem>(
    `/sites/${SP_SITE_ID}/lists/${SP_EIR_ROLES_LIST_ID}/items`,
    { method: "POST", body: JSON.stringify({ fields }) },
  );
  const f = created.fields as Record<string, unknown>;
  return {
    id: parseInt(created.id, 10),
    email: pickString(f, ["Title"]) || input.email,
    displayName:
      pickString(f, ["DisplayName", "Display_x0020_Name"]) || input.displayName,
    roles: parseRoles(pickString(f, ["Roles"]) || serializeRoles(input.roles)),
    note: pickString(f, ["Note", "Notes"]) || input.note,
  };
}

export async function updateEirRole(input: {
  id: number;
  displayName?: string;
  roles?: EirRole[];
  note?: string;
}): Promise<void> {
  if (USE_MOCK) {
    const entry = MOCK_STORE.find((e) => e.id === input.id);
    if (entry) {
      if (input.displayName !== undefined) entry.displayName = input.displayName;
      if (input.roles !== undefined) entry.roles = parseRoles(serializeRoles(input.roles));
      if (input.note !== undefined) entry.note = input.note;
    }
    await mockDelay(null);
    return;
  }
  if (!SP_EIR_ROLES_LIST_ID) {
    throw new Error("Cannot update EIR role: VITE_SP_EIR_ROLES_LIST_ID is not set.");
  }
  const fields: Record<string, string> = {};
  if (input.displayName !== undefined) fields.DisplayName = input.displayName;
  if (input.roles !== undefined) fields.Roles = serializeRoles(input.roles);
  if (input.note !== undefined) fields.Note = input.note;
  await graphFetch(
    `/sites/${SP_SITE_ID}/lists/${SP_EIR_ROLES_LIST_ID}/items/${input.id}/fields`,
    { method: "PATCH", body: JSON.stringify(fields) },
  );
}

export async function removeEirRole(id: number): Promise<void> {
  if (USE_MOCK) {
    const idx = MOCK_STORE.findIndex((e) => e.id === id);
    if (idx >= 0) MOCK_STORE.splice(idx, 1);
    await mockDelay(null);
    return;
  }
  if (!SP_EIR_ROLES_LIST_ID) {
    throw new Error("Cannot remove EIR role: VITE_SP_EIR_ROLES_LIST_ID is not set.");
  }
  await graphFetch(
    `/sites/${SP_SITE_ID}/lists/${SP_EIR_ROLES_LIST_ID}/items/${id}`,
    { method: "DELETE" },
  );
}
