import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  EMPTY_MAINTENANCE_FILTERS,
  type MaintenanceFilters,
} from "@/lib/maintenanceFilters";

// =============================================================================
// Work-order filter state, lifted into the URL.
//
// Same contract as useFilters.ts for Engineering tasks: the URL is the source
// of truth, so a filtered view is shareable and survives a refresh, and any
// link BETWEEN two views of the same list has to carry the params along —
// which is what `maintenanceFilterSearch()` is for.
//
//   q          → search
//   equipment  → equipmentIds     (comma-separated integers)
//   assigned   → assignedEmails   (comma-separated keys; "__unassigned__" is one)
//   category   → categories       (comma-separated choice values)
//   dept       → departments      (comma-separated equipment departments)
//
// **There is deliberately no "assigned to me" default here.** The Engineering
// task list defaults its Assigned filter to the signed-in user; this one opens
// showing every open work order, for the same reason the EIR list opens
// unfiltered (CLAUDE.md, "The EIR list opens UNFILTERED"). A maintenance
// backlog is a SHARED queue — the question people open it to ask is "what
// needs doing", not "what is mine" — and a list that silently hid three
// quarters of the work would be reported as broken, exactly as the EIR one
// was. It also means a link from a dashboard card lands where the list lands
// on its own, so nothing depends on which route you arrived by.
// =============================================================================

export const MAINTENANCE_FILTER_PARAM_KEYS = [
  "q",
  "equipment",
  "assigned",
  "category",
  "dept",
] as const;

/**
 * The filter params out of a location's search string, as a `?…` suffix
 * (`""` when none are set) — for the List ⇄ Board switcher.
 *
 * `status` is deliberately left behind, matching `filterSearch`: on the board
 * the columns ARE the statuses, so carrying `status=Complete` across leaves
 * six empty columns, which reads as broken.
 */
export function maintenanceFilterSearch(search: string): string {
  const from = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const key of MAINTENANCE_FILTER_PARAM_KEYS) {
    const value = from.get(key);
    if (value !== null && value !== "") out.set(key, value);
  }
  const query = out.toString();
  return query ? `?${query}` : "";
}

export function useMaintenanceFilters(): [MaintenanceFilters, (next: MaintenanceFilters) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: MaintenanceFilters = useMemo(
    () => ({
      ...EMPTY_MAINTENANCE_FILTERS,
      search: searchParams.get("q") ?? "",
      equipmentIds: parseIntList(searchParams.get("equipment")),
      // Lowercased on the way in, because `personKey` lowercases too: MSAL
      // hands back a proper-cased UPN while SharePoint stores it lowercased,
      // and a link shared before that was noticed still has to select the
      // right person.
      assignedEmails: parseStringList(searchParams.get("assigned")).map((e) => e.toLowerCase()),
      categories: parseStringList(searchParams.get("category")),
      departments: parseStringList(searchParams.get("dept")),
    }),
    [searchParams],
  );

  const setFilters = useCallback(
    (next: MaintenanceFilters) => {
      setSearchParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          setOrDelete(out, "q", next.search);
          setOrDelete(out, "equipment", next.equipmentIds.join(","));
          setOrDelete(out, "assigned", next.assignedEmails.join(","));
          setOrDelete(out, "category", next.categories.join(","));
          setOrDelete(out, "dept", next.departments.join(","));
          return out;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [filters, setFilters];
}

/**
 * An empty value DELETES the key rather than parking `?assigned=` in the URL.
 *
 * The task list keeps a present-but-empty `assigned=` on purpose — that is how
 * it encodes an explicit "Anyone" so its default-to-me can't re-apply. There
 * is no such default here, so an empty param would carry no information and
 * only clutter a shared link.
 */
function setOrDelete(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value);
  else params.delete(key);
}

function parseIntList(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^-?\d+$/.test(s))
    .map((s) => parseInt(s, 10));
}

function parseStringList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
