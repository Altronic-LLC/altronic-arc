import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CURRENT_YEAR_SCOPE,
  createTeradyneLogEntry,
  deleteTeradyneLogEntry,
  listTeradyneLog,
  listTeradyneLookupUsage,
  updateTeradyneLogEntry,
  type TeradyneLogResult,
  type TeradyneLogScope,
  type TeradyneRefTitles,
} from "@/api/teradyneLog";
import {
  REF_LISTS,
  createTeradyneRef,
  deleteTeradyneRef,
  listTeradyneRefs,
  updateTeradyneRef,
} from "@/api/teradyneRefs";
import type {
  TeradyneEmployee,
  TeradyneLogEntry,
  TeradyneLogInput,
  TeradyneProduct,
  TeradyneRefInput,
  TeradyneRefKind,
  TeradyneRemark,
} from "@/types/task";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Teradyne hooks — queries + mutations for the log and its three reference
// lists. Follows the per-list pattern from CLAUDE.md: api/<list>.ts does the
// mock/real branching, these hooks own caching and invalidation.
//
// Invalidation note: editing a reference list can change titles the LOG
// displays (renaming a product renames it on every row), so every reference
// mutation invalidates the log query too, not just its own list.
// =============================================================================

/**
 * Root key for every scope of the log. Mutations invalidate this prefix so all
 * loaded years refresh, not just the one on screen.
 */
export const TERADYNE_LOG_KEY = ["teradyneLog"] as const;
export const teradyneLogKey = (scope: TeradyneLogScope) =>
  [...TERADYNE_LOG_KEY, scope.kind === "all" ? "all" : scope.year] as const;
export const TERADYNE_USAGE_KEY = ["teradyneLookupUsage"] as const;
export const teradyneRefKey = (kind: TeradyneRefKind) => ["teradyneRefs", kind] as const;

/**
 * The log for one scope — the current year unless told otherwise. The list is
 * 16k+ rows with legacy history in it, so loading a year at a time is the
 * difference between one request and eighteen (see src/api/teradyneLog.ts).
 */
export function useTeradyneLog(scope: TeradyneLogScope = CURRENT_YEAR_SCOPE()) {
  return useQuery({
    queryKey: teradyneLogKey(scope),
    queryFn: () => listTeradyneLog(scope),
    staleTime: 120_000,
  });
}

/** Just the entries, for callers that don't care how the fetch went. */
export function useTeradyneLogEntries(scope?: TeradyneLogScope): TeradyneLogEntry[] {
  return useTeradyneLog(scope).data?.entries ?? [];
}

export function useTeradyneEmployees() {
  return useQuery({
    queryKey: teradyneRefKey("employees"),
    queryFn: () => listTeradyneRefs("employees") as Promise<TeradyneEmployee[]>,
    staleTime: 5 * 60_000,
  });
}

export function useTeradyneProducts() {
  return useQuery({
    queryKey: teradyneRefKey("products"),
    queryFn: () => listTeradyneRefs("products") as Promise<TeradyneProduct[]>,
    staleTime: 5 * 60_000,
  });
}

export function useTeradyneRemarks() {
  return useQuery({
    queryKey: teradyneRefKey("remarks"),
    queryFn: () => listTeradyneRefs("remarks") as Promise<TeradyneRemark[]>,
    staleTime: 5 * 60_000,
  });
}

/** Generic reference-list query, for the shared manage-list screen. */
export function useTeradyneRefs(kind: TeradyneRefKind) {
  return useQuery({
    queryKey: teradyneRefKey(kind),
    queryFn: () => listTeradyneRefs(kind),
    staleTime: 5 * 60_000,
  });
}

/**
 * How many log entries point at each row of a reference list — across ALL
 * years, not just the year on screen.
 *
 * Two jobs: it powers the "used by N entries" hint on the manage screens, and
 * it's what stops a delete from orphaning lookups — a row still in use can't be
 * removed, because the log rows referencing it would degrade to "(missing #n)".
 *
 * Deliberately its own query rather than reading the loaded year: a product used
 * only by legacy rows is still in use, and those rows feed SharePoint reporting.
 * Scoping this to the current year would make the guard confidently wrong.
 *
 * `isLoading` matters: until it resolves, EVERY row looks unused, so a caller
 * that gates deletes on the counts has to keep them disabled while this is true
 * or the guard has a hole exactly the width of the load.
 */
export function useTeradyneRefUsage(kind: TeradyneRefKind): {
  usage: Map<number, number>;
  isLoading: boolean;
} {
  const { data, isPending } = useQuery({
    queryKey: TERADYNE_USAGE_KEY,
    queryFn: listTeradyneLookupUsage,
    staleTime: 5 * 60_000,
  });
  const usage = useMemo(() => data?.[kind] ?? new Map<number, number>(), [data, kind]);
  return { usage, isLoading: isPending };
}

/** Pure counterpart of useTeradyneRefUsage — exported for tests and callers with the log in hand. */
export function teradyneRefUsage(
  log: TeradyneLogEntry[],
  kind: TeradyneRefKind,
): Map<number, number> {
  const counts = new Map<number, number>();
  const bump = (lookupId: number | undefined | null) => {
    if (lookupId == null) return;
    counts.set(lookupId, (counts.get(lookupId) ?? 0) + 1);
  };
  for (const e of log) {
    if (kind === "products") bump(e.product?.lookupId);
    else if (kind === "remarks") bump(e.remark?.lookupId);
    else {
      // An employee counts once per entry even when they're on it twice.
      const ids = new Set(
        [e.employee1?.lookupId, e.employee2?.lookupId].filter((x): x is number => x != null),
      );
      ids.forEach((id) => bump(id));
    }
  }
  return counts;
}

// -----------------------------------------------------------------------------
// Log mutations
// -----------------------------------------------------------------------------

/**
 * Refresh every loaded year of the log plus the all-time usage counts. The log
 * key is a prefix, so one invalidate covers whichever scopes are cached.
 */
function invalidateLogAndUsage(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: TERADYNE_LOG_KEY });
  qc.invalidateQueries({ queryKey: TERADYNE_USAGE_KEY });
}

/** Patch one entry across every cached scope of the log. */
function patchCachedEntry(
  qc: ReturnType<typeof useQueryClient>,
  update: (entries: TeradyneLogEntry[]) => TeradyneLogEntry[],
) {
  qc.setQueriesData<TeradyneLogResult>({ queryKey: TERADYNE_LOG_KEY }, (prev) =>
    prev ? { ...prev, entries: update(prev.entries) } : prev,
  );
}

export function useCreateTeradyneLogEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, titles }: { input: TeradyneLogInput; titles: TeradyneRefTitles }) =>
      createTeradyneLogEntry(input, titles),
    onSuccess: (created) => {
      pushToast({ message: `Logged “${created.title}”`});
      invalidateLogAndUsage(qc);
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't save the entry: ${err.message}`, variant: "error" });
    },
  });
}

export function useUpdateTeradyneLogEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
      titles,
    }: {
      id: number;
      input: TeradyneLogInput;
      titles: TeradyneRefTitles;
    }) => updateTeradyneLogEntry(id, input, titles),
    onSuccess: (updated) => {
      // Patch the cached row in place so the table updates immediately, keeping
      // the fields a PATCH can't return (createdAt) from the loaded copy.
      patchCachedEntry(qc, (entries) =>
        entries.map((e) => (e.id === updated.id ? { ...updated, createdAt: e.createdAt } : e)),
      );
      pushToast({ message: "Entry updated"});
      invalidateLogAndUsage(qc);
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't update the entry: ${err.message}`, variant: "error" });
    },
  });
}

export function useDeleteTeradyneLogEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteTeradyneLogEntry(id),
    onSuccess: (_void, id) => {
      patchCachedEntry(qc, (entries) => entries.filter((e) => e.id !== id));
      pushToast({ message: "Entry deleted"});
      invalidateLogAndUsage(qc);
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't delete the entry: ${err.message}`, variant: "error" });
    },
  });
}

// -----------------------------------------------------------------------------
// Reference-list mutations
// -----------------------------------------------------------------------------

/** Invalidate one reference list AND the log (whose rows display its titles). */
function invalidateRefAndLog(qc: ReturnType<typeof useQueryClient>, kind: TeradyneRefKind) {
  qc.invalidateQueries({ queryKey: teradyneRefKey(kind) });
  invalidateLogAndUsage(qc);
}

export function useCreateTeradyneRef(kind: TeradyneRefKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TeradyneRefInput) => createTeradyneRef(kind, input),
    onSuccess: (row) => {
      pushToast({ message: `Added “${row.title}”`});
      invalidateRefAndLog(qc, kind);
    },
    onError: (err: Error) => {
      pushToast({
        message: `Couldn't add the ${REF_LISTS[kind].singular}: ${err.message}`,
        variant: "error",
      });
    },
  });
}

export function useUpdateTeradyneRef(kind: TeradyneRefKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lookupId, input }: { lookupId: number; input: TeradyneRefInput }) =>
      updateTeradyneRef(kind, lookupId, input),
    onSuccess: (row) => {
      pushToast({ message: `Saved “${row.title}”`});
      invalidateRefAndLog(qc, kind);
    },
    onError: (err: Error) => {
      pushToast({
        message: `Couldn't save the ${REF_LISTS[kind].singular}: ${err.message}`,
        variant: "error",
      });
    },
  });
}

export function useDeleteTeradyneRef(kind: TeradyneRefKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lookupId: number) => deleteTeradyneRef(kind, lookupId),
    onSuccess: () => {
      pushToast({ message: `Deleted from ${REF_LISTS[kind].label}`});
      invalidateRefAndLog(qc, kind);
    },
    onError: (err: Error) => {
      pushToast({
        message: `Couldn't delete the ${REF_LISTS[kind].singular}: ${err.message}`,
        variant: "error",
      });
    },
  });
}
