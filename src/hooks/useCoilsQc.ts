import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addCoilPartNumber,
  addCoilOtherFault,
  createCoilDefectLogEntry,
  listCoilDefectLog,
  listCoilOtherFaults,
  listCoilPartNumbers,
  updateCoilDefectLogEntry,
} from "@/api/coilsQc";
import type { CoilDefectLogEntry, CoilDefectLogInput } from "@/lib/coilsQc";

export const COILS_QC_LOG_KEY = ["coils", "defect-log"] as const;
export const COIL_PART_NUMBERS_KEY = ["coils", "part-numbers"] as const;
export const COIL_OTHER_FAULTS_KEY = ["coils", "other-faults"] as const;

export function useCoilDefectLog() {
  return useQuery({
    queryKey: COILS_QC_LOG_KEY,
    queryFn: listCoilDefectLog,
    staleTime: 60_000,
  });
}

export function useCoilPartNumbers() {
  return useQuery({ queryKey: COIL_PART_NUMBERS_KEY, queryFn: listCoilPartNumbers, staleTime: 300_000 });
}

export function useCreateCoilDefectLogEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCoilDefectLogEntry,
    onSuccess: (entry) => queryClient.setQueryData<CoilDefectLogEntry[]>(COILS_QC_LOG_KEY, (current) =>
      current ? [entry, ...current] : [entry],
    ),
  });
}

export function useUpdateCoilDefectLogEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CoilDefectLogInput }) => updateCoilDefectLogEntry(id, input),
    onSuccess: (entry) => queryClient.setQueryData<CoilDefectLogEntry[]>(COILS_QC_LOG_KEY, (current) =>
      current?.map((item) => (item.id === entry.id ? entry : item)),
    ),
  });
}

export function useAddCoilPartNumber() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addCoilPartNumber,
    onSuccess: (partNumber) => queryClient.setQueryData<string[]>(COIL_PART_NUMBERS_KEY, (current) =>
      [...new Set([...(current ?? []), partNumber])].sort((left, right) => left.localeCompare(right)),
    ),
  });
}

export function useCoilOtherFaults() {
  return useQuery({ queryKey: COIL_OTHER_FAULTS_KEY, queryFn: listCoilOtherFaults, staleTime: 300_000 });
}

export function useAddCoilOtherFault() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addCoilOtherFault,
    onSuccess: (fault) => queryClient.setQueryData<string[]>(COIL_OTHER_FAULTS_KEY, (current) =>
      [...new Set([...(current ?? []), fault])].sort((left, right) => left.localeCompare(right)),
    ),
  });
}