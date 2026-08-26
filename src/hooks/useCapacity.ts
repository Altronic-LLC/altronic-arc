import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCapacity, deleteCapacity, listCapacity, updateCapacity } from "@/api/capacity";
import type { CapacityEntry, CapacityInput } from "@/types/task";
import { pushToast } from "@/components/Toast";

export const CAPACITY_KEY = ["capacity"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useCapacityList() {
  return useQuery({
    queryKey: CAPACITY_KEY,
    queryFn: listCapacity,
    staleTime: 60_000,
  });
}

export function useCapacityFor(customerId: number | null) {
  const { data: entries = [], ...rest } = useCapacityList();
  return {
    ...rest,
    data: customerId === null ? [] : entries.filter((e) => e.customerId === customerId),
  };
}

export function useCreateCapacity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CapacityInput) => createCapacity(input),
    onSuccess: (created) => {
      qc.setQueryData<CapacityEntry[]>(CAPACITY_KEY, (old) =>
        old ? [created, ...old] : [created],
      );
      pushToast({ message: `Added ${created.partNumber || "capacity entry"}.` });
    },
    onError: (err: Error) => errorToast(`Couldn't add the capacity entry: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: CAPACITY_KEY }),
  });
}

export function useUpdateCapacity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changed }: { id: number; changed: Partial<CapacityInput> }) =>
      updateCapacity(id, changed),
    onSuccess: (updated) => {
      qc.setQueryData<CapacityEntry[]>(CAPACITY_KEY, (old) =>
        old?.map((e) => (e.id === updated.id ? updated : e)),
      );
    },
    onError: (err: Error) => errorToast(`Couldn't save that change: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: CAPACITY_KEY }),
  });
}

export function useDeleteCapacity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteCapacity(id),
    onSuccess: (_data, id) => {
      qc.setQueryData<CapacityEntry[]>(CAPACITY_KEY, (old) => old?.filter((e) => e.id !== id));
      pushToast({ message: "Capacity entry removed." });
    },
    onError: (err: Error) => errorToast(`Couldn't remove the capacity entry: ${err.message}`),
    onSettled: () => qc.invalidateQueries({ queryKey: CAPACITY_KEY }),
  });
}
