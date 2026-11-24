import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSupplierColdCall,
  deleteSupplierColdCall,
  listSupplierColdCalls,
  updateSupplierColdCall,
} from "@/api/supplierColdCalls";
import type { SupplierColdCall, SupplierColdCallInput } from "@/types/supplierColdCall";
import { compareSupplierColdCalls } from "@/lib/supplierColdCalls";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Supplier Cold Call Log hooks (BusinessIT#79). No role gating: anyone signed
// in adds, edits and removes an entry. Each write lands the row SharePoint
// hands back in the cache, then refetches.
// =============================================================================

export const SUPPLIER_COLD_CALLS_KEY = ["supplierColdCalls"] as const;

const SITE = "Altronic_PMO";

export function useSupplierColdCalls() {
  return useQuery({
    queryKey: SUPPLIER_COLD_CALLS_KEY,
    queryFn: listSupplierColdCalls,
    staleTime: 2 * 60_000,
  });
}

function upsert(rows: SupplierColdCall[] | undefined, row: SupplierColdCall): SupplierColdCall[] {
  const rest = (rows ?? []).filter((r) => r.id !== row.id);
  return [...rest, row].sort(compareSupplierColdCalls);
}

export function useCreateSupplierColdCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplierColdCallInput) => createSupplierColdCall(input),
    onSuccess: (created) => {
      qc.setQueryData<SupplierColdCall[]>(SUPPLIER_COLD_CALLS_KEY, (old) => upsert(old, created));
      void qc.invalidateQueries({ queryKey: SUPPLIER_COLD_CALLS_KEY });
      pushToast({ message: `Added ${created.company} to the cold call log.` });
    },
    onError: (err) => {
      pushToast({
        message: describeListWriteFailure(err, { action: "add the entry", site: SITE, permission: "adding items" }),
        variant: "error",
      });
    },
  });
}

export function useUpdateSupplierColdCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, previous }: { input: SupplierColdCallInput; previous: SupplierColdCall }) =>
      updateSupplierColdCall(previous.id, input, previous),
    onSuccess: (updated) => {
      qc.setQueryData<SupplierColdCall[]>(SUPPLIER_COLD_CALLS_KEY, (old) => upsert(old, updated));
      void qc.invalidateQueries({ queryKey: SUPPLIER_COLD_CALLS_KEY });
      pushToast({ message: `Saved ${updated.company}.` });
    },
    onError: (err) => {
      void qc.invalidateQueries({ queryKey: SUPPLIER_COLD_CALLS_KEY });
      pushToast({
        message: describeListWriteFailure(err, { action: "save the entry", site: SITE, permission: "editing" }),
        variant: "error",
      });
    },
  });
}

export function useDeleteSupplierColdCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: SupplierColdCall) => deleteSupplierColdCall(entry.id),
    onSuccess: (_void, entry) => {
      qc.setQueryData<SupplierColdCall[]>(SUPPLIER_COLD_CALLS_KEY, (old) =>
        old?.filter((r) => r.id !== entry.id),
      );
      void qc.invalidateQueries({ queryKey: SUPPLIER_COLD_CALLS_KEY });
      pushToast({ message: `Removed ${entry.company} from the cold call log.` });
    },
    onError: (err) => {
      // Nothing was removed, so the row is still there — refetch so the
      // screen and SharePoint agree.
      void qc.invalidateQueries({ queryKey: SUPPLIER_COLD_CALLS_KEY });
      pushToast({
        message: describeListWriteFailure(err, { action: "remove the entry", site: SITE }),
        variant: "error",
      });
    },
  });
}
