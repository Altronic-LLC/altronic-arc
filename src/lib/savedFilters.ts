// =============================================================================
// Saved filters — Altronic-LLC/BusinessIT#12 (Thomas Terhune).
//
// A saved filter is a NAMED QUERY STRING. Every list's filters already live in
// the URL (useFilters / useEirFilters), so saving one is picking the list's
// filter params out of the address and giving them a name; applying one is
// putting them back.
//
// Kept per BROWSER, in localStorage (Tim, 2026-11-25), like the Keep open tabs
// and the List/Kanban choice. Not shared, not on other devices — ARC has no
// server. The store and the hooks are in hooks/useSavedFilters.ts; this file
// is the rules, pure.
//
// Three rules worth keeping:
//
//   - **Your own address is saved as `@me`.** A filter saved as "assigned to
//     me" must still mean the person signed in, whoever that is on a shared
//     PC, and survive the sign-in name and the mailbox being spelled
//     differently. `@me` is put back as the signed-in mailbox when applied.
//   - **The query is CANONICAL**: only the list's keys, in the list's order,
//     a key's default value dropped. That's what lets the menu say which saved
//     filter is on screen by comparing two strings.
//   - **A present-but-empty value is kept** — `assigned=` is how the task list
//     says "Anyone", and dropping it lets the "assigned to me" default back in.
// =============================================================================

export type SavedFilterListId = "tasks" | "eirs";

export const SAVED_FILTER_LIST_IDS: readonly SavedFilterListId[] = ["tasks", "eirs"];

/** What one list saves. Declared next to that list's URL hook. */
export interface SavedFilterSpec {
  list: SavedFilterListId;
  /** Every URL param that is part of this list's filters, in save order. */
  keys: readonly string[];
  /** The keys holding people's addresses (a comma list or one address). */
  personKeys: readonly string[];
  /** A value that means the same as the param being absent — dropped. */
  defaults?: Readonly<Record<string, string>>;
}

export interface SavedFilter {
  id: string;
  name: string;
  /** Canonical query, no leading `?`. May be "" (no filters at all). */
  query: string;
  /** The list opens on this one when it's reached with no filters in the URL. */
  isDefault: boolean;
}

export type SavedFilterStore = Record<SavedFilterListId, SavedFilter[]>;

/** Stands for whoever is signed in. Not an address anyone can have. */
export const SAVED_FILTER_ME = "@me";
export const MAX_SAVED_FILTERS = 20;
export const MAX_SAVED_FILTER_NAME = 60;

export function emptySavedFilterStore(): SavedFilterStore {
  return { tasks: [], eirs: [] };
}

// --- reading what's stored ---------------------------------------------------

/** Tolerant: bad entries are dropped, each list cut to the maximum. */
export function parseSavedFilterStore(raw: unknown): SavedFilterStore {
  const out = emptySavedFilterStore();
  if (!raw || typeof raw !== "object") return out;
  const lists = (raw as { lists?: unknown }).lists;
  if (!lists || typeof lists !== "object") return out;
  for (const list of SAVED_FILTER_LIST_IDS) {
    const entries = (lists as Record<string, unknown>)[list];
    if (!Array.isArray(entries)) continue;
    const seenNames = new Set<string>();
    const seenIds = new Set<string>();
    let defaultSeen = false;
    for (const e of entries) {
      if (out[list].length >= MAX_SAVED_FILTERS) break;
      if (!e || typeof e !== "object") continue;
      const { id, name, query, isDefault } = e as Record<string, unknown>;
      if (typeof id !== "string" || !id || seenIds.has(id)) continue;
      if (typeof name !== "string" || typeof query !== "string") continue;
      const clean = cleanName(name);
      if (!clean || seenNames.has(clean.toLowerCase())) continue;
      const def = isDefault === true && !defaultSeen;
      if (def) defaultSeen = true;
      seenIds.add(id);
      seenNames.add(clean.toLowerCase());
      out[list].push({ id, name: clean, query: query.replace(/^\?/, ""), isDefault: def });
    }
  }
  return out;
}

export function serializeSavedFilterStore(store: SavedFilterStore): string {
  return JSON.stringify({ version: 1, lists: store });
}

// --- queries -----------------------------------------------------------------

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_SAVED_FILTER_NAME);
}

function toParams(search: string | URLSearchParams): URLSearchParams {
  return typeof search === "string" ? new URLSearchParams(search.replace(/^\?/, "")) : search;
}

/**
 * The saved form of a set of filters: `keys` only, in that order, defaults
 * dropped, and the signed-in user's own addresses replaced with `@me`.
 */
export function toSavedQuery(
  search: string | URLSearchParams,
  spec: SavedFilterSpec,
  myEmails: readonly string[],
  keys: readonly string[] = spec.keys,
): string {
  const from = toParams(search);
  const mine = new Set(myEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const out = new URLSearchParams();
  for (const key of keys) {
    const value = from.get(key);
    if (value === null) continue;
    if (spec.defaults?.[key] === value) continue;
    if (spec.personKeys.includes(key)) {
      const parts = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (mine.has(s.toLowerCase()) ? SAVED_FILTER_ME : s));
      out.set(key, [...new Set(parts)].join(","));
    } else {
      out.set(key, value);
    }
  }
  return out.toString();
}

/** Whether applying `query` needs to know who is signed in. */
export function savedQueryNeedsMe(query: string, spec: SavedFilterSpec): boolean {
  const params = toParams(query);
  return spec.personKeys.some((key) =>
    (params.get(key) ?? "").split(",").some((s) => s.trim() === SAVED_FILTER_ME),
  );
}

/**
 * The URL after applying a saved filter: every one of the list's keys taken
 * out, then the saved ones put in, `@me` as `myEmail`. Anything else in the
 * URL (the task list's scope, say) is left alone. Null when the saved filter
 * names `@me` and nobody is known yet — the caller waits.
 */
export function applySavedQuery(
  current: string | URLSearchParams,
  query: string,
  spec: SavedFilterSpec,
  myEmail: string | null,
): URLSearchParams | null {
  if (savedQueryNeedsMe(query, spec) && !myEmail) return null;
  const out = new URLSearchParams(toParams(current));
  for (const key of spec.keys) out.delete(key);
  const saved = toParams(query);
  for (const key of spec.keys) {
    const value = saved.get(key);
    if (value === null) continue;
    if (spec.personKeys.includes(key) && myEmail) {
      out.set(
        key,
        value
          .split(",")
          .map((s) => (s.trim() === SAVED_FILTER_ME ? myEmail : s.trim()))
          .join(","),
      );
    } else {
      out.set(key, value);
    }
  }
  return out;
}

/** No filter of this list's in the URL — the list was reached plainly. */
export function isBareSearch(search: string | URLSearchParams, spec: SavedFilterSpec): boolean {
  const params = toParams(search);
  return spec.keys.every((key) => !params.has(key));
}

/**
 * The saved filter matching what's on screen, compared on `keys` only (the
 * board leaves `status` out, its columns being the statuses). Null if none.
 */
export function matchingSavedFilter(
  filters: readonly SavedFilter[],
  search: string | URLSearchParams,
  spec: SavedFilterSpec,
  myEmails: readonly string[],
  keys: readonly string[] = spec.keys,
): SavedFilter | null {
  const now = toSavedQuery(search, spec, myEmails, keys);
  return filters.find((f) => toSavedQuery(f.query, spec, [], keys) === now) ?? null;
}

// --- changing a list ---------------------------------------------------------

export type SavedFilterRefusal = "empty-name" | "duplicate-name" | "full";

export type SavedFilterResult =
  | { ok: true; filters: SavedFilter[]; filter: SavedFilter; replaced: boolean }
  | { ok: false; reason: SavedFilterRefusal };

export function savedFilterRefusalText(reason: SavedFilterRefusal): string {
  switch (reason) {
    case "empty-name":
      return "Give the filter a name.";
    case "duplicate-name":
      return "Another saved filter already has that name.";
    case "full":
      return `You can keep ${MAX_SAVED_FILTERS} saved filters here. Delete one to save another.`;
  }
}

export function findByName(filters: readonly SavedFilter[], name: string): SavedFilter | null {
  const key = cleanName(name).toLowerCase();
  return filters.find((f) => f.name.toLowerCase() === key) ?? null;
}

/**
 * Save the current filters under a name. The same name (any case) REPLACES
 * that saved filter's query and keeps its place and its default flag — that is
 * how one is updated.
 */
export function saveFilter(
  filters: readonly SavedFilter[],
  name: string,
  query: string,
  newId: () => string,
): SavedFilterResult {
  const clean = cleanName(name);
  if (!clean) return { ok: false, reason: "empty-name" };
  const existing = findByName(filters, clean);
  if (existing) {
    const filter = { ...existing, name: clean, query };
    return {
      ok: true,
      replaced: true,
      filter,
      filters: filters.map((f) => (f.id === existing.id ? filter : f)),
    };
  }
  if (filters.length >= MAX_SAVED_FILTERS) return { ok: false, reason: "full" };
  const filter: SavedFilter = { id: newId(), name: clean, query, isDefault: false };
  return { ok: true, replaced: false, filter, filters: [...filters, filter] };
}

export function renameFilter(
  filters: readonly SavedFilter[],
  id: string,
  name: string,
): { ok: true; filters: SavedFilter[] } | { ok: false; reason: SavedFilterRefusal } {
  const clean = cleanName(name);
  if (!clean) return { ok: false, reason: "empty-name" };
  const clash = findByName(filters, clean);
  if (clash && clash.id !== id) return { ok: false, reason: "duplicate-name" };
  return { ok: true, filters: filters.map((f) => (f.id === id ? { ...f, name: clean } : f)) };
}

export function removeFilter(filters: readonly SavedFilter[], id: string): SavedFilter[] {
  return filters.filter((f) => f.id !== id);
}

/** Put a deleted filter back where it was (the Undo on the delete toast). */
export function restoreFilter(
  filters: readonly SavedFilter[],
  filter: SavedFilter,
  index: number,
): SavedFilter[] {
  if (filters.some((f) => f.id === filter.id)) return [...filters];
  if (filters.length >= MAX_SAVED_FILTERS) return [...filters];
  const clash = findByName(filters, filter.name);
  if (clash) return [...filters];
  // A default set meanwhile wins; the restored one comes back as a plain one.
  const restored = filters.some((f) => f.isDefault) ? { ...filter, isDefault: false } : filter;
  const at = Math.max(0, Math.min(index, filters.length));
  return [...filters.slice(0, at), restored, ...filters.slice(at)];
}

/** One default per list; `null` (or the current default's id) clears it. */
export function setDefaultFilter(
  filters: readonly SavedFilter[],
  id: string | null,
): SavedFilter[] {
  return filters.map((f) => ({ ...f, isDefault: id !== null && f.id === id }));
}

export function defaultFilter(filters: readonly SavedFilter[]): SavedFilter | null {
  return filters.find((f) => f.isDefault) ?? null;
}
