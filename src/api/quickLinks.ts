import type { DashboardDepartment, GraphListItem, QuickLink } from "@/types/task";
import { DASHBOARD_DEPARTMENTS } from "@/types/task";
import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_QUICK_LINKS_LIST_ID, USE_MOCK } from "./config";
import { MOCK_QUICK_LINKS } from "@/data/quickLinksMockData";

// =============================================================================
// Quick Links — admin-managed external-link buttons shown above each
// Dashboard department's cards ("New Supplier Onboarding", "CAD Vault", …).
// One shared list on SITES.engineering, the same home as Admins and EIR
// Roles, tagged per row with one of `DASHBOARD_DEPARTMENTS`.
//
// Setup (one-time, by hand in SharePoint):
//   1. Create a list called "Quick Links" (or any name — only the id matters).
//   2. Use the default Title column for the button label.
//   3. Add a single-line text column `Url`.
//   4. Add a choice column `Department` with the seven DASHBOARD_DEPARTMENTS
//      values as its choices.
//   5. Add a number column `SortOrder`.
//   6. Set VITE_SP_QUICK_LINKS_LIST_ID to the list id.
//
// Reading and rendering is open to any signed-in user — the Dashboard is
// where these show. Writing is admin-only, enforced in the view AND in
// every mutation in useQuickLinks.ts, the same defence-in-depth as Admins
// and CSA Listings.
// =============================================================================

let mockStore: QuickLink[] = MOCK_QUICK_LINKS.map((l) => ({ ...l }));

function delay<T>(value: T, ms = 150): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function requireListId(action: string): string {
  if (!SP_QUICK_LINKS_LIST_ID) {
    throw new Error(`Cannot ${action}: VITE_SP_QUICK_LINKS_LIST_ID is not set.`);
  }
  return SP_QUICK_LINKS_LIST_ID;
}

function isValidDepartment(value: unknown): value is DashboardDepartment {
  return (DASHBOARD_DEPARTMENTS as readonly string[]).includes(value as string);
}

function toQuickLink(item: GraphListItem): QuickLink | null {
  const f = item.fields ?? {};
  const department = f.Department;
  // A row whose Department has drifted outside the seven known values (a
  // choice column edited directly in SharePoint, or a stale value from
  // before a department was renamed) is dropped rather than shown under a
  // department that doesn't exist on the Dashboard — the alternative is an
  // unreachable "orphan" section nobody asked for.
  if (!isValidDepartment(department)) return null;
  return {
    id: parseInt(item.id, 10),
    label: String(f.Title ?? "").trim(),
    url: String(f.Url ?? "").trim(),
    department,
    order: typeof f.SortOrder === "number" ? f.SortOrder : Number(f.SortOrder ?? 0) || 0,
  };
}

/** Every quick link, sorted by department (Dashboard order) then its own order, then id. */
export async function listQuickLinks(): Promise<QuickLink[]> {
  const links = USE_MOCK
    ? await delay([...mockStore])
    : await (async () => {
        if (!SP_QUICK_LINKS_LIST_ID) return [];
        const items = await graphFetchAll<GraphListItem>(
          `/sites/${SITES.engineering}/lists/${SP_QUICK_LINKS_LIST_ID}` +
            `/items?$expand=fields($select=Title,Url,Department,SortOrder)&$top=500`,
        );
        return items.map(toQuickLink).filter((l): l is QuickLink => l !== null);
      })();

  const deptIndex = new Map(DASHBOARD_DEPARTMENTS.map((d, i) => [d, i]));
  return [...links].sort((a, b) => {
    const dept = (deptIndex.get(a.department) ?? 0) - (deptIndex.get(b.department) ?? 0);
    if (dept !== 0) return dept;
    const order = a.order - b.order;
    return order !== 0 ? order : a.id - b.id;
  });
}

export interface QuickLinkInput {
  label: string;
  url: string;
  department: DashboardDepartment;
  /** Defaults to "last in its department" when omitted — see useCreateQuickLink. */
  order: number;
}

export async function createQuickLink(input: QuickLinkInput): Promise<QuickLink> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((l) => l.id)) + 1;
    const link: QuickLink = { id: nextId, ...input };
    mockStore = [...mockStore, link];
    return delay(link);
  }
  const listId = requireListId("add the quick link");
  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${listId}/items`,
    {
      method: "POST",
      body: JSON.stringify({
        fields: {
          Title: input.label,
          Url: input.url,
          Department: input.department,
          SortOrder: input.order,
        },
      }),
    },
  );
  return (
    toQuickLink(created) ?? {
      id: parseInt(created.id, 10),
      ...input,
    }
  );
}

/** Patch a link's label/url/department in one write. Order changes go through `reorderQuickLink`. */
export async function updateQuickLink(
  id: number,
  input: Omit<QuickLinkInput, "order">,
): Promise<QuickLink> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((l) => l.id === id);
    if (idx < 0) throw new Error(`Quick link ${id} not found`);
    const next: QuickLink = { ...mockStore[idx], ...input };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }
  const listId = requireListId("update the quick link");
  await graphFetch(`/sites/${SITES.engineering}/lists/${listId}/items/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({
      Title: input.label,
      Url: input.url,
      Department: input.department,
    }),
  });
  const updated = await getQuickLink(id);
  if (!updated) throw new Error(`Quick link ${id} disappeared after update`);
  return updated;
}

/** Write a single link's SortOrder — the one column reordering touches. */
export async function setQuickLinkOrder(id: number, order: number): Promise<QuickLink> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((l) => l.id === id);
    if (idx < 0) throw new Error(`Quick link ${id} not found`);
    const next: QuickLink = { ...mockStore[idx], order };
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }
  const listId = requireListId("reorder the quick link");
  await graphFetch(`/sites/${SITES.engineering}/lists/${listId}/items/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ SortOrder: order }),
  });
  const updated = await getQuickLink(id);
  if (!updated) throw new Error(`Quick link ${id} disappeared after update`);
  return updated;
}

async function getQuickLink(id: number): Promise<QuickLink | null> {
  if (!SP_QUICK_LINKS_LIST_ID) return null;
  try {
    const item = await graphFetch<GraphListItem>(
      `/sites/${SITES.engineering}/lists/${SP_QUICK_LINKS_LIST_ID}/items/${id}` +
        `?$expand=fields($select=Title,Url,Department,SortOrder)`,
    );
    return toQuickLink(item);
  } catch {
    return null;
  }
}

export async function deleteQuickLink(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((l) => l.id !== id);
    await delay(null);
    return;
  }
  const listId = requireListId("remove the quick link");
  await graphFetch(`/sites/${SITES.engineering}/lists/${listId}/items/${id}`, {
    method: "DELETE",
  });
}
