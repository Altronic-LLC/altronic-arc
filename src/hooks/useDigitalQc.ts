import { useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDigitalQcRecord,
  deleteDigitalQcRecord,
  DIGITAL_QC_FAMILY_LIST_IDS,
  listDigitalQcRecords,
  updateDigitalQcRecord,
} from "@/api/digitalQc";
import type { DigitalQcRecord } from "@/lib/digitalQc";
import {
  categoryBreakdown,
  monthlyQuantityYield,
  quantityRecordsInMonth,
  trailingMonths,
  QC_DEFECT_CATEGORIES,
  type CategoryBreakdown,
  type MonthlyFpy,
} from "@/lib/monthlyYield";

type ProductFamily = keyof typeof DIGITAL_QC_FAMILY_LIST_IDS;

const DIGITAL_QC_FAMILIES = Object.keys(DIGITAL_QC_FAMILY_LIST_IDS) as ProductFamily[];

/**
 * A report screen is typically left open unattended — 5 minutes (longer than
 * Teradyne's 2) because a refresh here means re-querying all 18 family
 * lists, not one, and the underlying data only moves as fast as someone logs
 * a new batch.
 */
const REPORT_REFETCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Every family's records, merged — the Reports dashboard's source. Digital
 * QC has NO single list; it's 18 lists, one per product family, with the
 * identical column shape (see api/digitalQc.ts). `useQueries` fires all 18
 * in parallel, reusing the EXACT SAME query key each family's own
 * `useListDigitalQcRecords(family)` call already uses — so a report open
 * alongside the Digital QC screen shares its cache instead of re-fetching.
 */
export function useAllDigitalQcRecords(): {
  entries: DigitalQcRecord[];
  isLoading: boolean;
  /** The most recent successful fetch among all 18 families; `null` before the first lands. */
  lastRefreshedAt: Date | null;
} {
  const results = useQueries({
    queries: DIGITAL_QC_FAMILIES.map((family) => ({
      queryKey: ["digitalQcRecords", family],
      queryFn: () => listDigitalQcRecords(family),
      staleTime: 5 * 60 * 1000,
      refetchInterval: REPORT_REFETCH_INTERVAL_MS,
    })),
  });

  const entries = useMemo(
    () => results.flatMap((r) => (r.data as DigitalQcRecord[] | undefined) ?? []),
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
 * dashboard. Unlike Teradyne, no batch/defect split is needed: each row
 * already carries its own Quantity Tested and Quantity Rejected directly
 * (`lib/monthlyYield.ts`'s `monthlyQuantityYield`). Unlike Teradyne, there's
 * also no year-scoped fetch to worry about — every family list is read in
 * full every time, so the trailing window is just a client-side filter over
 * data that's already there.
 */
export function useDigitalQcMonthlyFpy(monthsBack = 3): {
  monthly: MonthlyFpy[];
  isLoading: boolean;
  lastRefreshedAt: Date | null;
  /** What failed, and by how much, in the most recent of the trailing months — the donut chart. */
  latestMonthBreakdown: CategoryBreakdown[];
} {
  const months = useMemo(() => trailingMonths(monthsBack), [monthsBack]);
  const { entries, isLoading, lastRefreshedAt } = useAllDigitalQcRecords();
  const monthly = useMemo(() => monthlyQuantityYield(entries, months), [entries, months]);
  const latestMonthBreakdown = useMemo(() => {
    const latestMonth = months[months.length - 1];
    return categoryBreakdown(quantityRecordsInMonth(entries, latestMonth), QC_DEFECT_CATEGORIES);
  }, [entries, months]);

  return { monthly, isLoading, lastRefreshedAt, latestMonthBreakdown };
}

// =============================================================================
// React Query hooks for Digital QC records
// =============================================================================

/**
 * Fetch all Digital QC records for a given product family.
 * Cached per family. Re-fetches on mount and can be invalidated.
 */
export function useListDigitalQcRecords(family: ProductFamily) {
  return useQuery({
    queryKey: ["digitalQcRecords", family],
    queryFn: () => listDigitalQcRecords(family),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Mutation to create a new Digital QC record for the given family.
 * Optimistically updates the list query cache.
 */
export function useCreateDigitalQcRecord(family: ProductFamily) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      record: Omit<DigitalQcRecord, "id" | "productFamily">,
    ): Promise<DigitalQcRecord> => {
      return createDigitalQcRecord(family, record);
    },
    onMutate: async (newRecord) => {
      // Cancel outgoing refetches for this family's list
      await queryClient.cancelQueries({ queryKey: ["digitalQcRecords", family] });

      // Snapshot the old list
      const previousRecords = queryClient.getQueryData<DigitalQcRecord[]>([
        "digitalQcRecords",
        family,
      ]);

      // Optimistically add the new record (without an id; we'll get it from the server)
      const tempId = `temp-${Date.now()}`;
      const tempRecord: DigitalQcRecord = {
        ...newRecord,
        id: tempId,
        productFamily: family,
      };

      queryClient.setQueryData<DigitalQcRecord[]>(
        ["digitalQcRecords", family],
        (old) => (old ? [tempRecord, ...old] : [tempRecord]),
      );

      return { previousRecords };
    },
    onSuccess: (createdRecord) => {
      // Replace the temp record with the real one from the server
      queryClient.setQueryData<DigitalQcRecord[]>(
        ["digitalQcRecords", family],
        (old) =>
          old ? old.map((r) => (r.id.startsWith("temp-") ? createdRecord : r)) : [createdRecord],
      );
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousRecords) {
        queryClient.setQueryData(["digitalQcRecords", family], context.previousRecords);
      }
    },
  });
}

/**
 * Mutation to update an existing Digital QC record.
 * Optimistically updates the list query cache.
 */
export function useUpdateDigitalQcRecord(family: ProductFamily) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      recordId,
      record,
    }: {
      recordId: string;
      record: Omit<DigitalQcRecord, "id" | "productFamily">;
    }): Promise<DigitalQcRecord> => {
      return updateDigitalQcRecord(family, recordId, record);
    },
    onMutate: async ({ recordId, record }) => {
      await queryClient.cancelQueries({ queryKey: ["digitalQcRecords", family] });

      const previousRecords = queryClient.getQueryData<DigitalQcRecord[]>([
        "digitalQcRecords",
        family,
      ]);

      queryClient.setQueryData<DigitalQcRecord[]>(
        ["digitalQcRecords", family],
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
        queryClient.setQueryData(["digitalQcRecords", family], context.previousRecords);
      }
    },
  });
}

/**
 * Mutation to delete a Digital QC record.
 * Optimistically removes it from the list query cache.
 */
export function useDeleteDigitalQcRecord(family: ProductFamily) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordId: string): Promise<void> => {
      return deleteDigitalQcRecord(family, recordId);
    },
    onMutate: async (recordId) => {
      await queryClient.cancelQueries({ queryKey: ["digitalQcRecords", family] });

      const previousRecords = queryClient.getQueryData<DigitalQcRecord[]>([
        "digitalQcRecords",
        family,
      ]);

      queryClient.setQueryData<DigitalQcRecord[]>(
        ["digitalQcRecords", family],
        (old) => (old ? old.filter((r) => r.id !== recordId) : []),
      );

      return { previousRecords };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousRecords) {
        queryClient.setQueryData(["digitalQcRecords", family], context.previousRecords);
      }
    },
  });
}
