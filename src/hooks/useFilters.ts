import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { Filters } from "@/components/FilterBar";
import { useCurrentUser } from "./useCurrentUser";

/**
 * The URL params that carry filter state. Anything that links between two
 * views of the SAME task list (List ⇄ Kanban) must hand these on, or the
 * filters reset — see `filterSearch()`.
 */
export const FILTER_PARAM_KEYS = ["q", "project", "assigned", "createdBy"] as const;

/**
 * Pick just the filter params out of a location's search string and return
 * them as a `?…` suffix ready to append to a path (`""` when none are set).
 *
 * Used by the List/Kanban switcher in the Header: those are two views of one
 * filtered task list, so switching must not drop the filters. Linking to a
 * bare `/kanban` did exactly that, and because the Assigned filter DEFAULTS
 * to the signed-in user, a user who had widened it to "Anyone" got snapped
 * back to their own tasks.
 *
 * A present-but-empty `assigned=` is deliberately preserved: that is the
 * encoding of an explicit "Anyone", and dropping it lets the first-visit
 * default re-apply on the other view.
 *
 * Only these params travel. `status` is left behind on purpose — the status
 * pills are component state that the URL isn't kept in step with, so
 * carrying a stale `status=` back to the List would restore a filter the
 * user had already clicked away from.
 */
export function filterSearch(search: string): string {
  const from = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const key of FILTER_PARAM_KEYS) {
    const value = from.get(key);
    if (value !== null) out.set(key, value);
  }
  const query = out.toString();
  return query ? `?${query}` : "";
}

/**
 * Filter state lifted into URL search params so it survives view switching,
 * refreshes, and shared links. Both ListView and KanbanView use this hook
 * to read/write the same source of truth.
 *
 * URL param keys (intentionally short to keep address bar tidy):
 *   q          → search
 *   project    → projectIds  (comma-separated integers, e.g. "10,20")
 *   assigned   → assignedEmails (comma-separated emails)
 *   createdBy  → createdByEmail
 *
 * "Assigned to me" default: on first visit (URL has no `assigned` param at
 * all), we write the signed-in user's email into the URL so the home page
 * shows their tasks. If the URL has `?assigned=` (empty value, meaning the
 * user previously picked "Anyone"), we respect that — the default doesn't
 * re-apply on refresh / back-navigation.
 *
 * Because the state lives in the URL, any link BETWEEN two views of the same
 * list has to carry these params along — that's what `filterSearch()` is for.
 */
export function useFilters(): [Filters, (next: Filters) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const me = useCurrentUser();
  const defaulted = useRef(false);

  // First-visit default: only fires when `assigned` is absent from the URL.
  // useRef guards against double-fire under React 18 strict-mode dev rendering.
  useEffect(() => {
    if (defaulted.current) return;
    if (searchParams.has("assigned")) {
      defaulted.current = true;
      return;
    }
    if (!me.email) return; // wait until current-user is known
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        // Lowercased: MSAL hands back the proper-cased UPN
        // ("Nicholas.Sirianni@…") while SharePoint stores it lowercased, and
        // "Assigned to me" then matched none of the user's own tasks.
        next.set("assigned", me.email!.toLowerCase());
        return next;
      },
      { replace: true },
    );
    defaulted.current = true;
  }, [me.email, searchParams, setSearchParams]);

  const filters: Filters = useMemo(() => {
    const projectRaw = searchParams.get("project");
    const assignedRaw = searchParams.get("assigned");
    const createdByRaw = searchParams.get("createdBy");
    return {
      search: searchParams.get("q") ?? "",
      projectIds: parseIntList(projectRaw),
      // assignedEmails: empty array means explicit "Anyone" when the param
      // is present, OR not-yet-defaulted when the param is absent. Either
      // way, applyFilters skips the assigned check.
      // Lowercased on the way in so links shared before this fix — which carry
      // the proper-cased UPN — still select the right person.
      assignedEmails: parseStringList(assignedRaw).map((e) => e.toLowerCase()),
      createdByEmail: createdByRaw ? createdByRaw.toLowerCase() : null,
    };
  }, [searchParams]);

  const setFilters = useCallback(
    (next: Filters) => {
      setSearchParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next.search) out.set("q", next.search);
          else out.delete("q");
          if (next.projectIds.length > 0) out.set("project", next.projectIds.join(","));
          else out.delete("project");
          // assignedEmails: always present in URL after first interaction.
          // Empty array → explicit "Anyone" (preserved as ?assigned= so the
          // first-visit default doesn't re-apply on refresh).
          if (next.assignedEmails.length > 0) out.set("assigned", next.assignedEmails.join(","));
          else out.set("assigned", "");
          if (next.createdByEmail) out.set("createdBy", next.createdByEmail);
          else out.delete("createdBy");
          return out;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [filters, setFilters];
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
