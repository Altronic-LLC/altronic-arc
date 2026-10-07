import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDigitalQcRecord,
  deleteDigitalQcRecord,
  DIGITAL_QC_FAMILY_LIST_IDS,
  listDigitalQcRecords,
  updateDigitalQcRecord,
} from "@/api/digitalQc";
import type { DigitalQcRecord } from "@/lib/digitalQc";

type ProductFamily = keyof typeof DIGITAL_QC_FAMILY_LIST_IDS;

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
