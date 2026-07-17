import type {
  GraphListItem,
  PanelOrder,
  PanelOrderStatus,
  PanelProject,
  Person,
  ProjectReference,
} from "@/types/task";
import { PANEL_ORDER_STATUSES } from "@/types/task";
import { parseCommunication } from "./communicationParser";
import { parseLookupSingle, parsePersonField, parseSinglePersonField } from "./taskMapper";

// =============================================================================
// Panel Order mapper — Graph list item → PanelOrder. Mirrors
// operationsTaskMapper.ts: the panel team's site has the same cross-site
// Graph limitation, so single-value person (EngineerAssigned) and single
// lookup (ProjectReference) fields come back as bare LookupIds only.
// `attachPanelReferences` joins the display values after the fact.
// =============================================================================

export function toPanelOrder(item: GraphListItem): PanelOrder {
  const f = item.fields;

  return {
    id: parseInt(item.id, 10),
    title: (f.Title as string) ?? "(untitled)",
    status: clampStatus(f.Status as string),
    projectRef:
      parseLookupSingle(f.ProjectReference) ??
      (f.ProjectReferenceLookupId
        ? { lookupId: toInt(f.ProjectReferenceLookupId, 0), title: "" }
        : null),
    salesOrder: (f.SalesOrder as string) ?? "",
    purchaseOrder: (f.PurchaseOrder as string) ?? "",
    customerReference: (f.CustomerReference as string) ?? "",
    customer: (f.Customer as string) ?? "",
    customerContactEmail: (f.CustomerContactEmail as string) ?? "",
    orderNotes: (f.OrderNotes as string) ?? "",
    engineerAssigned:
      parseSinglePersonField(f.EngineerAssigned) ??
      (f.EngineerAssignedLookupId
        ? { lookupId: toInt(f.EngineerAssignedLookupId, 0), displayName: "" }
        : null),
    watchers: parsePersonField(f.Watchers),
    comments: parseCommunication(f.Communication as string),
    hasAttachments: !!f.Attachments,
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
    author: parseIdentity(item.createdBy),
    editor: parseIdentity(item.lastModifiedBy),
    rawFields: f as Record<string, unknown>,
  };
}

/**
 * Resolve project titles + engineer names against the Panel Project
 * Reference list and the panel site's user directory — the "join after the
 * fact" pattern (see attachLookupTitles in api/operationsTasks.ts). Mutates
 * in place and returns the same array.
 */
export function attachPanelReferences(
  orders: PanelOrder[],
  projects: PanelProject[],
  usersById: Map<number, Person>,
): PanelOrder[] {
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  for (const order of orders) {
    if (order.projectRef && !order.projectRef.title) {
      const resolved = projectsById.get(order.projectRef.lookupId);
      if (resolved) order.projectRef = { ...order.projectRef, title: resolved.title };
    }
    if (order.engineerAssigned && !order.engineerAssigned.displayName && order.engineerAssigned.lookupId) {
      const resolved = usersById.get(order.engineerAssigned.lookupId);
      if (resolved) order.engineerAssigned = resolved;
    }
  }
  return orders;
}

/** PanelProject → the ProjectReference shape pickers/lookups use everywhere. */
export function panelProjectRef(p: PanelProject): ProjectReference {
  return { lookupId: p.id, title: p.title, description: p.description || undefined };
}

function clampStatus(raw: string | undefined): PanelOrderStatus {
  if (raw && (PANEL_ORDER_STATUSES as readonly string[]).includes(raw)) {
    return raw as PanelOrderStatus;
  }
  return "Submitted";
}

function parseIdentity(
  identity: { user?: { displayName?: string; email?: string } } | undefined,
): Person | null {
  const user = identity?.user;
  if (!user || !user.displayName) return null;
  return { displayName: user.displayName, email: user.email };
}

function toInt(raw: unknown, fallback: number): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}
