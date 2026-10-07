import { useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createIgnitionQcRecord,
  deleteIgnitionQcRecord,
  IGNITION_QC_FAMILY_LIST_IDS,
  listIgnitionQcRecords,
  updateIgnitionQcRecord,
} from "@/api/ignitionQc";
import type { IgnitionQcRecord } from "@/lib/ignitionQc";
import {
  categoryBreakdown,
  monthlyQuantityYield,
  quantityRecordsInMonth,
  trailingMonths,
  QC_DEFECT_CATEGORIES,
  type CategoryBreakdown,
  type MonthlyFpy,
} from "@/lib/monthlyYield";

type ProductFamily = keyof typeof IGNITION_QC_FAMILY_LIST_IDS;

const IGNITION_QC_FAMILIES = Object.keys(IGNITION_QC_FAMILY_LIST_IDS) as ProductFamily[];

/** See the identical constant in useDigitalQc.ts — same reasoning, 36 lists here instead of 18. */
const REPORT_REFETCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Every family's records, merged — the Reports dashboard's source. Ignition
 * QC has NO single list; it's 36 lists, one per product family, with the
 * identical column shape (see api/ignitionQc.ts). `useQueries` fires all 36
 * in parallel, reusing the EXACT SAME query key each family's own
 * `useListIgnitionQcRecords(family)` call already uses — so a report open
 * alongside the Ignition QC screen shares its cache instead of re-fetching.
 */
export function useAllIgnitionQcRecords(): {
  entries: IgnitionQcRecord[];
  isLoading: boolean;
  /** The most recent successful fetch among all 36 families; `null` before the first lands. */
  lastRefreshedAt: Date | null;
} {
  const results = useQueries({
    queries: IGNITION_QC_FAMILIES.map((family) => ({
      queryKey: ["ignitionQcRecords", family],
      queryFn: () => listIgnitionQcRecords(family),
      staleTime: 5 * 60 * 1000,
      refetchInterval: REPORT_REFETCH_INTERVAL_MS,
    })),
  });

  const entries = useMemo(
    () => results.flatMap((r) => (r.data as IgnitionQcRecord[] | undefined) ?? []),
    [results],
  );
  const lastRefreshedAt = useMemo(() => {
    const timestamps = results.map((r) => r.dataUpdatedAt).filter((t) => t > 0);
    return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
  }, [results]);

  return { entries, isLoading: results.some((r) => r.isLoading), lastRefreshedAt };
}

/**
 * Monthly Quantity Tested / Quantity Rejected / FPY% for the trailing N
 * months (default 3), always ending at the current month — the Reports
 * dashboard. See `useDigitalQcMonthlyFpy` for why no batch/defect split or
 * year-scoping is needed here either.
 */
export function useIgnitionQcMonthlyFpy(monthsBack = 3): {
  monthly: MonthlyFpy[];
  isLoading: boolean;
  lastRefreshedAt: Date | null;
  /** What failed, and by how much, in the most recent of the trailing months — the donut chart. */
  latestMonthBreakdown: CategoryBreakdown[];
} {
  const months = useMemo(() => trailingMonths(monthsBack), [monthsBack]);
  const { entries, isLoading, lastRefreshedAt } = useAllIgnitionQcRecords();
  const monthly = useMemo(() => monthlyQuantityYield(entries, months), [entries, months]);
  const latestMonthBreakdown = useMemo(() => {
    const latestMonth = months[months.length - 1];
    return categoryBreakdown(quantityRecordsInMonth(entries, latestMonth), QC_DEFECT_CATEGORIES);
  }, [entries, months]);

  return { monthly, isLoading, lastRefreshedAt, latestMonthBreakdown };
}

// =============================================================================
// React Query hooks for Ignition QC records
// =============================================================================

/**
 * Fetch all Ignition QC records for a given product family.
 * Cached per family. Re-fetches on mount and can be invalidated.
 */
export function useListIgnitionQcRecords(family: ProductFamily) {
  return useQuery({
    queryKey: ["ignitionQcRecords", family],
    queryFn: () => listIgnitionQcRecords(family),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Mutation to create a new Ignition QC record for the given family.
 * Optimistically updates the list query cache.
 */
export function useCreateIgnitionQcRecord(family: ProductFamily) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      record: Omit<IgnitionQcRecord, "id" | "productFamily">,
    ): Promise<IgnitionQcRecord> => {
      return createIgnitionQcRecord(family, record);
    },
    onMutate: async (newRecord) => {
      await queryClient.cancelQueries({ queryKey: ["ignitionQcRecords", family] });

      const previousRecords = queryClient.getQueryData<IgnitionQcRecord[]>([
        "ignitionQcRecords",
        family,
      ]);

      const tempId = `temp-${Date.now()}`;
      const tempRecord: IgnitionQcRecord = {
        ...newRecord,
        id: tempId,
        productFamily: family,
      };

      queryClient.setQueryData<IgnitionQcRecord[]>(
        ["ignitionQcRecords", family],
        (old) => (old ? [tempRecord, ...old] : [tempRecord]),
      );

      return { previousRecords };
    },
    onSuccess: (createdRecord) => {
      queryClient.setQueryData<IgnitionQcRecord[]>(
        ["ignitionQcRecords", family],
        (old) =>
          old ? old.map((r) => (r.id.startsWith("temp-") ? createdRecord : r)) : [createdRecord],
      );
    },
    onError: (_err, _variables, context) => {
      if (context?.previousRecords) {
        queryClient.setQueryData(["ignitionQcRecords", family], context.previousRecords);
      }
    },
  });
}

/**
 * Mutation to update an existing Ignition QC record.
 * Optimistically updates the list query cache.
 */
export function useUpdateIgnitionQcRecord(family: ProductFamily) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      recordId,
      record,
    }: {
      recordId: string;
      record: Omit<IgnitionQcRecord, "id" | "productFamily">;
    }): Promise<IgnitionQcRecord> => {
      return updateIgnitionQcRecord(family, recordId, record);
    },
    onMutate: async ({ recordId, record }) => {
      await queryClient.cancelQueries({ queryKey: ["ignitionQcRecords", family] });

      const previousRecords = queryClient.getQueryData<IgnitionQcRecord[]>([
        "ignitionQcRecords",
        family,
      ]);

      queryClient.setQueryData<IgnitionQcRecord[]>(
        ["ignitionQcRecords", family],
        (old) =>
          old
            ? old.map((r) =>
                r.id === recordId
                  ? {
                      ...r,
                      ...record,
                    }
                  : r,
              )
            : [],
      );

      return { previousRecords };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousRecords) {
        queryClient.setQueryData(["ignitionQcRecords", family], context.previousRecords);
      }
    },
  });
}

/**
 * Mutation to delete an Ignition QC record.
 * Optimistically removes it from the list query cache.
 */
export function useDeleteIgnitionQcRecord(family: ProductFamily) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordId: string): Promise<void> => {
      return deleteIgnitionQcRecord(family, recordId);
    },
    onMutate: async (recordId) => {
      await queryClient.cancelQueries({ queryKey: ["ignitionQcRecords", family] });

      const previousRecords = queryClient.getQueryData<IgnitionQcRecord[]>([
        "ignitionQcRecords",
        family,
      ]);

      queryClient.setQueryData<IgnitionQcRecord[]>(
        ["ignitionQcRecords", family],
        (old) => (old ? old.filter((r) => r.id !== recordId) : []),
      );

      return { previousRecords };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousRecords) {
        queryClient.setQueryData(["ignitionQcRecords", family], context.previousRecords);
      }
    },
  });
}
