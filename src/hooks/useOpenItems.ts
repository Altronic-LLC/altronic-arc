import { useSyncExternalStore } from "react";
import {
  addOpenItem,
  moveOpenItem,
  parseOpenItems,
  removeOpenItem,
  renameOpenItem,
  shiftOpenItem,
  type AddOpenItemResult,
  type OpenItem,
} from "@/lib/openItems";

// =============================================================================
// The open-items store (BusinessIT#74) — the records kept open in the strip
// under the header.
//
// Per BROWSER, in localStorage, like the theme and the List/Kanban choice: it
// survives a refresh, and a second ARC tab in the same browser sees the same
// strip (the `storage` event keeps them in step). It is not shared between
// devices and nobody else sees it — ARC has no server to keep it on.
//
// Every access is wrapped: the accessor throws in a private window or with
// site data blocked. The strip then works for the life of the page and is
// simply not remembered, which is the status quo.
//
// A module-level store read through useSyncExternalStore, not context: the
// strip (in the header) and every record page's Keep open button are in
// unrelated trees, and there is one browser tab.
// =============================================================================

export const OPEN_ITEMS_STORAGE_KEY = "arc-open-items";

let items: OpenItem[] | null = null;
const listeners = new Set<() => void>();

function load(): OpenItem[] {
  try {
    return parseOpenItems(JSON.parse(localStorage.getItem(OPEN_ITEMS_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function current(): OpenItem[] {
  if (items === null) items = load();
  return items;
}

function commit(next: OpenItem[]): void {
  if (next === items) return;
  items = next;
  try {
    localStorage.setItem(OPEN_ITEMS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not remembered past this page — nothing anyone can act on.
  }
  for (const listener of listeners) listener();
}

function onStorage(e: StorageEvent): void {
  // Another ARC tab in this browser changed the list (or cleared site data).
  if (e.key !== OPEN_ITEMS_STORAGE_KEY && e.key !== null) return;
  items = load();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

/** The records kept open, in tab order. */
export function useOpenItems(): OpenItem[] {
  return useSyncExternalStore(subscribe, current, current);
}

/** Keep a record open. Refused (not added) when the list is full. */
export function keepOpen(item: OpenItem): AddOpenItemResult {
  const result = addOpenItem(current(), item);
  if (result.ok) commit(result.items);
  return result;
}

export function closeOpenItem(path: string): void {
  commit(removeOpenItem(current(), path));
}

/** Drop the tab at `fromPath` onto the tab at `toPath`. */
export function reorderOpenItem(fromPath: string, toPath: string): void {
  commit(moveOpenItem(current(), fromPath, toPath));
}

/** One place left or right — the keyboard reorder. */
export function shiftOpenItemBy(path: string, delta: -1 | 1): void {
  commit(shiftOpenItem(current(), path, delta));
}

/** Keep a kept record's tab label in step with its title. No-op otherwise. */
export function renameOpenItemLabel(path: string, label: string): void {
  commit(renameOpenItem(current(), path, label));
}

/** Test seam: forget the in-memory list so the next read starts from storage. */
export function resetOpenItemsStore(): void {
  items = null;
  for (const listener of listeners) listener();
}
