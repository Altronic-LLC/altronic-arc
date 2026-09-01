import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createQcTimeEntry, listQcTimeEntries, updateQcTimeEntry } from "@/api/qcTimeTracking";
import type { QcTimeEntry, QcTimeEntryInput } from "@/types/task";
import { pushToast } from "@/components/Toast";

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

export function useQcTimeEntries() {
  return useQuery({
    queryKey: QC_TIME_ENTRIES_KEY,
    queryFn: listQcTimeEntries,
    // Entries are logged a handful of times a day, not edited continuously —
    // a couple of minutes of staleness costs nothing here.
    staleTime: 2 * 60_000,
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
