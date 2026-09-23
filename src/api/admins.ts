import type { AdminEntry, GraphListItem } from "@/types/task";
import { graphFetch, graphFetchAll } from "./graph";
import { SP_ADMINS_LIST_ID, SP_SITE_ID, USE_MOCK } from "./config";

// =============================================================================
// Admins list. Single-column SharePoint list whose Title field stores an
// email address (and the standard description/notes fields are reused for
// the human-friendly display name and an optional note). Every API call
// goes through this file so the mock/real boundary stays in one place.
//
// Setup (one-time, by hand in SharePoint):
//   1. Create a new SharePoint list on the Altronic_Engineering site
//      called "Admins" (or any name — only the list id matters).
//   2. Use the default Title column for the user's email address.
//   3. Add a single-line text column called `DisplayName` and another
//      called `Note`.
//   4. Set the repo variable VITE_SP_ADMINS_LIST_ID to the list id.
// =============================================================================

// In-memory store so demo mode behaves the same way (and the existing
// hardcoded admins from useIsAdmin still see the admin UI).
const MOCK_STORE: AdminEntry[] = [
  {
    id: 1,
    email: "ray.white@altronic-llc.com",
    displayName: "Ray White",
    note: "App maintainer",
  },
  {
    id: 2,
    email: "demo.user@altronic-llc.com",
    displayName: "Demo User",
    note: "Mock-mode default user — keeps the admin UI exercisable",
  },
];

function delay<T>(value: T, ms = 60): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export async function listAdmins(): Promise<AdminEntry[]> {
  if (USE_MOCK) {
    return delay([...MOCK_STORE]);
  }
  if (!SP_ADMINS_LIST_ID) return [];

  // No $select: column internal names depend on how SharePoint provisioned
  // them (the same field can be `DisplayName`, `Display_x0020_Name`,
  // `OData_DisplayName` etc.), so we let Graph return everything and pick
  // whichever variant exists.
  const path =
    `/sites/${SP_SITE_ID}/lists/${SP_ADMINS_LIST_ID}` +
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
      note: pickString(f, ["Note", "Notes", "OData_Note"]),
    };
  });
}

function pickString(f: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = f[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export async function addAdmin(input: {
  email: string;
  displayName: string;
  note: string;
}): Promise<AdminEntry> {
  if (USE_MOCK) {
    const nextId = (MOCK_STORE[MOCK_STORE.length - 1]?.id ?? 0) + 1;
    const entry: AdminEntry = { id: nextId, ...input };
    MOCK_STORE.push(entry);
    return delay(entry);
  }
  if (!SP_ADMINS_LIST_ID) {
    throw new Error("Cannot add admin: VITE_SP_ADMINS_LIST_ID is not set.");
  }
  // Only send keys that we know exist on the list — Graph 400s the whole
  // POST when even one field name doesn't match a real column. Title is
  // built-in; DisplayName and Note were created by our setup PowerShell.
  // If a future provisioning ends up naming the column `Display_x0020_Name`
  // instead, swap the key here (the read side accepts either).
  const fields: Record<string, string> = { Title: input.email };
  if (input.displayName) fields.DisplayName = input.displayName;
  if (input.note) fields.Note = input.note;
  const created = await graphFetch<GraphListItem>(
    `/sites/${SP_SITE_ID}/lists/${SP_ADMINS_LIST_ID}/items`,
    { method: "POST", body: JSON.stringify({ fields }) },
  );
  const f = created.fields as Record<string, unknown>;
  return {
    id: parseInt(created.id, 10),
    email: pickString(f, ["Title"]) || input.email,
    displayName:
      pickString(f, ["DisplayName", "Display_x0020_Name", "OData_DisplayName"]) ||
      input.displayName,
    note: pickString(f, ["Note", "Notes"]) || input.note,
  };
}

export async function removeAdmin(id: number): Promise<void> {
  if (USE_MOCK) {
    const idx = MOCK_STORE.findIndex((a) => a.id === id);
    if (idx >= 0) MOCK_STORE.splice(idx, 1);
    await delay(null);
    return;
  }
  if (!SP_ADMINS_LIST_ID) {
    throw new Error("Cannot remove admin: VITE_SP_ADMINS_LIST_ID is not set.");
  }
  await graphFetch(
    `/sites/${SP_SITE_ID}/lists/${SP_ADMINS_LIST_ID}/items/${id}`,
    { method: "DELETE" },
  );
}
