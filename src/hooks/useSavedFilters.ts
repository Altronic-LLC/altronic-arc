import { useSyncExternalStore } from "react";
import {
  defaultFilter,
  emptySavedFilterStore,
  parseSavedFilterStore,
  removeFilter,
  renameFilter,
  restoreFilter,
  saveFilter,
  serializeSavedFilterStore,
  setDefaultFilter,
  type SavedFilter,
  type SavedFilterListId,
  type SavedFilterResult,
  type SavedFilterRefusal,
  type SavedFilterStore,
} from "@/lib/savedFilters";

// =============================================================================
// The saved-filters store (Altronic-LLC/BusinessIT#12) — named filters for the
// task list and the EIR list, kept in THIS BROWSER.
//
// localStorage, the Keep open tabs arrangement exactly: survives a refresh,
// another ARC tab in the same browser sees the same list (`storage` event),
// nobody else and no other device does. Every access is wrapped — the
// accessor throws in a private window or with site data blocked, and then the
// filters work for the life of the page and simply aren't remembered.
//
// A module-level store read through useSyncExternalStore, because the menu
// (in the view) and the "open on the default" logic (in the URL hooks) are in
// different places and there is one browser tab.
// =============================================================================

export const SAVED_FILTERS_STORAGE_KEY = "arc-saved-filters";

const NO_FILTERS: SavedFilter[] = [];

let store: SavedFilterStore | null = null;
const listeners = new Set<() => void>();

function load(): SavedFilterStore {
  try {
    return parseSavedFilterStore(JSON.parse(localStorage.getItem(SAVED_FILTERS_STORAGE_KEY) ?? "{}"));
  } catch {
    return emptySavedFilterStore();
  }
}

function current(): SavedFilterStore {
  if (store === null) store = load();
  return store;
}

function commit(list: SavedFilterListId, next: SavedFilter[]): void {
  store = { ...current(), [list]: next };
  try {
    localStorage.setItem(SAVED_FILTERS_STORAGE_KEY, serializeSavedFilterStore(store));
  } catch {
    // Not remembered past this page — nothing anyone can act on.
  }
  for (const listener of listeners) listener();
}

function onStorage(e: StorageEvent): void {
  if (e.key !== SAVED_FILTERS_STORAGE_KEY && e.key !== null) return;
  store = load();
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

/** One list's saved filters, in the order saved. `null` → none (a list with no saved filters). */
export function useSavedFilters(list: SavedFilterListId | null): SavedFilter[] {
  return useSyncExternalStore(
    subscribe,
    () => (list ? current()[list] : NO_FILTERS),
    () => (list ? current()[list] : NO_FILTERS),
  );
}

/** The list's default saved filter, read outside React (the URL hooks' effects). */
export function readDefaultSavedFilter(list: SavedFilterListId): SavedFilter | null {
  return defaultFilter(current()[list]);
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function saveCurrentFilters(
  list: SavedFilterListId,
  name: string,
  query: string,
): SavedFilterResult {
  const result = saveFilter(current()[list], name, query, newId);
  if (result.ok) commit(list, result.filters);
  return result;
}

export function renameSavedFilter(
  list: SavedFilterListId,
  id: string,
  name: string,
): { ok: true } | { ok: false; reason: SavedFilterRefusal } {
  const result = renameFilter(current()[list], id, name);
  if (!result.ok) return result;
  commit(list, result.filters);
  return { ok: true };
}

/** Delete one. Returns what Undo needs to put it back. */
export function deleteSavedFilter(
  list: SavedFilterListId,
  id: string,
): { filter: SavedFilter; index: number } | null {
  const filters = current()[list];
  const index = filters.findIndex((f) => f.id === id);
  if (index < 0) return null;
  commit(list, removeFilter(filters, id));
  return { filter: filters[index], index };
}

export function undoDeleteSavedFilter(
  list: SavedFilterListId,
  filter: SavedFilter,
  index: number,
): void {
  commit(list, restoreFilter(current()[list], filter, index));
}

/** Make one the list's default, or clear the default with `null`. */
export function setDefaultSavedFilter(list: SavedFilterListId, id: string | null): void {
  commit(list, setDefaultFilter(current()[list], id));
}

/** Test seam: forget the in-memory store so the next read starts from storage. */
export function resetSavedFiltersStore(): void {
  store = null;
  for (const listener of listeners) listener();
}
