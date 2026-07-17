import { graphFetch, graphFetchAll } from "./graph";
import {
  SITES,
  SP_PANEL_ORDERS_LIST_ID,
  SP_PANEL_PROJECTS_LIST_ID,
  SP_PANELTEAM_SITE_URL,
  USE_MOCK,
} from "./config";
import { spFetch } from "./sharepoint";
import type { GraphListItem, PanelOrder, Person } from "@/types/task";
import { PANEL_ORDER_STATUSES } from "@/types/task";
import { attachPanelReferences, toPanelOrder } from "@/lib/panelOrderMapper";
import { appendComment, replaceComment } from "@/lib/communicationParser";
import { multiPersonField } from "@/lib/graphFields";
import { listPanelProjects } from "./panelProjects";
import { MOCK_PANEL_ORDERS, MOCK_PANEL_PROJECTS, MOCK_PANEL_ROLES } from "@/data/panelMockData";

// =============================================================================
// Panel Orders API — mirrors api/operationsTasks.ts's USE_MOCK-branching
// structure against the ALTRONICPANELTEAM site's Panel Order Headers list.
// Header-only entity (no line items). Same cross-site quirks as Operations:
// single-value person (EngineerAssigned) and single lookup (ProjectReference)
// come back as bare LookupIds, resolved after the fact against the panel
// site's user directory / the Panel Project Reference list.
// =============================================================================

const PANEL_FIELD_SELECT = [
  "Title",
  "Status",
  "ProjectReferenceLookupId",
  "ProjectReference",
  "SalesOrder",
  "PurchaseOrder",
  "CustomerReference",
  "Customer",
  "CustomerContactEmail",
  "OrderNotes",
  "EngineerAssignedLookupId",
  "EngineerAssigned",
  "Communication",
  "Watchers",
  "Attachments",
  "AuthorLookupId",
  "EditorLookupId",
].join(",");

const MOCK_STORAGE_KEY = "aets:mock-panel-orders-store-v1";

function loadMockStoreFromStorage(): PanelOrder[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PanelOrder[];
    return parsed.map((o) => ({
      ...o,
      createdAt: new Date(o.createdAt),
      modifiedAt: new Date(o.modifiedAt),
      comments: o.comments.map((c) => ({
        ...c,
        timestamp: new Date(c.timestamp),
        attachments: c.attachments ?? [],
      })),
    }));
  } catch {
    return null;
  }
}

function saveMockStoreToStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(mockStore));
  } catch {
    // Storage quota exceeded, private mode, etc. — demo still works in-memory.
  }
}

let mockStore: PanelOrder[] = loadMockStoreFromStorage() ?? MOCK_PANEL_ORDERS.map((o) => ({ ...o }));

/** Demo-mode-only: clear local data and reset to the bundled seed. */
export function resetPanelOrdersMockStore(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(MOCK_STORAGE_KEY);
    } catch {
      // ignored
    }
  }
  mockStore = MOCK_PANEL_ORDERS.map((o) => ({ ...o }));
}

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

interface SpSiteUser {
  Id: number;
  Title: string;
  Email?: string;
}

/**
 * Resolve the panel site's user directory (lookupId → Person) via classic
 * SP REST — the only way to get display names for single-value person fields
 * on this site (Graph returns only the bare EngineerAssignedLookupId).
 * Best-effort: returns an empty map on failure so the order list still
 * renders, just with blank engineer names.
 */
export async function listPanelSiteUsers(): Promise<Map<number, Person>> {
  if (USE_MOCK) {
    const map = new Map<number, Person>();
    for (const o of MOCK_PANEL_ORDERS) {
      for (const p of [o.engineerAssigned, o.author, ...o.watchers]) {
        if (p?.lookupId) map.set(p.lookupId, p);
      }
    }
    for (const r of MOCK_PANEL_ROLES) {
      if (r.user?.lookupId) map.set(r.user.lookupId, r.user);
    }
    return delay(map, 50);
  }
  try {
    const res = await spFetch<{ value: SpSiteUser[] }>(
      `${SP_PANELTEAM_SITE_URL}/_api/web/siteusers?$select=Id,Title,Email`,
    );
    const map = new Map<number, Person>();
    for (const u of res.value) {
      if (!u.Title) continue;
      map.set(u.Id, { displayName: u.Title, email: u.Email || undefined, lookupId: u.Id });
    }
    return map;
  } catch (err) {
    console.warn(
      "[panelOrders] Couldn't resolve panel site users — engineer names will show blank until this works:",
      err,
    );
    return new Map();
  }
}

/**
 * Resolve a single email to its panel site user lookupId — cold-start
 * @-mention auto-watch (mentioned someone who's never been an engineer or
 * watcher on any panel order). Mirrors resolvePmoSiteUserLookupId.
 */
export async function resolvePanelSiteUserLookupId(email: string): Promise<number> {
  const users = await listPanelSiteUsers();
  const target = email.toLowerCase();
  for (const u of users.values()) {
    if (u.email?.toLowerCase() === target) return u.lookupId ?? 0;
  }
  return 0;
}

/** List all panel orders, resolving project titles + engineer names. */
export async function listPanelOrders(): Promise<PanelOrder[]> {
  if (USE_MOCK) {
    const copy = mockStore.map((o) => ({ ...o }));
    return delay(copy);
  }

  const path =
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_ORDERS_LIST_ID}/items` +
    `?$expand=fields($select=${PANEL_FIELD_SELECT})&$top=200`;
  const [items, projects, users] = await Promise.all([
    graphFetchAll<GraphListItem>(path),
    listPanelProjects(),
    listPanelSiteUsers(),
  ]);
  const orders = items.map(toPanelOrder);
  attachPanelReferences(orders, projects, users);
  return orders;
}

export async function getPanelOrder(id: number): Promise<PanelOrder | null> {
  const all = await listPanelOrders();
  return all.find((o) => o.id === id) ?? null;
}

/** Update arbitrary fields on a panel order. Returns the updated order. */
export async function updatePanelOrderFields(
  id: number,
  fields: Record<string, unknown>,
): Promise<PanelOrder> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((o) => o.id === id);
    if (idx < 0) throw new Error(`Panel order ${id} not found`);

    const next = { ...mockStore[idx] };
    if ("Title" in fields) next.title = fields.Title as string;
    if ("Status" in fields) next.status = fields.Status as PanelOrder["status"];
    if ("SalesOrder" in fields) next.salesOrder = (fields.SalesOrder as string) ?? "";
    if ("PurchaseOrder" in fields) next.purchaseOrder = (fields.PurchaseOrder as string) ?? "";
    if ("CustomerReference" in fields)
      next.customerReference = (fields.CustomerReference as string) ?? "";
    if ("Customer" in fields) next.customer = (fields.Customer as string) ?? "";
    if ("CustomerContactEmail" in fields)
      next.customerContactEmail = (fields.CustomerContactEmail as string) ?? "";
    if ("OrderNotes" in fields) next.orderNotes = (fields.OrderNotes as string) ?? "";
    if ("EngineerAssigned" in fields) {
      next.engineerAssigned = (fields.EngineerAssigned as Person | null) ?? null;
    }
    if ("Watchers" in fields && Array.isArray(fields.Watchers)) {
      next.watchers = fields.Watchers as Person[];
    }
    if ("ProjectReferenceLookupId" in fields) {
      const v = fields.ProjectReferenceLookupId;
      next.projectRef = v
        ? {
            lookupId: Number(v),
            title: MOCK_PANEL_PROJECTS.find((p) => p.id === Number(v))?.title ?? "",
          }
        : null;
    }
    if ("Communication" in fields) {
      // Mock comments are maintained structurally by add/editPanelOrderComment.
    }
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return delay({ ...next });
  }

  const path = `/sites/${SITES.panelTeam}/lists/${SP_PANEL_ORDERS_LIST_ID}/items/${id}/fields`;
  await graphFetch(path, { method: "PATCH", body: JSON.stringify(fields) });

  const reloaded = await getPanelOrder(id);
  if (!reloaded) throw new Error(`Panel order ${id} disappeared after update`);
  return reloaded;
}

/** Change the project reference (or clear with `null`). */
export async function setPanelOrderProject(
  id: number,
  projectLookupId: number | null,
): Promise<PanelOrder> {
  return updatePanelOrderFields(id, { ProjectReferenceLookupId: projectLookupId });
}

/**
 * Replace the single Engineer Assigned (or clear with `null`) — a plain
 * scalar LookupId write, same as Operations' Assigned (no @odata.type
 * annotation; that's only for multi-value Collection writes).
 */
export async function setPanelOrderEngineer(
  id: number,
  person: Person | null,
): Promise<PanelOrder> {
  if (USE_MOCK) {
    return updatePanelOrderFields(id, { EngineerAssigned: person });
  }
  if (person && !person.lookupId) {
    throw new Error(
      "Cannot update Engineer Assigned: the selected person has no resolved SharePoint lookupId. " +
        "Try refreshing the page and signing in again.",
    );
  }
  return updatePanelOrderFields(id, { EngineerAssignedLookupId: person?.lookupId ?? null });
}

/** Replace the Watchers list. */
export async function setPanelOrderWatchers(id: number, people: Person[]): Promise<PanelOrder> {
  if (USE_MOCK) {
    return updatePanelOrderFields(id, { Watchers: people });
  }
  const resolved = people.filter((p) => !!p.lookupId);
  if (people.length > 0 && resolved.length === 0) {
    throw new Error(
      "Cannot update Watchers: none of the watchers had a resolved SharePoint lookupId. " +
        "Try refreshing the page and signing in again.",
    );
  }
  return updatePanelOrderFields(id, multiPersonField("Watchers", people));
}

/** Add the given person to the watchers list (if not already there). */
export async function watchPanelOrder(id: number, person: Person): Promise<PanelOrder> {
  if (!USE_MOCK && !person.lookupId) {
    throw new Error(
      "Cannot add to watchers: your SharePoint user lookupId hasn't been resolved yet. " +
        "Please wait a moment and try again, or refresh the page.",
    );
  }
  const order = await getPanelOrder(id);
  if (!order) throw new Error(`Panel order ${id} not found`);
  const alreadyWatching = order.watchers.some(
    (w) => w.email === person.email || (w.lookupId && w.lookupId === person.lookupId),
  );
  if (alreadyWatching) return order;
  return setPanelOrderWatchers(id, [...order.watchers, person]);
}

/** Remove the given person from the watchers list. */
export async function unwatchPanelOrder(id: number, person: Person): Promise<PanelOrder> {
  const order = await getPanelOrder(id);
  if (!order) throw new Error(`Panel order ${id} not found`);
  const next = order.watchers.filter(
    (w) => !(w.email === person.email || (w.lookupId && w.lookupId === person.lookupId)),
  );
  if (next.length === order.watchers.length) return order;
  return setPanelOrderWatchers(id, next);
}

/** Append a comment to a panel order's Communication field. */
export async function addPanelOrderComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<PanelOrder> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((o) => o.id === id);
    if (idx < 0) throw new Error(`Panel order ${id} not found`);
    const next = { ...mockStore[idx] };
    next.comments = [
      {
        timestamp: new Date(),
        authorName: comment.authorName,
        authorEmail: comment.authorEmail,
        bodyHtml: comment.bodyHtml,
        attachments: [],
      },
      ...next.comments,
    ];
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return delay({ ...next });
  }

  const path =
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_ORDERS_LIST_ID}/items/${id}` +
    `?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = appendComment(existingRaw, comment);
  return updatePanelOrderFields(id, { Communication: newRaw });
}

/** Edit the body of an existing comment, matched by timestamp + author email. */
export async function editPanelOrderComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<PanelOrder> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((o) => o.id === id);
    if (idx < 0) throw new Error(`Panel order ${id} not found`);
    const next = { ...mockStore[idx] };
    const targetEmail = target.authorEmail.toLowerCase();
    next.comments = next.comments.map((c) =>
      c.timestamp.getTime() === target.timestamp.getTime() &&
      c.authorEmail.toLowerCase() === targetEmail
        ? { ...c, bodyHtml: newBodyHtml }
        : c,
    );
    next.modifiedAt = new Date();
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    saveMockStoreToStorage();
    return delay({ ...next });
  }

  const path =
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_ORDERS_LIST_ID}/items/${id}` +
    `?$expand=fields($select=Communication)`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields.Communication as string | undefined) ?? "";
  const newRaw = replaceComment(existingRaw, target, newBodyHtml);
  return updatePanelOrderFields(id, { Communication: newRaw });
}

/** Create a new panel order. Title is required; everything else optional. */
export async function createPanelOrder(input: {
  title: string;
  status?: PanelOrder["status"];
  projectLookupId?: number | null;
  salesOrder?: string;
  purchaseOrder?: string;
  customerReference?: string;
  customer?: string;
  customerContactEmail?: string;
  orderNotes?: string;
  engineerAssigned?: Person | null;
  watchers?: Person[];
}): Promise<PanelOrder> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((o) => o.id)) + 1;
    const now = new Date();
    const order: PanelOrder = {
      id: nextId,
      title: input.title,
      status: input.status ?? "Submitted",
      projectRef: input.projectLookupId
        ? {
            lookupId: input.projectLookupId,
            title: MOCK_PANEL_PROJECTS.find((p) => p.id === input.projectLookupId)?.title ?? "",
          }
        : null,
      salesOrder: input.salesOrder ?? "",
      purchaseOrder: input.purchaseOrder ?? "",
      customerReference: input.customerReference ?? "",
      customer: input.customer ?? "",
      customerContactEmail: input.customerContactEmail ?? "",
      orderNotes: input.orderNotes ?? "",
      engineerAssigned: input.engineerAssigned ?? null,
      watchers: input.watchers ?? [],
      comments: [],
      hasAttachments: false,
      createdAt: now,
      modifiedAt: now,
      author: null,
    };
    mockStore = [order, ...mockStore];
    saveMockStoreToStorage();
    return delay({ ...order });
  }

  const fields: Record<string, unknown> = {
    Title: input.title,
    Status: input.status ?? "Submitted",
  };
  if (input.projectLookupId) fields.ProjectReferenceLookupId = input.projectLookupId;
  if (input.salesOrder) fields.SalesOrder = input.salesOrder;
  if (input.purchaseOrder) fields.PurchaseOrder = input.purchaseOrder;
  if (input.customerReference) fields.CustomerReference = input.customerReference;
  if (input.customer) fields.Customer = input.customer;
  if (input.customerContactEmail) fields.CustomerContactEmail = input.customerContactEmail;
  if (input.orderNotes) fields.OrderNotes = input.orderNotes;
  if (input.engineerAssigned?.lookupId)
    fields.EngineerAssignedLookupId = input.engineerAssigned.lookupId;
  if (input.watchers?.some((p) => !!p.lookupId)) {
    Object.assign(fields, multiPersonField("Watchers", input.watchers));
  }

  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_ORDERS_LIST_ID}/items`,
    { method: "POST", body: JSON.stringify({ fields }) },
  );
  return toPanelOrder(created);
}

// =============================================================================
// Choice discovery — the header's Status/Customer choice columns are read at
// runtime so the app tracks whatever values SharePoint holds. If a column
// still carries the provisioning placeholders ("Choice 1"…), fall back:
// Status → the confirmed workflow consts, Customer → the Panel Project
// Reference list's Customer choices (the canonical customer list).
// =============================================================================

export interface PanelOrderChoices {
  status: string[];
  customer: string[];
}

interface GraphColumnDef {
  name?: string;
  choice?: { choices?: string[] };
}

function isPlaceholder(choices: string[]): boolean {
  return choices.length === 0 || choices.every((c) => /^Choice \d+$/i.test(c.trim()));
}

async function listColumnChoices(listId: string): Promise<Map<string, string[]>> {
  const res = await graphFetch<{ value: GraphColumnDef[] }>(
    `/sites/${SITES.panelTeam}/lists/${listId}/columns?$select=name,choice`,
  );
  const map = new Map<string, string[]>();
  for (const c of res.value ?? []) {
    if (c.name && c.choice?.choices) map.set(c.name, c.choice.choices);
  }
  return map;
}

export async function getPanelOrderChoices(): Promise<PanelOrderChoices> {
  const fallbackCustomers = [
    ...new Set(MOCK_PANEL_PROJECTS.map((p) => p.customer).filter(Boolean)),
  ].sort();
  if (USE_MOCK) {
    return delay({ status: [...PANEL_ORDER_STATUSES], customer: fallbackCustomers }, 50);
  }

  try {
    const [headerCols, refCols] = await Promise.all([
      listColumnChoices(SP_PANEL_ORDERS_LIST_ID),
      listColumnChoices(SP_PANEL_PROJECTS_LIST_ID),
    ]);
    const rawStatus = headerCols.get("Status") ?? [];
    const rawCustomer = headerCols.get("Customer") ?? [];
    const refCustomer = refCols.get("Customer") ?? [];
    return {
      status: isPlaceholder(rawStatus) ? [...PANEL_ORDER_STATUSES] : rawStatus,
      customer: isPlaceholder(rawCustomer)
        ? isPlaceholder(refCustomer)
          ? fallbackCustomers
          : refCustomer
        : rawCustomer,
    };
  } catch (err) {
    console.warn("[panelOrders] Couldn't discover choice columns — using defaults:", err);
    return { status: [...PANEL_ORDER_STATUSES], customer: fallbackCustomers };
  }
}
