import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createQcFormRecord, listQcFormRecords, updateQcFormRecord } from "@/api/qcForms";
import { qcFormRecordLabel, type QcFormRecord, type QcFormSpec, type QcValues } from "@/lib/qcFormEngine";
import { pushToast } from "@/components/Toast";

// =============================================================================
// QC Forms hooks — one cache per form, keyed by its id. api/qcForms.ts owns
// the mock/real branch, this file owns caching. No delete hook, because there
// is no delete in the API — a submitted sheet is corrected with an edit, not
// removed.
// =============================================================================

export const qcFormRecordsKey = (formId: string) => ["qcFormRecords", formId] as const;

export function useQcFormRecords(spec: QcFormSpec) {
  return useQuery({
    queryKey: qcFormRecordsKey(spec.id),
    queryFn: () => listQcFormRecords(spec),
    staleTime: 2 * 60_000,
  });
}

export function useCreateQcFormRecord(spec: QcFormSpec) {
  const qc = useQueryClient();
  const key = qcFormRecordsKey(spec.id);
  return useMutation({
    mutationFn: (values: QcValues) => createQcFormRecord(spec, values),
    onSuccess: (created) => {
      qc.setQueryData<QcFormRecord[]>(key, (old) => (old ? [created, ...old] : [created]));
      qc.invalidateQueries({ queryKey: key });
      pushToast({ message: `Saved the ${spec.noun} for ${qcFormRecordLabel(spec, created)}.` });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't save that ${spec.noun}: ${err.message}`, variant: "error" });
    },
  });
}

export function useUpdateQcFormRecord(spec: QcFormSpec) {
  const qc = useQueryClient();
  const key = qcFormRecordsKey(spec.id);
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: QcValues }) => updateQcFormRecord(spec, id, values),
    onSuccess: (updated) => {
      qc.setQueryData<QcFormRecord[]>(key, (old) => old?.map((r) => (r.id === updated.id ? updated : r)));
      qc.invalidateQueries({ queryKey: key });
      pushToast({ message: `Saved changes to ${qcFormRecordLabel(spec, updated)}.` });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't save that change: ${err.message}`, variant: "error" });
    },
  });
}
