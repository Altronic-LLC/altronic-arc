import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createIgnitionQcRecord,
  deleteIgnitionQcRecord,
  IGNITION_QC_FAMILY_LIST_IDS,
  listIgnitionQcRecords,
  updateIgnitionQcRecord,
} from "@/api/ignitionQc";
import type { IgnitionQcRecord } from "@/lib/ignitionQc";

type ProductFamily = keyof typeof IGNITION_QC_FAMILY_LIST_IDS;

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
