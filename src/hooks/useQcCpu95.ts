import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createQcCpu95Record,
  listQcCpu95Records,
  updateQcCpu95Record,
} from "@/api/qcCpu95";
import type { QcCpu95Record } from "@/types/task";
import { qcCpu95Label } from "@/lib/qcCpu95Mapper";
import { pushToast } from "@/components/Toast";

// =============================================================================
// QCFRM-012 (CPU-95) hooks — standard per-list pattern: api/qcCpu95.ts owns
// the mock/real branch, this file owns caching. No delete hook, because
// there is no delete in the API — a submitted test sheet is corrected with
// an edit, not removed (see the note at the top of api/qcCpu95.ts).
// =============================================================================

export const QC_CPU95_RECORDS_KEY = ["qcCpu95Records"] as const;

export function useQcCpu95Records() {
  return useQuery({
    queryKey: QC_CPU95_RECORDS_KEY,
    queryFn: listQcCpu95Records,
    staleTime: 2 * 60_000,
  });
}

export function useCreateQcCpu95Record() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, string>) => createQcCpu95Record(values),
    onSuccess: (created) => {
      qc.setQueryData<QcCpu95Record[]>(QC_CPU95_RECORDS_KEY, (old) =>
        old ? [created, ...old] : [created],
      );
      qc.invalidateQueries({ queryKey: QC_CPU95_RECORDS_KEY });
      pushToast({ message: `Saved the test sheet for ${qcCpu95Label(created)}.` });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't save that test sheet: ${err.message}`, variant: "error" });
    },
  });
}

export function useUpdateQcCpu95Record() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Record<string, string> }) =>
      updateQcCpu95Record(id, values),
    onSuccess: (updated) => {
      qc.setQueryData<QcCpu95Record[]>(QC_CPU95_RECORDS_KEY, (old) =>
        old?.map((r) => (r.id === updated.id ? updated : r)),
      );
      qc.invalidateQueries({ queryKey: QC_CPU95_RECORDS_KEY });
      pushToast({ message: `Saved changes to ${qcCpu95Label(updated)}.` });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't save that change: ${err.message}`, variant: "error" });
    },
  });
}
