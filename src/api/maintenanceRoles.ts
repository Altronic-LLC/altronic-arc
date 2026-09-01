import type { GraphListItem, MaintenanceRole, MaintenanceRoleEntry } from "@/types/task";
import { MAINTENANCE_ROLES } from "@/types/task";
import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_MAINTENANCE_ROLES_LIST_ID, USE_MOCK } from "./config";

// =============================================================================
// Maintenance Roles list — one row per user controlling what they may do in
// the CMMS. A TWO-LEVEL list ("tech" / "admin"), and otherwise the EIR Roles
// module (src/api/eirRoles.ts) shape exactly: Title = email, `Roles` a
// lowercase CSV, every call branching on USE_MOCK so the mock/real boundary
// stays in this one file.
//
// The list lives on the **PMO site**, with the work orders, the PM schedules
// and the asset register it gates — not on Engineering with the EIR Roles
// list. `Sites.Selected` is granted per site collection and PMO's grant is
// already in place.
//
// Setup: scripts/create-maintenance-roles-list.ps1 creates the list
// ("Maintenance Roles": Title = email, plus `DisplayName`, `Roles` and `Note`
// columns). Then set VITE_SP_MAINTENANCE_ROLES_LIST_ID — which is what
// switches gating on (config.ts, MAINTENANCE_ROLES_ENFORCED), so populate the
// list first.
//
// **The `Roles` column's SHAPE IS NOT CONFIRMED.** It was created as a CHOICE
// column rather than the single-line text this module was first written for,
// and whether it is single- or multi-value — and what casing its choice values
// use — is still unknown. Graph hands those three back three different ways:
//
//   text          → "tech,admin"        (a CSV string)
//   MULTI choice  → ["Tech", "Admin"]   (a string array)
//   SINGLE choice → "Admin"             (a bare string)
//
// CONFIRMED 2026-08-28 by discovery (list ff2e3796-…): the live column is
// named `Role` — SINGULAR — and is a SINGLE-VALUE choice offering
// "Tech" | "Admin". Two consequences:
//
//   - The read is `f.Role`, with `Roles`/`OData_Roles` kept as fallbacks in
//     case a list was ever built to this module's original plural spec. Asking
//     for a column that does not exist rejects the WHOLE read with a 400, so a
//     wrong name here empties the screen rather than degrading it.
//   - A person holds ONE level, which is why `maintenanceAccessFrom` treats
//     admin as implying tech.
//
// `parseRoles` still takes every shape (CSV / array / bare string) — the same
// answer `parsePersonField` in lib/taskMapper.ts gives to the identical
// single-vs-multi problem — and `writeRolesFields` still falls back, now with
// the known-good shape tried first.
// =============================================================================

// In-memory store for mock mode. The demo user holds BOTH tags so the demo can
// exercise every gated action; the other rows give the admin table something
// to show and exercise the single-tag cases (a tech who is not an admin, and
// an admin who was never tagged tech — who still completes work orders,
// because `admin` outranks `tech`).
const MOCK_SEED: MaintenanceRoleEntry[] = [
  {
    id: 1,
    email: "demo.user@altronic-llc.com",
    displayName: "Demo User",
    roles: ["tech", "admin"],
    note: "Mock-mode default user — both tags so the demo is fully unlocked",
  },
  {
    id: 2,
    email: "david.bulkley@altronic-llc.com",
    displayName: "David Bulkley",
    roles: ["tech"],
    note: "Maintenance tech",
  },
  {
    id: 3,
    email: "alyssa.garrett@altronic-llc.com",
    displayName: "Alyssa Garrett",
    roles: ["tech"],
    note: "Maintenance tech",
  },
  {
    id: 4,
    email: "ray.white@altronic-llc.com",
    displayName: "Ray White",
    roles: ["admin"],
    note: "Owns the PM schedules and the asset register",
  },
];

let mockStore: MaintenanceRoleEntry[] = MOCK_SEED.map((e) => ({ ...e, roles: [...e.roles] }));

/** Mock-mode only: put the store back to its seed (used by tests). */
export function resetMaintenanceRolesMockStore(): void {
  mockStore = MOCK_SEED.map((e) => ({ ...e, roles: [...e.roles] }));
}

function delay<T>(value: T, ms = 60): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/**
 * Parse whatever the Roles column hands back into validated, de-duplicated
 * tags. Takes every shape the column could have (see the header note):
 *
 *   "tech,admin"      a CSV string          — a text column
 *   ["Tech","Admin"]  a string array        — a MULTI choice column
 *   "Admin"           a bare string         — a SINGLE choice column
 *   null / "" / []    nothing held
 *
 * Everything is trimmed and lowercased, so the choice values' casing doesn't
 * matter either. Unknown tokens are DROPPED rather than kept or thrown on: a
 * typo ("technician"), or a choice value nobody told this code about, must not
 * break the screen — it should simply grant nothing, which the admin table
 * then shows.
 */
export function parseRoles(raw: unknown): MaintenanceRole[] {
  const known = new Set<string>(MAINTENANCE_ROLES);
  const seen = new Set<MaintenanceRole>();

  // A multi-choice array's entries can themselves be comma-joined if somebody
  // pasted one in, so both levels go through the same split.
  const parts: string[] = [];
  for (const value of Array.isArray(raw) ? raw : [raw]) {
    if (typeof value !== "string") continue;
    parts.push(...value.split(","));
  }

  for (const part of parts) {
    const tag = part.trim().toLowerCase();
    if (known.has(tag)) seen.add(tag as MaintenanceRole);
  }
  // Canonical MAINTENANCE_ROLES order, so two rows granting the same thing
  // always read the same way.
  return MAINTENANCE_ROLES.filter((r) => seen.has(r));
}

/** Serialize roles to the canonical lowercase CSV — the text-column shape. */
export function serializeRoles(roles: readonly MaintenanceRole[]): string {
  const set = new Set(roles);
  return MAINTENANCE_ROLES.filter((r) => set.has(r)).join(",");
}

// =============================================================================
// Writing the Roles column — the one place that knows its shape.
// =============================================================================

/** The three shapes the column could be. See the header note. */
export type RolesFieldShape = "array" | "csv" | "single";

/**
 * The value to send for a given shape.
 *
 *   array  — a PLAIN array. A multi-value CHOICE column takes one with no
 *            `@odata.type` annotation: that annotation is for lookup and
 *            person columns (see lib/graphFields.ts), never for choices.
 *   csv    — the text-column shape.
 *   single — ONE value, because a single-choice column can only hold one. The
 *            higher tag wins, which loses nothing: `admin` implies `tech`
 *            (see maintenanceAccessFrom in lib/maintenanceRoles.ts), so an
 *            admin under a single-choice column still completes work orders.
 */
export function rolesFieldValue(
  roles: readonly MaintenanceRole[],
  shape: RolesFieldShape,
): string | string[] {
  const held = MAINTENANCE_ROLES.filter((r) => new Set(roles).has(r));
  if (shape === "array") return [...held];
  if (shape === "csv") return held.join(",");
  return held.includes("admin") ? "admin" : (held[0] ?? "");
}

/**
 * The shape a READ value proves the column to be, where it proves anything.
 *
 * An array is conclusive. A string containing a comma can only be text — no
 * choice column would hold one value spelled "tech,admin". A bare string is
 * ambiguous (single choice, or a text column holding one tag), so it settles
 * nothing and returns null.
 */
export function detectRolesShape(raw: unknown): RolesFieldShape | null {
  if (Array.isArray(raw)) return "array";
  if (typeof raw === "string" && raw.includes(",")) return "csv";
  return null;
}

/**
 * The shape the last read (or the last successful write) proved, remembered
 * for the rest of the session so the first attempt is usually the right one.
 */
let observedRolesShape: RolesFieldShape | null = null;

/** Tests only: forget what the session learned about the column's shape. */
export function resetObservedRolesShape(): void {
  observedRolesShape = null;
}

/** Shapes to try, best guess first. */
function shapesToTry(): RolesFieldShape[] {
  // "single" first: the live column is a single-value choice offering
  // Tech | Admin (discovery 2026-08-28). The other two are only reachable on a
  // list built to the original brief's plural CSV / multi-choice shape, so
  // leading with them spent a rejected request on every first write.
  const rest = (["single", "array", "csv"] as RolesFieldShape[]).filter(
    (s) => s !== observedRolesShape,
  );
  return observedRolesShape ? [observedRolesShape, ...rest] : rest;
}

function pickString(f: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = f[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export async function listMaintenanceRoles(): Promise<MaintenanceRoleEntry[]> {
  if (USE_MOCK) {
    return delay(mockStore.map((e) => ({ ...e, roles: [...e.roles] })));
  }
  // Not an error: gating is OFF until the list is configured, so an empty
  // answer here is the unconfigured state, not a failure.
  if (!SP_MAINTENANCE_ROLES_LIST_ID) return [];

  const path =
    `/sites/${SITES.pmo}/lists/${SP_MAINTENANCE_ROLES_LIST_ID}` + `/items?$expand=fields&$top=200`;
  const items = await graphFetchAll<GraphListItem>(path);

  return items.map((it) => {
    const f = it.fields as Record<string, unknown>;
    // The RAW value, not `pickString` — a multi-choice column hands back an
    // array, and stringifying it here would throw away the one piece of
    // evidence about the column's shape.
    // The live column is `Role`, SINGULAR — confirmed by discovery on
    // 2026-08-28 (ff2e3796-…). `Roles`/`OData_Roles` are still read as
    // fallbacks: the plural is what the original brief specified, so a list
    // built from that would carry it, and reading both costs nothing.
    const rawRoles = f.Role ?? f.Roles ?? f.OData_Roles;
    // Learn the shape from the data, so a later write leads with it.
    observedRolesShape = detectRolesShape(rawRoles) ?? observedRolesShape;
    return {
      id: parseInt(it.id, 10),
      email: pickString(f, ["Title"]),
      displayName: pickString(f, [
        "DisplayName",
        "Display_x0020_Name",
        "OData_DisplayName",
        "displayName",
      ]),
      roles: parseRoles(rawRoles),
      note: pickString(f, ["Note", "Notes", "OData_Note"]),
    };
  });
}

/**
 * Send a write that carries the Roles column, trying each shape until one is
 * accepted, and remembering the one that worked.
 *
 * This exists because the column's shape is unconfirmed (see the header note)
 * and getting it wrong is a hard `400`, not a silent miswrite — SharePoint
 * refuses an array for a text column and refuses "tech,admin" for a choice
 * one. A rejected write also leaves NOTHING behind, item creation included
 * (the same "the whole request is rejected" behaviour documented for Hyperlink
 * columns at create time in CLAUDE.md), so retrying a POST can't duplicate a
 * row.
 *
 * **When the shape is confirmed, this is the one function to simplify**: fix
 * `observedRolesShape` to it and drop the loop.
 */
/**
 * Write the role level.
 *
 * The live column is a SINGLE-VALUE choice offering "Tech" | "Admin"
 * (discovery, 2026-08-28), so the ordinary write is a bare string and needs no
 * guessing. The fallback loop is kept for the case where a list was built from
 * the original brief's plural CSV/multi-choice shape — it tries the known-good
 * shape first and only falls back on a rejection.
 *
 * A rejected write creates nothing, so retrying a POST cannot duplicate a row.
 *
 * Because the column is single-value a person holds ONE level, which is why
 * `maintenanceAccessFrom` treats admin as implying tech: an admin who could
 * create PM schedules but not complete a work order would be absurd.
 */
async function writeRolesFields<T>(
  roles: readonly MaintenanceRole[] | undefined,
  send: (rolesValue: string | string[] | undefined) => Promise<T>,
): Promise<T> {
  if (roles === undefined) return send(undefined);

  let lastError: unknown;
  for (const shape of shapesToTry()) {
    try {
      const result = await send(rolesFieldValue(roles, shape));
      observedRolesShape = shape;
      return result;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function addMaintenanceRole(input: {
  email: string;
  displayName: string;
  roles: MaintenanceRole[];
  note: string;
}): Promise<MaintenanceRoleEntry> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((e) => e.id)) + 1;
    const entry: MaintenanceRoleEntry = {
      id: nextId,
      email: input.email,
      displayName: input.displayName,
      // Round-tripped through serialize/parse so an unrecognised tag can't
      // enter the store in mock mode either — the two modes must agree about
      // what a row means.
      roles: parseRoles(serializeRoles(input.roles)),
      note: input.note,
    };
    mockStore = [...mockStore, entry];
    return delay({ ...entry, roles: [...entry.roles] });
  }
  if (!SP_MAINTENANCE_ROLES_LIST_ID) {
    throw new Error(
      "Cannot add a maintenance role: VITE_SP_MAINTENANCE_ROLES_LIST_ID is not set.",
    );
  }
  const created = await writeRolesFields(input.roles, (rolesValue) => {
    const fields: Record<string, unknown> = {
      Title: input.email,
      Role: rolesValue,
    };
    if (input.displayName) fields.DisplayName = input.displayName;
    if (input.note) fields.Note = input.note;
    return graphFetch<GraphListItem>(
      `/sites/${SITES.pmo}/lists/${SP_MAINTENANCE_ROLES_LIST_ID}/items`,
      { method: "POST", body: JSON.stringify({ fields }) },
    );
  });

  const f = created.fields as Record<string, unknown>;
  const rawRoles = f.Roles;
  return {
    id: parseInt(created.id, 10),
    email: pickString(f, ["Title"]) || input.email,
    displayName: pickString(f, ["DisplayName", "Display_x0020_Name"]) || input.displayName,
    // Prefer what came BACK — it is the column's own answer — and fall back to
    // what was asked for when the response carries no fields.
    roles: rawRoles === undefined ? parseRoles(serializeRoles(input.roles)) : parseRoles(rawRoles),
    note: pickString(f, ["Note", "Notes"]) || input.note,
  };
}

export async function updateMaintenanceRole(input: {
  id: number;
  displayName?: string;
  roles?: MaintenanceRole[];
  note?: string;
}): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.map((e) =>
      e.id === input.id
        ? {
            ...e,
            displayName: input.displayName !== undefined ? input.displayName : e.displayName,
            roles: input.roles !== undefined ? parseRoles(serializeRoles(input.roles)) : e.roles,
            note: input.note !== undefined ? input.note : e.note,
          }
        : e,
    );
    await delay(null);
    return;
  }
  if (!SP_MAINTENANCE_ROLES_LIST_ID) {
    throw new Error(
      "Cannot update a maintenance role: VITE_SP_MAINTENANCE_ROLES_LIST_ID is not set.",
    );
  }
  await writeRolesFields(input.roles, (rolesValue) => {
    const fields: Record<string, unknown> = {};
    if (input.displayName !== undefined) fields.DisplayName = input.displayName;
    if (rolesValue !== undefined) fields.Role = rolesValue;
    if (input.note !== undefined) fields.Note = input.note;
    return graphFetch(
      `/sites/${SITES.pmo}/lists/${SP_MAINTENANCE_ROLES_LIST_ID}/items/${input.id}/fields`,
      { method: "PATCH", body: JSON.stringify(fields) },
    );
  });
}

export async function removeMaintenanceRole(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((e) => e.id !== id);
    await delay(null);
    return;
  }
  if (!SP_MAINTENANCE_ROLES_LIST_ID) {
    throw new Error(
      "Cannot remove a maintenance role: VITE_SP_MAINTENANCE_ROLES_LIST_ID is not set.",
    );
  }
  await graphFetch(
    `/sites/${SITES.pmo}/lists/${SP_MAINTENANCE_ROLES_LIST_ID}/items/${id}`,
    { method: "DELETE" },
  );
}
