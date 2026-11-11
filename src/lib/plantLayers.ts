import { titleFromKey } from "@/lib/plantLayoutDoc";
import type { PlantLayer, PlantLayoutItem } from "@/types/plant";

// =============================================================================
// Plant Map layers — pure.
//
// A layer is a set of items shown and hidden together (the safety layer:
// extinguishers, exits, first aid, severe-weather shelters), each optionally
// in a GROUP toggled on its own. An item without a layer is the BASE PLAN and
// is always shown.
//
// Four rules:
//   * Showing and hiding is per viewer and is never saved. What a layout
//     saves is whether a layer starts hidden.
//   * A layer an item names but the layout doesn't declare is still a layer
//     (shown by default, titled from its key) — an item must never become
//     unreachable because its layer wasn't declared.
//   * Hiding is DISPLAY only. The placement check reads every item, shown or
//     not, so hiding a layer can't hide a problem.
//   * The hidden state is a set of keys: "safety" hides the layer,
//     "safety/extinguishers" one of its groups.
// =============================================================================

/** The hidden-state key for a layer, or for one of its groups. */
export function layerKey(layer: string, group?: string | null): string {
  return group ? `${layer}/${group}` : layer;
}

/**
 * The layers a layout has: the ones it declares, in order, then any its items
 * name that it doesn't (and any undeclared group appended to its layer).
 */
export function layoutLayers(doc: { items: readonly PlantLayoutItem[]; layers?: readonly PlantLayer[] }): PlantLayer[] {
  const out: PlantLayer[] = (doc.layers ?? []).map((l) => ({ ...l, groups: l.groups.map((g) => ({ ...g })) }));
  for (const item of doc.items) {
    if (!item.layer) continue;
    let layer = out.find((l) => l.key === item.layer);
    if (!layer) {
      layer = { key: item.layer, title: titleFromKey(item.layer), hiddenByDefault: false, groups: [] };
      out.push(layer);
    }
    if (item.group && !layer.groups.some((g) => g.key === item.group)) {
      layer.groups.push({ key: item.group, title: titleFromKey(item.group) });
    }
  }
  return out;
}

/** The keys hidden when a layout opens: every layer that starts hidden. */
export function defaultHiddenLayers(layers: readonly PlantLayer[]): Set<string> {
  return new Set(layers.filter((l) => l.hiddenByDefault).map((l) => l.key));
}

/** Is this item drawn? The base plan always is. */
export function itemVisible(item: Pick<PlantLayoutItem, "layer" | "group">, hidden: ReadonlySet<string>): boolean {
  if (!item.layer) return true;
  if (hidden.has(item.layer)) return false;
  return !(item.group && hidden.has(layerKey(item.layer, item.group)));
}

/** Show or hide a whole layer (its groups keep their own setting). */
export function setLayerShown(hidden: ReadonlySet<string>, layer: string, shown: boolean): Set<string> {
  const next = new Set(hidden);
  if (shown) next.delete(layer);
  else next.add(layer);
  return next;
}

/** Show or hide one group of a layer. Showing a group shows its layer too. */
export function setGroupShown(hidden: ReadonlySet<string>, layer: string, group: string, shown: boolean): Set<string> {
  const next = new Set(hidden);
  if (shown) {
    next.delete(layerKey(layer, group));
    next.delete(layer);
  } else {
    next.add(layerKey(layer, group));
  }
  return next;
}

/** Whatever keeps this item hidden, shown — for picking a hidden item from a list. */
export function revealItem(hidden: ReadonlySet<string>, item: Pick<PlantLayoutItem, "layer" | "group">): Set<string> {
  if (itemVisible(item, hidden) || !item.layer) return new Set(hidden);
  const next = new Set(hidden);
  next.delete(item.layer);
  if (item.group) next.delete(layerKey(item.layer, item.group));
  return next;
}

/** How many items each layer, and each layer/group, holds. */
export function layerCounts(items: readonly PlantLayoutItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const i of items) {
    if (!i.layer) continue;
    counts.set(i.layer, (counts.get(i.layer) ?? 0) + 1);
    if (i.group) {
      const k = layerKey(i.layer, i.group);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return counts;
}

/** "Safety · Extinguishers", "Safety", or "" for the base plan. */
export function layerLabel(item: Pick<PlantLayoutItem, "layer" | "group">, layers: readonly PlantLayer[]): string {
  if (!item.layer) return "";
  const layer = layers.find((l) => l.key === item.layer);
  const title = layer?.title ?? titleFromKey(item.layer);
  if (!item.group) return title;
  const group = layer?.groups.find((g) => g.key === item.group)?.title ?? titleFromKey(item.group);
  return `${title} · ${group}`;
}

/**
 * Where a newly placed symbol goes: if EVERY placement of it on the layout is
 * on one layer and group, there too (a new extinguisher joins the others);
 * otherwise the base plan. Never a guess between two.
 */
export function placementLayerFor(
  /** The symbol's id — or every version's id, so copies on an older version count. */
  componentId: number | ReadonlySet<number>,
  items: readonly PlantLayoutItem[],
): { layer: string; group?: string } | null {
  const ids = typeof componentId === "number" ? new Set([componentId]) : componentId;
  const same = items.filter((i) => ids.has(i.componentId));
  if (same.length === 0) return null;
  const first = same[0];
  if (!first.layer) return null;
  const agree = same.every((i) => i.layer === first.layer && (i.group ?? null) === (first.group ?? null));
  if (!agree) return null;
  return first.group ? { layer: first.layer, group: first.group } : { layer: first.layer };
}
