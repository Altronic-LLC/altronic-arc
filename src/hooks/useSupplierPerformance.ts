import { useQuery } from "@tanstack/react-query";
import { describeSupplierPerformanceFailure, listSapSupplierPerformance } from "@/api/supplierPerformance";
import { isRetryableFabricFailure } from "@/api/fabric";
import {
  indexSapSupplierPerformance,
  type SapSupplierPerformance,
} from "@/lib/supplierPerformance";

export const SAP_SUPPLIER_PERFORMANCE_KEY = ["sap-supplier-performance"] as const;

/** SAP refreshes these figures far less often than anyone opens a supplier. */
const STALE_MS = 30 * 60_000;

/**
 * SAP's supplier performance, keyed by BP number — ONE read of the whole
 * table, shared by the Suppliers list and every supplier page.
 *
 * `index` is null until SAP has answered, and stays null if it couldn't —
 * `failure` then says why, in words. `loading` is the window in between,
 * when neither SAP's figures nor ARC's should be presented as the answer.
 */
export function useSupplierPerformanceIndex() {
  const q = useQuery<SapSupplierPerformance[], Error, Map<string, SapSupplierPerformance>>({
    queryKey: SAP_SUPPLIER_PERFORMANCE_KEY,
    queryFn: listSapSupplierPerformance,
    select: indexSapSupplierPerformance,
    staleTime: STALE_MS,
    gcTime: 2 * STALE_MS,
    retry: (count, err) => isRetryableFabricFailure(err) && count < 1,
  });
  return {
    index: q.data ?? null,
    loading: q.isPending,
    failure: q.isError ? describeSupplierPerformanceFailure(q.error) : null,
  };
}
