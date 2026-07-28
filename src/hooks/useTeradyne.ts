import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTeradyneLogEntry,
  deleteTeradyneLogEntry,
  listTeradyneLog,
  updateTeradyneLogEntry,
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

export const TERADYNE_LOG_KEY = ["teradyneLog"] as const;
export const teradyneRefKey = (kind: TeradyneRefKind) => ["teradyneRefs", kind] as const;

export function useTeradyneLog() {
  return useQuery({
    queryKey: TERADYNE_LOG_KEY,
    queryFn: listTeradyneLog,
    staleTime: 120_000,
  });
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
 * How many log entries point at each row of a reference list.
 *
 * Two jobs: it powers the "used by N entries" hint on the manage screens, and
 * it's what stops a delete from orphaning lookups — a row still in use can't be
 * removed, because the log rows referencing it would degrade to "(missing #n)".
 *
 * `isLoading` matters: until the log has loaded, EVERY row looks unused, so a
 * caller that gates deletes on the counts has to keep them disabled while this
 * is true or the guard has a hole exactly the width of the log's load time.
 */
export function useTeradyneRefUsage(kind: TeradyneRefKind): {
  usage: Map<number, number>;
  isLoading: boolean;
} {
  const { data: log = [], isPending } = useTeradyneLog();
  const usage = useMemo(() => teradyneRefUsage(log, kind), [log, kind]);
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

export function useCreateTeradyneLogEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, titles }: { input: TeradyneLogInput; titles: TeradyneRefTitles }) =>
      createTeradyneLogEntry(input, titles),
    onSuccess: (created) => {
      pushToast({ message: `Logged “${created.title}”`});
      qc.invalidateQueries({ queryKey: TERADYNE_LOG_KEY });
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
      qc.setQueryData<TeradyneLogEntry[]>(TERADYNE_LOG_KEY, (prev) =>
        prev?.map((e) => (e.id === updated.id ? { ...updated, createdAt: e.createdAt } : e)),
      );
      pushToast({ message: "Entry updated"});
      qc.invalidateQueries({ queryKey: TERADYNE_LOG_KEY });
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
      qc.setQueryData<TeradyneLogEntry[]>(TERADYNE_LOG_KEY, (prev) =>
        prev?.filter((e) => e.id !== id),
      );
      pushToast({ message: "Entry deleted"});
      qc.invalidateQueries({ queryKey: TERADYNE_LOG_KEY });
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
  qc.invalidateQueries({ queryKey: TERADYNE_LOG_KEY });
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
