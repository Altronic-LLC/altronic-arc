import type { PanelOrder } from "@/types/task";

// =============================================================================
// Archived panel orders — the finished orders brought over from the old
// "Panel Job Dashboard" list by scripts/move-panel-orders-to-arc.ps1.
//
// The Panel Orders list opens on ACTIVE orders (not archived): about 1,180 of
// the ~1,380 moved orders were already shipped, and showing them by default
// would bury the live work. `?archived=only` shows just the archive and
// `?archived=all` shows both, so a filtered view stays shareable.
// =============================================================================

export type PanelOrderArchiveScope = "active" | "archived" | "all";

/** The old list's name, for the "moved from" wording. */
export const OLD_PANEL_ORDER_LIST = "Panel Job Dashboard";

const LEGACY_PREFIX = "PanelJobDashboard#";

/** `?archived=` → scope. Anything unrecognised reads as the default, never as "nothing". */
export function parseArchiveScope(raw: string | null): PanelOrderArchiveScope {
  if (raw === "only") return "archived";
  if (raw === "all") return "all";
  return "active";
}

/** Scope → `?archived=` value; null removes the param (the default). */
export function archiveScopeParam(scope: PanelOrderArchiveScope): string | null {
  if (scope === "archived") return "only";
  if (scope === "all") return "all";
  return null;
}

export function inArchiveScope(order: PanelOrder, scope: PanelOrderArchiveScope): boolean {
  if (scope === "all") return true;
  return scope === "archived" ? order.archived : !order.archived;
}

/**
 * When the order was really created. A moved order's own Created is the day
 * it was moved (Graph can't set it), so its old list's date wins — otherwise
 * every moved order would sort as the newest.
 */
export function panelOrderCreatedAt(order: PanelOrder): Date {
  return order.legacyCreatedAt ?? order.createdAt;
}

/** The old list's item id for a moved order ("PanelJobDashboard#123" → 123), else null. */
export function legacyPanelOrderId(order: PanelOrder): number | null {
  if (!order.legacySource.startsWith(LEGACY_PREFIX)) return null;
  const n = Number(order.legacySource.slice(LEGACY_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Orders to offer in a picker (link a BOM, …): active ones, plus the one
 * already chosen even when it's archived — a picker that dropped the current
 * value would clear it on the next save.
 */
export function pickableOrders(orders: PanelOrder[], currentId: number | null): PanelOrder[] {
  return orders.filter((o) => !o.archived || o.id === currentId);
}
