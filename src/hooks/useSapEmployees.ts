import { useQuery } from "@tanstack/react-query";
import { describeSapEmployeeFailure, listSapEmployees, needsSapEmployeeSignIn } from "@/api/sapEmployees";
import { isRetryableFabricFailure } from "@/api/fabric";
import type { SapEmployee } from "@/lib/sapEmployees";

export const SAP_EMPLOYEES_KEY = ["sap-employees"] as const;

/** SAP's list changes when somebody is hired, not by the minute. */
const STALE_MS = 10 * 60_000;

/**
 * SAP's employee list — ONE read of the whole table, shared by every New Hire
 * page, fetched in the background when one opens. `failure` says why it
 * couldn't be read, in words; `signInNeeded` is the dev demo's "Sign in to SAP".
 */
export function useSapEmployees(enabled = true) {
  const q = useQuery<SapEmployee[]>({
    queryKey: SAP_EMPLOYEES_KEY,
    queryFn: listSapEmployees,
    staleTime: STALE_MS,
    gcTime: 3 * STALE_MS,
    enabled,
    retry: (count, err) => isRetryableFabricFailure(err) && count < 1,
  });
  return {
    employees: q.data ?? null,
    loading: q.isPending && enabled,
    failure: q.isError ? describeSapEmployeeFailure(q.error) : null,
    signInNeeded: q.isError && needsSapEmployeeSignIn(q.error),
    refetch: q.refetch,
  };
}
