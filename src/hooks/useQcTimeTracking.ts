import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createQcTimeEntry,
  deleteQcTimeEntry,
  listQcTimeEntries,
  listQcTimeHoldReasonChoices,
  updateQcTimeEntry,
} from "@/api/qcTimeTracking";
import type { QcTimeEntry, QcTimeEntryInput } from "@/types/task";
import { pushToast } from "@/components/Toast";
import { useIsAdmin } from "@/hooks/useIsAdmin";

// =============================================================================
// QC Time Tracking hooks — Panels' log of hours QC spends on a project.
//
// Standard per-list pattern: api/qcTimeTracking.ts owns the mock/real branch,
// this file owns caching and cache updates. There is no per-field patch hook
// like Visit Reports' — this list has no detail page, so every write goes
// through the one form modal that saves everything at once.
//
// No delete hook, because there is no delete in the API — see the note at the
// top of api/qcTimeTracking.ts.
// =============================================================================

export const QC_TIME_ENTRIES_KEY = ["qcTimeEntries"] as const;
export const QC_TIME_HOLD_REASON_CHOICES_KEY = ["qcTimeHoldReasonChoices"] as const;

export function useQcTimeEntries() {
  return useQuery({
    queryKey: QC_TIME_ENTRIES_KEY,
    queryFn: listQcTimeEntries,
    // Entries are logged a handful of times a day, not edited continuously —
    // a couple of minutes of staleness costs nothing here.
    staleTime: 2 * 60_000,
  });
}

/**
 * The live "Hold Reason" column's choices, read off SharePoint's own column
 * config -- see listQcTimeHoldReasonChoices. A long staleTime is fine: this
 * is column metadata, not a record, and changes as rarely as the column
 * itself does.
 */
export function useQcTimeHoldReasonChoices() {
  return useQuery({
    queryKey: QC_TIME_HOLD_REASON_CHOICES_KEY,
    queryFn: listQcTimeHoldReasonChoices,
    staleTime: 30 * 60_000,
  });
}

export function useCreateQcTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QcTimeEntryInput) => createQcTimeEntry(input),
    onSuccess: (created) => {
      qc.setQueryData<QcTimeEntry[]>(QC_TIME_ENTRIES_KEY, (old) =>
        old ? [created, ...old] : [created],
      );
      qc.invalidateQueries({ queryKey: QC_TIME_ENTRIES_KEY });
      pushToast({ message: `Logged QC time for ${created.project || "that project"}.` });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't log the entry: ${err.message}`, variant: "error" });
    },
  });
}

export function useUpdateQcTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: QcTimeEntryInput }) =>
      updateQcTimeEntry(id, input),
    onSuccess: (updated) => {
      qc.setQueryData<QcTimeEntry[]>(QC_TIME_ENTRIES_KEY, (old) =>
        old?.map((e) => (e.id === updated.id ? updated : e)),
      );
      qc.invalidateQueries({ queryKey: QC_TIME_ENTRIES_KEY });
      pushToast({ message: `Saved the entry for ${updated.project || "that project"}.` });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't save that change: ${err.message}`, variant: "error" });
    },
  });
}

/**
 * Delete an entry — **ADMIN-ONLY**.
 *
 * For a genuine DUPLICATE: two techs on one panel, the second logging it
 * again, leaving a row with nothing to correct (Ray, 2026-09-16). Everything
 * else is fixed with an edit.
 *
 * The gate is re-checked HERE, in the `mutationFn`, not only where the button
 * is drawn — the same defence-in-depth as `useDeleteTeradyneLogEntry`, so a
 * future screen or bulk action can't reach the API without it. Admin-only
 * rather than open because an edit leaves a corrected record and a delete
 * leaves nothing, and because SharePoint needs more permission to delete an
 * item than to edit one — offering it to everyone hands somebody a button
 * that 403s.
 */
export function useDeleteQcTimeEntry() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (id: number) => {
      if (!isAdmin) throw new Error("Only admins can delete QC time entries.");
      return deleteQcTimeEntry(id);
    },
    onSuccess: (_void, id) => {
      qc.setQueryData<QcTimeEntry[]>(QC_TIME_ENTRIES_KEY, (old) =>
        old?.filter((e) => e.id !== id),
      );
      qc.invalidateQueries({ queryKey: QC_TIME_ENTRIES_KEY });
      pushToast({ message: "Entry deleted." });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't delete the entry: ${err.message}`, variant: "error" });
    },
  });
}
