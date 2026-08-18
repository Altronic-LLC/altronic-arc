import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createVisitReport,
  listVisitReports,
  updateVisitReport,
  updateVisitReportFields,
} from "@/api/visitReports";
import type { VisitReport, VisitReportInput } from "@/types/task";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Visit Reports hooks — Sales' record of customer visits.
//
// Standard per-list pattern: api/visitReports.ts owns the mock/real branch,
// these own caching, optimistic patching and invalidation.
//
// The detail view edits one field at a time (`useUpdateVisitReportFields`),
// which is optimistic so a choice picker doesn't sit there for a round-trip;
// the form saves everything at once (`useUpdateVisitReport`) and isn't, since
// the modal closes on success anyway.
//
// There is no delete hook, because there is no delete in the API — see the
// note at the top of api/visitReports.ts.
// =============================================================================

export const VISIT_REPORTS_KEY = ["visitReports"] as const;

export function useVisitReports() {
  return useQuery({
    queryKey: VISIT_REPORTS_KEY,
    queryFn: listVisitReports,
    // Reports are filed after a visit, not edited all day — a couple of
    // minutes of staleness costs nothing and saves refetching ~1,000 rows.
    staleTime: 2 * 60_000,
  });
}

/** One report from the cached list; the detail view reads through this. */
export function useVisitReport(id: number | null) {
  const { data: reports = [], ...rest } = useVisitReports();
  return {
    ...rest,
    data: id === null ? undefined : reports.find((r) => r.id === id),
  };
}

export function useCreateVisitReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VisitReportInput) => createVisitReport(input),
    onSuccess: (created) => {
      // Seed the cache so navigating straight to the new report's detail page
      // doesn't briefly show "not found" (the createTask lesson).
      qc.setQueryData<VisitReport[]>(VISIT_REPORTS_KEY, (old) =>
        old ? [created, ...old] : [created],
      );
      qc.invalidateQueries({ queryKey: VISIT_REPORTS_KEY });
      pushToast({ message: `Filed the visit report for ${created.customerName}.` });
    },
    onError: (err: Error) => {
      pushToast({
        message: `Couldn't file the visit report: ${err.message}`,
        variant: "error",
      });
    },
  });
}

/** Save every field at once — the edit form's path. */
export function useUpdateVisitReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: VisitReportInput }) =>
      updateVisitReport(id, input),
    onSuccess: (updated) => {
      qc.setQueryData<VisitReport[]>(VISIT_REPORTS_KEY, (old) =>
        old?.map((r) => (r.id === updated.id ? updated : r)),
      );
      qc.invalidateQueries({ queryKey: VISIT_REPORTS_KEY });
      pushToast({ message: `Saved the visit report for ${updated.customerName}.` });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't save the report: ${err.message}`, variant: "error" });
    },
  });
}

/**
 * Patch single columns from the detail page, optimistically.
 *
 * Takes SharePoint field names so a caller can write exactly the column it
 * owns; `patch` is the same change applied to the cached object, since the
 * domain names don't match the column names.
 */
export function useUpdateVisitReportFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      fields,
    }: {
      id: number;
      fields: Record<string, unknown>;
      patch: Partial<VisitReport>;
    }) => updateVisitReportFields(id, fields),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: VISIT_REPORTS_KEY });
      const previous = qc.getQueryData<VisitReport[]>(VISIT_REPORTS_KEY);
      qc.setQueryData<VisitReport[]>(VISIT_REPORTS_KEY, (old) =>
        old?.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      );
      return { previous };
    },
    onSuccess: (updated) => {
      // Land the row the write actually returned, rather than waiting on a
      // refetch of the whole list.
      qc.setQueryData<VisitReport[]>(VISIT_REPORTS_KEY, (old) =>
        old?.map((r) => (r.id === updated.id ? updated : r)),
      );
    },
    onError: (err: Error, _vars, ctx) => {
      // Roll back only what was snapshotted — writing [] into a list that had
      // no data yet renders "no reports" and survives the rollback.
      if (ctx?.previous) qc.setQueryData(VISIT_REPORTS_KEY, ctx.previous);
      pushToast({
        message: `Couldn't save that change — reverted. ${err.message}`,
        variant: "error",
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: VISIT_REPORTS_KEY }),
  });
}
