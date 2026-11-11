import type { LayoutComponent, PlantLayoutItem } from "@/types/plant";
import { clampSize, type SymbolSwap } from "./plantEditor";

// =============================================================================
// Symbol VERSIONS — pure. Replacing a symbol (a new drawing, or new details)
// never edits its row: it adds a NEW row on Layout Components with the same
// ComponentKey and Version + 1. A placed item points at a ROW id, so every
// layout keeps the version it was drawn with — a published layout never
// changes under anyone. An item moves to the newer version only when somebody
// updates it in a draft, which is then published like any other change.
//
//   - A symbol is its KEY (case-insensitive). Its latest version is the row
//     with the highest Version; a tie goes to the higher id (added later).
//   - The palette and the Symbols page show only the latest version of each.
//   - A row with no key is its own symbol — there is nothing to group it by.
// =============================================================================

/** The symbol a row is a version of. */
export function symbolKey(c: LayoutComponent): string {
  return c.key.trim().toLowerCase() || `#${c.id}`;
}

function newer(a: LayoutComponent, b: LayoutComponent): boolean {
  return a.version > b.version || (a.version === b.version && a.id > b.id);
}

/** The newest version of every symbol, by key. */
export function latestByKey(components: readonly LayoutComponent[]): Map<string, LayoutComponent> {
  const out = new Map<string, LayoutComponent>();
  for (const c of components) {
    const k = symbolKey(c);
    const seen = out.get(k);
    if (!seen || newer(c, seen)) out.set(k, c);
  }
  return out;
}

/** The newest version of every symbol — what the palette and the Symbols page show. */
export function latestSymbols(components: readonly LayoutComponent[]): LayoutComponent[] {
  const latest = new Set([...latestByKey(components).values()].map((c) => c.id));
  return components.filter((c) => latest.has(c.id));
}

/** The ids of every version of this symbol, its own included. */
export function symbolVersionIds(component: LayoutComponent, components: readonly LayoutComponent[]): Set<number> {
  const k = symbolKey(component);
  const ids = new Set(components.filter((c) => symbolKey(c) === k).map((c) => c.id));
  ids.add(component.id);
  return ids;
}

/**
 * The newer version an item could move to, or null — it is on the latest
 * already, its row isn't loaded, or the newest version is retired.
 */
export function newerVersionFor(
  item: PlantLayoutItem,
  byId: ReadonlyMap<number, LayoutComponent>,
  latest: ReadonlyMap<string, LayoutComponent>,
): LayoutComponent | null {
  const current = byId.get(item.componentId);
  if (!current) return null;
  const top = latest.get(symbolKey(current));
  if (!top || top.id === current.id || !newer(top, current) || !top.active) return null;
  return top;
}

/** "Same size" to a hundredth of an inch — sizes are stored to two places. */
const sameSize = (a: number, b: number) => Math.abs(a - b) < 0.01;

/**
 * An item moved onto another version of its symbol. Where it stands, its
 * turn, label, asset, lock and layer are kept. Its SIZE follows the symbol
 * when it was still at the old footprint (it was never resized); an item that
 * was resized keeps its size, held inside the new version's limits.
 */
export function symbolSwap(item: PlantLayoutItem, from: LayoutComponent | undefined, to: LayoutComponent): SymbolSwap {
  const atFootprint = !from || (sameSize(item.w, from.footprintW) && sameSize(item.d, from.footprintD));
  const size = atFootprint ? { w: to.footprintW, d: to.footprintD } : clampSize(to, item.w, item.d);
  return { uid: item.uid, componentId: to.id, componentVersion: to.version, w: size.w, d: size.d };
}

/** Every item on a layout that has a newer symbol version waiting, with the swap that updates it. */
export function outdatedItems(
  items: readonly PlantLayoutItem[],
  components: readonly LayoutComponent[],
): { item: PlantLayoutItem; to: LayoutComponent; swap: SymbolSwap }[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const latest = latestByKey(components);
  const out: { item: PlantLayoutItem; to: LayoutComponent; swap: SymbolSwap }[] = [];
  for (const item of items) {
    const to = newerVersionFor(item, byId, latest);
    if (to) out.push({ item, to, swap: symbolSwap(item, byId.get(item.componentId), to) });
  }
  return out;
}
